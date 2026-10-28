// AgroSentinel — núcleo compartilhado por todas as páginas do painel:
// conexão WebSocket, utilidades, barra superior, notificações e detalhe do talhão.
(function () {
  const $ = (sel) => document.querySelector(sel);
  const app = {
    config: null,
    state: null,
    events: [],
    flowBuilt: false,
    drawer: { plotId: null, metric: 'soilMoisture', minutes: 15, timer: null },
    seenEvents: new Set(),
  };
  let page = null;

  // ---------------------------------------------------------------- utilidades
  const ICON = {
    ok: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 8v5"/><path d="M12 16.5v.5"/><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    crit: '<svg viewBox="0 0 24 24"><path d="M15 9l-6 6M9 9l6 6"/><circle cx="12" cy="12" r="9.5"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    drop: '<svg viewBox="0 0 24 24"><path d="M12 2.5s7 7.6 7 12.5a7 7 0 0 1-14 0c0-4.9 7-12.5 7-12.5z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    sun: '<svg viewBox="0 0 24 24" stroke="#f2b33d"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" stroke="#a3b8b0"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.6 6.6 0 0 0 10.5 10.5z"/></svg>',
    rain: '<svg viewBox="0 0 24 24" stroke="#4cc3f0"><path d="M7 15a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 7.5a4 4 0 0 1-1 7.5H7z"/><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    therm: '<svg viewBox="0 0 24 24"><path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/></svg>',
    hum: '<svg viewBox="0 0 24 24"><path d="M12 3s6 6.5 6 10.8a6 6 0 0 1-12 0C6 9.5 12 3 12 3z"/></svg>',
    wind: '<svg viewBox="0 0 24 24"><path d="M3 8h11a3 3 0 1 0-3-3M3 16h15a3 3 0 1 1-3 3M3 12h8"/></svg>',
    leaf: '<svg viewBox="0 0 24 24"><path d="M5 19c0-9 6-14 15-14 0 9-6 15-14 15"/><path d="M5 20l7-7"/></svg>',
  };
  const STATUS_LABEL = { ok: 'Saudável', warn: 'Atenção', crit: 'Crítico', unknown: 'Aguardando', info: 'Info' };
  const HISTORY_METRICS = ['soilMoisture', 'ndvi', 'ph', 'ec', 'soilTemp', 'pests', 'airTemp'];
  const KIND_LABEL = { 'field-node': 'Nó de campo (LoRa)', weather: 'Estação meteorológica', actuator: 'Atuador de irrigação' };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const badge = (status, label) => `<span class="badge ${status}">${ICON[status] || ''}${esc(label || STATUS_LABEL[status] || status)}</span>`;
  const meta = (k) => app.config.metrics[k];
  const crop = (p) => app.config.crops[p.crop];
  const initials = (name) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 2).toUpperCase();
  const timeStr = (ts) => new Date(ts).toLocaleTimeString('pt-BR');
  const scoreColor = (s) => (s >= 85 ? 'var(--ok)' : s >= 60 ? 'var(--warn)' : 'var(--crit)');

  function ago(ms) {
    if (ms == null) return '—';
    if (ms < 1500) return 'agora';
    if (ms < 60000) return `${Math.round(ms / 1000)}s atrás`;
    return `${Math.round(ms / 60000)} min atrás`;
  }
  function uptime(s) {
    if (s == null) return '—';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${m}min` : m ? `${m}min ${s % 60}s` : `${s}s`;
  }
  const brokerUptime = (sv) => (sv.broker.uptime ? uptime(parseInt(sv.broker.uptime, 10)) : '—');
  function simClock(h) {
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  function signal(rssi) {
    if (rssi == null) return '—';
    const bars = rssi > -70 ? 4 : rssi > -80 ? 3 : rssi > -90 ? 2 : 1;
    return `<span class="signal">${[1, 2, 3, 4].map((i) => `<i class="${i <= bars ? 'on' : ''}" style="height:${3 + i * 2.2}px"></i>`).join('')}</span>${rssi} dBm`;
  }
  const sortBySeverity = (a, b) => ({ crit: 0, warn: 1, ok: 2, unknown: 3 }[a.status] - { crit: 0, warn: 1, ok: 2, unknown: 3 }[b.status]) || a.score - b.score;

  function issueList(issues, max = 3) {
    return issues.slice(0, max).map((i) => `<div class="issue ${i.severity}">${ICON[i.severity]}
      <div><div><b>${esc(i.title)}</b> · <span class="t2">${esc(i.message)}</span></div><div class="rec">${esc(i.recommendation)}</div></div></div>`).join('');
  }

  function eventRow(e) {
    const sev = e.severity === 'ok' ? 'ok' : e.severity;
    const fresh = Date.now() - e.ts < 2500 ? 'new' : '';
    return `<div class="ev ${fresh}">
      <div class="ev-time">${timeStr(e.ts)}</div>
      <div class="ev-ico ${sev}">${ICON[sev] || ICON.info}</div>
      <div><div class="ev-title">${esc(e.title)}</div>${e.detail ? `<div class="ev-detail">${esc(e.detail)}</div>` : ''}</div>
      <span class="ev-src">${esc(e.source)}</span>
    </div>`;
  }

  // ---------------------------------------------------------------- conexão
  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    const conn = $('#conn');
    ws.onopen = () => { conn.className = 'conn live'; $('#conn-label').textContent = 'Ao vivo · conectado'; };
    ws.onclose = () => {
      conn.className = 'conn down';
      $('#conn-label').textContent = 'Desconectado · reconectando…';
      setTimeout(connect, 2000);
    };
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.type === 'hello') {
        app.config = data.config;
        app.events = data.events;
        data.events.forEach((e) => app.seenEvents.add(e.id));
        $('#farm-name').textContent = app.config.farm.name;
        $('#farm-loc').textContent = `${app.config.farm.location} · ${num(app.config.farm.areaHa)} ha`;
        app.flowBuilt = false;
        app.planBuilt = false;
        onState(data.state);
      } else if (data.type === 'state') {
        onState(data.state);
      } else if (data.type === 'event') {
        onEvent(data.event);
      }
    };
  }

  function onState(state) {
    app.state = state;
    renderChrome();
    render();
    if (app.drawer.plotId) updateDrawer();
  }

  function onEvent(e) {
    if (app.seenEvents.has(e.id)) return;
    app.seenEvents.add(e.id);
    app.events.push(e);
    if (app.events.length > 300) app.events.shift();
    if (e.severity === 'crit') toast(e);
    if (page && page.liveEvents) render();
  }

  function toast(e) {
    const el = document.createElement('div');
    el.className = `toast ${e.severity}`;
    el.innerHTML = `<b>${esc(e.title)}</b><span>${esc(e.detail || '')}</span>`;
    $('#toasts').appendChild(el);
    while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
    setTimeout(() => el.remove(), 7000);
  }

  // ---------------------------------------------------------------- moldura
  function renderChrome() {
    const s = app.state;
    const w = s.weather;
    $('#weather-chips').innerHTML = w ? `
      <span class="chip">${ICON.clock}Hora simulada <b>${simClock(w.simHour)}</b></span>
      <span class="chip">${ICON.therm}<b>${num(w.airTemp)} °C</b></span>
      <span class="chip">${ICON.hum}<b>${num(w.airHumidity, 0)}%</b> UR</span>
      <span class="chip">${w.rainMmH > 0 ? ICON.rain + `<b>${num(w.rainMmH)} mm/h</b>` : ICON.wind + `<b>${num(w.windKmh)} km/h</b>`}</span>
    ` : '<span class="chip">Aguardando estação meteorológica…</span>';

    const attention = s.farm.warn + s.farm.crit;
    const nb = $('#nav-badge-crops');
    nb.hidden = attention === 0;
    nb.textContent = attention;
    nb.className = `nav-badge ${s.farm.crit ? 'crit' : ''}`;
  }

  function render() {
    if (app.state && page) page.render();
  }

  // ---------------------------------------------------------------- detalhe do talhão
  function openDrawer(plotId) {
    const p = app.state.plots.find((x) => x.id === plotId);
    if (!p) return;
    app.drawer.plotId = plotId;
    const dr = $('#drawer');
    dr.innerHTML = `
      <div class="drawer-head">
        <div class="crop-avatar" style="background:${p.color};width:46px;height:46px;font-size:15px">${initials(p.cropName)}</div>
        <div class="grow"><h2>${esc(p.cropName)} <span class="plot-id" style="font-size:13px">${p.id}</span> <span id="dr-badge"></span></h2>
          <div class="muted" style="font-size:13px">${esc(p.variety)} · ${esc(app.config.nodes.find((n) => n.id === p.nodeId).name)}</div></div>
        <button class="icon-btn" data-close aria-label="Fechar">${ICON.close}</button>
      </div>
      <div class="drawer-body">
        <div class="facts">
          <div class="fact"><div class="k">Saúde</div><div class="v" id="dr-score">—</div></div>
          <div class="fact"><div class="k">Área</div><div class="v">${num(p.areaHa)} ha</div></div>
          <div class="fact"><div class="k">Dias após plantio</div><div class="v">${p.daysPlanted}</div></div>
          <div class="fact"><div class="k">Última leitura</div><div class="v" id="dr-last">—</div></div>
        </div>
        <div><div class="section-title">Diagnóstico e recomendações</div><div id="dr-issues"></div></div>
        <div><div class="section-title">Irrigação</div><div id="dr-irrigation"></div></div>
        <div><div class="section-title">Indicadores atuais vs. faixa ideal</div><div class="metrics" id="dr-metrics"></div></div>
        <div>
          <div class="section-title">Histórico</div>
          <div class="tabs" id="dr-tabs">${HISTORY_METRICS.map((k) => `<button data-metric="${k}" class="${k === app.drawer.metric ? 'active' : ''}">${esc(meta(k).label.replace(' (nutrientes)', ''))}</button>`).join('')}</div>
          <div class="tabs" id="dr-range">${[15, 60, 180].map((m) => `<button data-min="${m}" class="${m === app.drawer.minutes ? 'active' : ''}">${m < 60 ? m + ' min' : m / 60 + ' h'}</button>`).join('')}</div>
          <div id="dr-chart"></div>
        </div>
      </div>`;
    dr.classList.add('open');
    dr.setAttribute('aria-hidden', 'false');
    $('#scrim').hidden = false;
    updateDrawer();
    loadHistory();
    clearInterval(app.drawer.timer);
    app.drawer.timer = setInterval(loadHistory, 5000);
  }

  function closeDrawer() {
    app.drawer.plotId = null;
    clearInterval(app.drawer.timer);
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    $('#scrim').hidden = true;
  }

  function updateDrawer() {
    const p = app.state.plots.find((x) => x.id === app.drawer.plotId);
    if (!p || !$('#dr-metrics')) return;
    const c = crop(p);
    $('#dr-badge').innerHTML = badge(p.status);
    $('#dr-score').innerHTML = `<span style="color:${scoreColor(p.score)}">${p.score}</span>/100`;
    $('#dr-last').textContent = p.lastTs ? ago(Date.now() - p.lastTs) : '—';

    $('#dr-issues').innerHTML = p.issues.length
      ? `<div class="alert-item ${p.status}" style="cursor:default">${issueList(p.issues, 10)}</div>`
      : `<div class="alert-item" style="--sev:var(--ok);cursor:default"><div class="issue ok"><svg viewBox="0 0 24 24" style="stroke:var(--ok)"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><div><b>Lavoura saudável</b> · <span class="t2">todos os indicadores dentro da faixa ideal para ${esc(p.cropName.toLowerCase())}.</span></div></div></div>`;

    const v = p.valve;
    const [lo, hi] = c.ranges.soilMoisture;
    $('#dr-irrigation').innerHTML = `<div class="irrigation">
      <div class="crop-avatar" style="background:${v.open ? 'var(--water)' : 'var(--surface-3)'};color:${v.open ? '#04202b' : 'var(--muted)'}"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2.5s7 7.6 7 12.5a7 7 0 0 1-14 0c0-4.9 7-12.5 7-12.5z"/></svg></div>
      <div class="grow"><div class="row-title">Válvula ${v.open ? 'aberta' : 'fechada'} ${v.pending ? '<span class="badge info">aguardando atuador…</span>' : ''}</div>
        <div class="row-sub">${v.open ? `${num(v.flowLpm)} L/min · há ${uptime(Math.round((Date.now() - v.since) / 1000))}` : `Abre automaticamente abaixo de ${lo}% de umidade`}${p.manualHold ? ' · automação pausada (comando manual)' : ' · modo automático'}</div></div>
      <button class="btn ${v.open ? '' : 'primary'}" data-irrigate="${v.open ? 'close' : 'open'}" ${v.pending ? 'disabled' : ''}>${v.open ? 'Fechar válvula' : 'Abrir válvula'}</button>
    </div>`;

    $('#dr-metrics').innerHTML = Object.keys(app.config.metrics).map((k) => {
      const m = meta(k);
      const chk = p.checks[k];
      const val = p.metrics?.[k];
      const [rlo, rhi] = c.ranges[k];
      const dmin = Math.max(0, rlo - m.tolerance * 2);
      const dmax = rhi + m.tolerance * 2;
      const pct = (x) => Math.min(100, Math.max(0, ((x - dmin) / (dmax - dmin)) * 100));
      return `<div class="metric ${chk ? chk.status : ''}">
        <div class="metric-top"><span class="metric-label">${esc(m.label)}</span>${chk && chk.status !== 'ok' ? badge(chk.status) : ''}</div>
        <div class="metric-value">${num(val, m.decimals)}<small>${esc(m.unit)}</small></div>
        <div class="range"><div class="ideal" style="left:${pct(rlo)}%;width:${pct(rhi) - pct(rlo)}%"></div><div class="marker" style="left:${val == null ? 0 : pct(val)}%"></div></div>
        <div class="range-labels"><span>${num(dmin, m.decimals > 1 ? 1 : m.decimals)}</span><span>ideal ${rlo}–${rhi}</span><span>${num(dmax, m.decimals > 1 ? 1 : m.decimals)}</span></div>
      </div>`;
    }).join('');
  }

  async function loadHistory(force) {
    const id = app.drawer.plotId;
    if (!id) return;
    try {
      const res = await fetch(`/api/plots/${id}/history?minutes=${app.drawer.minutes}`);
      const rows = await res.json();
      if (id !== app.drawer.plotId) return;
      const p = app.state.plots.find((x) => x.id === id);
      const k = app.drawer.metric;
      const m = meta(k);
      Charts.lineChart($('#dr-chart'), {
        points: rows.map((r) => [r.ts, r[k]]), color: p.color, label: m.label, unit: m.unit,
        decimals: m.decimals, band: crop(p).ranges[k], height: 200, force,
      });
    } catch (err) {
      console.error(err);
    }
  }

  async function irrigate(action) {
    const id = app.drawer.plotId;
    try {
      const res = await fetch(`/api/plots/${id}/irrigation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
    } catch (err) {
      toast({ severity: 'crit', title: 'Falha ao enviar comando', detail: err.message });
    }
  }

  // ---------------------------------------------------------------- eventos de interface
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-plot],[data-close],[data-irrigate],[data-metric],[data-min]');
    if (!t) return;
    if (t.dataset.plot) return openDrawer(t.dataset.plot);
    if (t.hasAttribute('data-close')) return closeDrawer();
    if (t.dataset.irrigate) return irrigate(t.dataset.irrigate);
    if (t.dataset.metric) {
      app.drawer.metric = t.dataset.metric;
      document.querySelectorAll('#dr-tabs button').forEach((b) => b.classList.toggle('active', b === t));
      return loadHistory(true);
    }
    if (t.dataset.min) {
      app.drawer.minutes = Number(t.dataset.min);
      document.querySelectorAll('#dr-range button').forEach((b) => b.classList.toggle('active', b === t));
      return loadHistory(true);
    }
  });
  $('#scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  window.AG = {
    app, $, ICON, KIND_LABEL, esc, num, badge, meta, crop, initials, timeStr, scoreColor,
    ago, uptime, brokerUptime, simClock, signal, sortBySeverity, issueList, eventRow, render,
    /** Cada página chama start() com { render, liveEvents } para iniciar a conexão. */
    start(p) {
      page = p;
      connect();
    },
  };
})();
