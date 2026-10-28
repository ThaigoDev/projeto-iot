// AgroSentinel — serviço central: ingestão MQTT, motor de regras, automação de
// irrigação, persistência e API (REST + WebSocket) para o painel.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const express = require('express');
const mqtt = require('mqtt');
const { WebSocketServer } = require('ws');
const { evaluate, RANK } = require('./rules');
const { Store } = require('./store');

const PORT = Number(process.env.PORT || 3000);
const MQTT_URL = process.env.MQTT_URL || 'mqtt://mosquitto:1883';
const CONFIG_PATH = process.env.FARM_CONFIG || '/config/farm.json';
const DB_PATH = process.env.DB_PATH || '/data/agrosentinel.db';
const OFFLINE_AFTER_MS = 15000;
const CMD_TIMEOUT_MS = 10000;
const VALVE_FAULT_AFTER_MS = 90000;
const STATUS_DEBOUNCE = 3; // avaliações consecutivas antes de mudar o status de um talhão

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const store = new Store(DB_PATH);
const startedAt = Date.now();

// ---------------------------------------------------------------- estado

const plots = new Map();
for (const node of config.nodes) {
  for (const p of node.plots) {
    const crop = config.crops[p.crop];
    plots.set(p.id, {
      ...p,
      nodeId: node.id,
      cropName: crop.name,
      color: crop.color,
      metrics: null,
      raw: [],
      evaluation: { status: 'ok', score: 100, checks: {}, issues: [] },
      status: 'unknown',
      pendingStatus: null,
      pendingCount: 0,
      lastTs: 0,
      valve: { open: false, since: 0, flowLpm: 0, pending: null, startMoisture: 0 },
      manualHoldUntil: 0,
      valveFault: false,
    });
  }
}

const devices = new Map();
function registerDevice(id, kind, name) {
  devices.set(id, { id, kind, name, status: null, lastSeen: 0, msgTimes: [], online: false });
}
for (const node of config.nodes) registerDevice(node.id, 'field-node', node.name);
registerDevice('estacao-meteo', 'weather', 'Estação Meteorológica');
registerDevice('atuador-irrigacao', 'actuator', 'Atuador de Irrigação');

let weather = null;
const broker = { connected: false, sys: {}, sysTs: 0 };

const counters = {
  telemetry: 0, weather: 0, status: 0, actuator: 0, commands: 0,
  evaluations: 0, dbWrites: 0, wsOut: 0, httpReqs: 0, alerts: 0,
};
let lastCounters = { ...counters };
let latencies = [];
const cmdLatencies = [];
const timeline = [];
let rates = {};
let wss = null;
const recentDeltas = [];
const recentLatencies = [];

const events = store.recentEvents(300);

function addEvent(severity, source, title, detail, plotId) {
  const e = { id: crypto.randomUUID(), ts: Date.now(), severity, source, plotId, title, detail };
  events.push(e);
  if (events.length > 300) events.shift();
  store.saveEvent(e);
  if (severity === 'warn' || severity === 'crit') counters.alerts++;
  broadcast({ type: 'event', event: e });
}

// ---------------------------------------------------------------- MQTT

const client = mqtt.connect(MQTT_URL, {
  clientId: 'agrosentinel-core',
  reconnectPeriod: 2000,
  will: { topic: 'agro/status/agrosentinel-core', payload: JSON.stringify({ online: false }), retain: true, qos: 1 },
});

client.on('connect', () => {
  broker.connected = true;
  client.subscribe(['agro/telemetry/+/+', 'agro/weather', 'agro/status/+', 'agro/actuator/irrigation/+', '$SYS/#'], { qos: 1 });
  addEvent('info', 'broker', 'Conectado ao broker MQTT', MQTT_URL);
});
client.on('close', () => {
  if (broker.connected) addEvent('crit', 'broker', 'Conexão com o broker MQTT perdida', 'Tentando reconectar…');
  broker.connected = false;
});
client.on('error', (err) => console.error('mqtt:', err.message));

client.on('message', (topic, buf) => {
  if (topic.startsWith('$SYS/')) {
    broker.sys[topic.slice(5)] = buf.toString();
    broker.sysTs = Date.now();
    return;
  }
  let msg;
  try { msg = JSON.parse(buf.toString()); } catch { return; }

  if (topic.startsWith('agro/telemetry/')) return onTelemetry(msg);
  if (topic === 'agro/weather') {
    counters.weather++;
    weather = msg;
    touchDevice(msg.deviceId, msg.ts);
    return;
  }
  if (topic.startsWith('agro/status/')) return onStatus(topic.split('/')[2], msg);
  if (topic.startsWith('agro/actuator/irrigation/')) return onActuator(topic.split('/')[3], msg);
});

function touchDevice(id, ts) {
  const d = devices.get(id);
  if (!d) return;
  const now = Date.now();
  d.lastSeen = now;
  d.msgTimes.push(now);
  if (ts) latencies.push(now - ts);
  if (!d.online) setOnline(d, true);
}

function setOnline(d, online) {
  d.online = online;
  addEvent(online ? 'ok' : 'crit', d.id, `${d.name} ${online ? 'online' : 'offline'}`,
    online ? 'Dispositivo enviando dados' : 'Sem comunicação com o dispositivo');
}

function onStatus(id, msg) {
  counters.status++;
  const d = devices.get(id);
  if (!d) return;
  d.status = msg;
  if (msg.online === false) {
    if (d.online) setOnline(d, false);
    return;
  }
  // Status retido de uma execução anterior não prova que o dispositivo está vivo
  if (msg.ts && Date.now() - msg.ts < OFFLINE_AFTER_MS) touchDevice(id);
}

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function onTelemetry(msg) {
  counters.telemetry++;
  touchDevice(msg.nodeId, msg.ts);
  const plot = plots.get(msg.plotId);
  if (!plot) return;

  plot.metrics = msg.metrics;
  plot.lastTs = msg.ts;
  plot.raw.push(msg.metrics);
  if (plot.raw.length > 6) plot.raw.shift();
  store.enqueueReading(msg.ts, plot.id, msg.metrics);

  // Suavização: média das últimas leituras (pragas usa janela maior por ser ruidosa)
  const smooth = {};
  for (const key of Object.keys(msg.metrics)) {
    const win = key === 'pests' ? plot.raw : plot.raw.slice(-3);
    smooth[key] = avg(win.map((r) => r[key]));
  }

  const crop = config.crops[plot.crop];
  const ev = evaluate(crop, smooth, config.metrics);
  counters.evaluations++;

  automateIrrigation(plot, smooth.soilMoisture, crop.ranges.soilMoisture);
  if (plot.valveFault) {
    const secs = Math.round((Date.now() - plot.valve.since) / 1000);
    ev.issues.unshift({
      metric: 'irrigation', severity: 'crit', title: 'Irrigação sem efeito',
      message: `Válvula aberta há ${secs}s sem aumento de umidade`,
      recommendation: 'Inspecionar válvula e linha de gotejamento em campo',
    });
    ev.status = 'crit';
    ev.score = Math.max(0, ev.score - 20);
  }
  plot.evaluation = ev;
  updateStatus(plot, ev);
}

function updateStatus(plot, ev) {
  if (plot.status === 'unknown') {
    plot.status = ev.status;
    return;
  }
  if (ev.status === plot.status) {
    plot.pendingStatus = null;
    plot.pendingCount = 0;
    return;
  }
  if (ev.status !== plot.pendingStatus) {
    plot.pendingStatus = ev.status;
    plot.pendingCount = 0;
  }
  if (++plot.pendingCount < STATUS_DEBOUNCE) return;

  const prev = plot.status;
  plot.status = ev.status;
  plot.pendingStatus = null;
  const label = `${plot.id} · ${plot.cropName}`;
  if (ev.status === 'ok') {
    addEvent('ok', 'regras', `${label} voltou ao normal`, 'Todos os indicadores dentro da faixa ideal', plot.id);
  } else if (RANK[ev.status] > RANK[prev]) {
    const top = ev.issues[0];
    addEvent(ev.status, 'regras',
      `${label}: ${ev.status === 'crit' ? 'situação crítica' : 'precisa de atenção'}`,
      top ? `${top.title} — ${top.message}` : '', plot.id);
  }
}

// ---------------------------------------------------------------- automação

function sendIrrigation(plot, action, reason, source) {
  const cmd = { cmdId: crypto.randomUUID().slice(0, 8), action, reason, source, ts: Date.now() };
  plot.valve.pending = cmd;
  counters.commands++;
  client.publish(`agro/cmd/irrigation/${plot.id}`, JSON.stringify(cmd), { qos: 1 });
  addEvent('info', source === 'manual' ? 'operador' : 'automação',
    `${action === 'open' ? 'Abrindo' : 'Fechando'} irrigação em ${plot.id} · ${plot.cropName}`, reason, plot.id);
  return cmd;
}

function automateIrrigation(plot, moisture, [lo, hi]) {
  const v = plot.valve;
  const now = Date.now();

  if (v.pending && now - v.pending.ts > CMD_TIMEOUT_MS) {
    addEvent('warn', 'atuador-irrigacao', `Atuador não respondeu ao comando em ${plot.id}`,
      `Comando ${v.pending.cmdId} (${v.pending.action}) sem confirmação após ${CMD_TIMEOUT_MS / 1000}s`, plot.id);
    v.pending = null;
  }

  if (v.open && now - v.since > VALVE_FAULT_AFTER_MS && moisture <= v.startMoisture + 1) {
    if (!plot.valveFault) {
      plot.valveFault = true;
      addEvent('crit', 'regras', `Possível falha de irrigação em ${plot.id} · ${plot.cropName}`,
        'Válvula aberta mas a umidade do solo não está subindo', plot.id);
    }
  } else if (plot.valveFault && (!v.open || moisture > v.startMoisture + 1)) {
    plot.valveFault = false;
  }

  if (v.pending || now < plot.manualHoldUntil) return;
  const target = lo + 0.7 * (hi - lo);
  if (!v.open && moisture < lo + 1) {
    sendIrrigation(plot, 'open', `Automático: umidade ${moisture.toFixed(1)}% (mín. ${lo}%)`, 'auto');
  } else if (v.open && moisture >= target) {
    sendIrrigation(plot, 'close', `Automático: umidade atingiu ${moisture.toFixed(1)}%`, 'auto');
  }
}

function onActuator(plotId, msg) {
  counters.actuator++;
  touchDevice(msg.deviceId);
  const plot = plots.get(plotId);
  if (!plot) return;
  const v = plot.valve;
  if (msg.open && !v.open) {
    v.since = Date.now();
    v.startMoisture = plot.raw.length ? avg(plot.raw.slice(-3).map((r) => r.soilMoisture)) : 0;
  }
  v.open = !!msg.open;
  v.flowLpm = msg.flowLpm || 0;
  if (v.pending && msg.cmdId === v.pending.cmdId) {
    cmdLatencies.push(Date.now() - v.pending.ts);
    if (cmdLatencies.length > 50) cmdLatencies.shift();
    v.pending = null;
  }
}

// ---------------------------------------------------------------- métricas

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

setInterval(() => {
  const now = Date.now();
  counters.dbWrites += store.flush();

  for (const d of devices.values()) {
    d.msgTimes = d.msgTimes.filter((t) => now - t < 60000);
    if (d.online && now - d.lastSeen > OFFLINE_AFTER_MS) setOnline(d, false);
  }

  const delta = {};
  for (const k of Object.keys(counters)) delta[k] = counters[k] - lastCounters[k];
  lastCounters = { ...counters };
  // Taxas por segundo em janela deslizante de 5s (os dispositivos publicam em rajadas)
  recentDeltas.push(delta);
  if (recentDeltas.length > 5) recentDeltas.shift();
  recentLatencies.push(latencies);
  if (recentLatencies.length > 5) recentLatencies.shift();
  latencies = [];
  const sorted = recentLatencies.flat().sort((a, b) => a - b);

  rates = {};
  for (const k of Object.keys(delta)) {
    rates[k] = +(recentDeltas.reduce((s, d) => s + d[k], 0) / recentDeltas.length).toFixed(1);
  }
  rates.mqttIn = +(rates.telemetry + rates.weather + rates.status + rates.actuator).toFixed(1);
  rates.latencyAvg = sorted.length ? Math.round(avg(sorted)) : 0;
  rates.latencyP95 = Math.round(percentile(sorted, 0.95));
  timeline.push({ t: now, ...rates });
  if (timeline.length > 180) timeline.shift();

  broadcast({ type: 'state', state: buildState() });
}, 1000);

setInterval(() => store.prune(), 10 * 60 * 1000);

// ---------------------------------------------------------------- estado público

function plotView(p) {
  // Sem leituras recentes, o talhão não está sendo monitorado: isso por si só exige atenção
  const stale = p.lastTs && Date.now() - p.lastTs > OFFLINE_AFTER_MS;
  const issues = stale
    ? [{
      metric: 'connectivity', severity: 'crit', title: 'Sem comunicação com o sensor',
      message: `Última leitura há ${Math.round((Date.now() - p.lastTs) / 1000)}s (${p.nodeId} offline)`,
      recommendation: 'Verificar energia e antena do gateway em campo',
    }, ...p.evaluation.issues]
    : p.evaluation.issues;
  return {
    id: p.id, nodeId: p.nodeId, crop: p.crop, cropName: p.cropName, color: p.color,
    variety: p.variety, areaHa: p.areaHa, daysPlanted: p.daysPlanted,
    status: stale ? 'crit' : p.status, score: stale ? 0 : p.evaluation.score, issues, stale: !!stale,
    checks: p.evaluation.checks, metrics: p.metrics, lastTs: p.lastTs,
    valve: { open: p.valve.open, flowLpm: p.valve.flowLpm, since: p.valve.since, pending: !!p.valve.pending },
    manualHold: Date.now() < p.manualHoldUntil,
  };
}

function buildState() {
  const now = Date.now();
  const list = [...plots.values()].map(plotView);
  const known = list.filter((p) => p.status !== 'unknown');
  const sys = broker.sys;
  const storeStats = store.stats();

  return {
    ts: now,
    farm: {
      ...config.farm,
      plots: list.length,
      healthy: known.filter((p) => p.status === 'ok').length,
      warn: known.filter((p) => p.status === 'warn').length,
      crit: known.filter((p) => p.status === 'crit').length,
      avgScore: known.length ? Math.round(avg(known.map((p) => p.score))) : 0,
      irrigating: list.filter((p) => p.valve.open).length,
    },
    weather,
    plots: list,
    devices: [...devices.values()].map((d) => ({
      id: d.id, kind: d.kind, name: d.name, online: d.online,
      lastSeenAgoMs: d.lastSeen ? now - d.lastSeen : null,
      msgsPerMin: d.msgTimes.length,
      battery: d.status?.battery ?? null, rssi: d.status?.rssi ?? null,
      firmware: d.status?.firmware ?? null, uptimeS: d.status?.uptimeS ?? null,
      plots: d.status?.plots ?? null, openValves: d.status?.openValves ?? null,
    })),
    services: {
      broker: {
        online: broker.connected && now - broker.sysTs < 20000,
        version: sys['broker/version'] || null,
        clients: Number(sys['broker/clients/connected'] || 0),
        uptime: sys['broker/uptime'] || null,
        msgsRecv1m: Number(sys['broker/load/messages/received/1min'] || 0),
        msgsSent1m: Number(sys['broker/load/messages/sent/1min'] || 0),
        retained: Number(sys['broker/retained messages/count'] || 0),
      },
      ingest: { online: broker.connected, totalMsgs: counters.telemetry + counters.weather + counters.status + counters.actuator },
      rules: {
        online: true, evaluations: counters.evaluations, alerts: counters.alerts,
        activeAlerts: known.filter((p) => p.status !== 'ok').length,
      },
      automation: {
        online: true, commands: counters.commands,
        cmdLatencyAvg: cmdLatencies.length ? Math.round(avg(cmdLatencies)) : null,
      },
      storage: { online: true, engine: 'SQLite (WAL)', ...storeStats, writes: counters.dbWrites, lastFlushMs: +store.lastFlushMs.toFixed(2) },
      api: { online: true, wsClients: wss ? wss.clients.size : 0, httpReqs: counters.httpReqs },
    },
    flow: { rates, timeline: timeline.slice(-120) },
    uptimeS: Math.round((now - startedAt) / 1000),
  };
}

// ---------------------------------------------------------------- HTTP + WS

const app = express();
app.use(express.json());
app.use((req, res, next) => { counters.httpReqs++; next(); });

app.get('/api/health', (req, res) => res.json({ ok: true, mqtt: broker.connected, uptimeS: Math.round((Date.now() - startedAt) / 1000) }));
app.get('/api/config', (req, res) => res.json(config));
app.get('/api/state', (req, res) => res.json(buildState()));
app.get('/api/events', (req, res) => res.json(events.slice(-Math.min(300, Number(req.query.limit) || 100))));

app.get('/api/plots/:id/history', (req, res) => {
  if (!plots.has(req.params.id)) return res.status(404).json({ error: 'talhão não encontrado' });
  const minutes = Math.min(360, Number(req.query.minutes) || 15);
  res.json(store.history(req.params.id, Date.now() - minutes * 60000));
});

app.post('/api/plots/:id/irrigation', (req, res) => {
  const plot = plots.get(req.params.id);
  if (!plot) return res.status(404).json({ error: 'talhão não encontrado' });
  const action = req.body?.action;
  if (!['open', 'close'].includes(action)) return res.status(400).json({ error: 'action deve ser open ou close' });
  if (!broker.connected) return res.status(503).json({ error: 'broker MQTT indisponível' });
  plot.manualHoldUntil = Date.now() + 60000; // suspende a automação por 1 min
  const cmd = sendIrrigation(plot, action, `Comando manual do operador (automação pausada por 60s)`, 'manual');
  res.json({ ok: true, cmdId: cmd.cmdId });
});

const server = http.createServer(app);
wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === 1) { ws.send(data); counters.wsOut++; }
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', config, state: buildState(), events: events.slice(-150) }));
});

server.listen(PORT, () => {
  console.log(`AgroSentinel core ouvindo na porta ${PORT}`);
  addEvent('info', 'core', 'Serviço central iniciado', `Banco: ${DB_PATH}`);
});
