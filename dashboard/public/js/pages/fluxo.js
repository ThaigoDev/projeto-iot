// Página "Fluxo do sistema": fluxograma vivo, vazão, latência, serviços e dispositivos.
(function () {
  const { app, $, esc, num, badge, KIND_LABEL, ago, uptime, brokerUptime, signal, eventRow } = window.AG;

  const PIPE = {
    devices: [
      { id: 'node-norte', y: 44 }, { id: 'node-sul', y: 100 }, { id: 'node-leste', y: 156 },
      { id: 'node-oeste', y: 212 }, { id: 'estacao-meteo', y: 268 }, { id: 'atuador-irrigacao', y: 346 },
    ],
    boxes: {
      broker: { x: 268, y: 150, w: 170, h: 100, title: 'Broker MQTT', sub: 'Eclipse Mosquitto' },
      ingest: { x: 500, y: 44, w: 200, h: 66, title: 'Ingestão', sub: 'Node.js · validação + latência' },
      rules: { x: 500, y: 168, w: 200, h: 66, title: 'Motor de regras', sub: 'Faixas ideais por cultura' },
      automation: { x: 500, y: 292, w: 200, h: 66, title: 'Automação de irrigação', sub: 'Controle em malha fechada' },
      storage: { x: 762, y: 44, w: 180, h: 66, title: 'Persistência', sub: 'SQLite · modo WAL' },
      api: { x: 762, y: 168, w: 180, h: 66, title: 'API + WebSocket', sub: 'REST /api · push /ws' },
      dashboard: { x: 982, y: 168, w: 126, h: 66, title: 'Painel web', sub: 'Nginx' },
    },
  };

  function edgePath(x1, y1, x2, y2) {
    const dx = Math.max(30, (x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }

  function buildPipeline() {
    const B = PIPE.boxes;
    const edges = [];
    const dw = 184, dh = 44, dx = 22;
    for (const d of PIPE.devices) {
      if (d.id === 'atuador-irrigacao') {
        edges.push({ id: `e-${d.id}`, d: edgePath(B.broker.x + 30, B.broker.y + B.broker.h, dx + dw, d.y + dh / 2).replace(/C.*/, '') + ` C${B.broker.x + 30},${d.y + dh / 2} ${B.broker.x + 30},${d.y + dh / 2} ${dx + dw},${d.y + dh / 2}`, cmd: true });
      } else {
        edges.push({ id: `e-${d.id}`, d: edgePath(dx + dw, d.y + dh / 2, B.broker.x, B.broker.y + B.broker.h / 2) });
      }
    }
    const R = (b) => [b.x + b.w, b.y + b.h / 2];
    const L = (b) => [b.x, b.y + b.h / 2];
    edges.push({ id: 'e-broker-ingest', d: edgePath(...R(B.broker), ...L(B.ingest)) });
    edges.push({ id: 'e-ingest-rules', d: `M${B.ingest.x + 100},${B.ingest.y + B.ingest.h} L${B.rules.x + 100},${B.rules.y}` });
    edges.push({ id: 'e-rules-automation', d: `M${B.rules.x + 100},${B.rules.y + B.rules.h} L${B.automation.x + 100},${B.automation.y}`, cmd: true });
    edges.push({ id: 'e-automation-broker', d: `M${B.automation.x},${B.automation.y + B.automation.h / 2} C${B.automation.x - 40},${B.automation.y + B.automation.h / 2} ${B.broker.x + B.broker.w - 30},${B.automation.y + 30} ${B.broker.x + B.broker.w - 30},${B.broker.y + B.broker.h}`, cmd: true });
    edges.push({ id: 'e-ingest-storage', d: edgePath(...R(B.ingest), ...L(B.storage)) });
    edges.push({ id: 'e-rules-api', d: edgePath(...R(B.rules), ...L(B.api)) });
    edges.push({ id: 'e-api-dashboard', d: edgePath(...R(B.api), ...L(B.dashboard)) });

    const lanes = [
      { x: 10, w: 204, label: 'CAMPO · DISPOSITIVOS FÍSICOS' },
      { x: 250, w: 206, label: 'COMUNICAÇÃO' },
      { x: 484, w: 232, label: 'PROCESSAMENTO' },
      { x: 746, w: 372, label: 'DADOS & APRESENTAÇÃO' },
    ];
    const names = Object.fromEntries(app.state.devices.map((d) => [d.id, d.name]));

    let svg = '<svg class="pipeline" viewBox="0 0 1120 410" role="img" aria-label="Fluxograma do sistema">';
    for (const l of lanes) {
      svg += `<rect class="lane" x="${l.x}" y="8" width="${l.w}" height="396" rx="12"/>`;
      svg += `<text class="lane-label" x="${l.x + 12}" y="28">${l.label}</text>`;
    }
    for (const e of edges) {
      svg += `<path class="edge" d="${e.d}"/><path class="edge-flow ${e.cmd ? 'cmd' : ''} idle" id="${e.id}" d="${e.d}"/>`;
    }
    svg += `<text class="edge-label" x="${B.broker.x + B.broker.w + 14}" y="${B.ingest.y + B.ingest.h + 30}" id="lbl-mqtt"></text>`;
    svg += `<text class="edge-label" x="${B.broker.x + 40}" y="${B.automation.y + 70}">comandos de válvula</text>`;
    svg += `<text class="edge-label" x="${B.ingest.x + 108}" y="${B.ingest.y + B.ingest.h + 32}">avaliar</text>`;
    svg += `<text class="edge-label" x="${B.rules.x + 108}" y="${B.rules.y + B.rules.h + 32}">acionar</text>`;
    svg += `<text class="edge-label" x="${B.ingest.x + B.ingest.w + 8}" y="${B.ingest.y + 26}" id="lbl-db"></text>`;
    for (const d of PIPE.devices) {
      svg += `<g><rect class="box" id="b-${d.id}" x="${dx}" y="${d.y}" width="${dw}" height="${dh}" rx="9"/>
        <circle class="sdot ok" id="s-${d.id}" cx="${dx + dw - 14}" cy="${d.y + 14}" r="4"/>
        <text class="box-title" x="${dx + 12}" y="${d.y + 18}">${esc(names[d.id] || d.id)}</text>
        <text class="box-metric" id="m-${d.id}" x="${dx + 12}" y="${d.y + 34}"></text></g>`;
    }
    for (const [id, b] of Object.entries(B)) {
      svg += `<g><rect class="box core" id="b-${id}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="11"/>
        <circle class="sdot ok" id="s-${id}" cx="${b.x + b.w - 14}" cy="${b.y + 15}" r="4"/>
        <text class="box-title" x="${b.x + 14}" y="${b.y + 22}">${b.title}</text>
        <text class="box-sub" x="${b.x + 14}" y="${b.y + 38}" id="sub-${id}">${b.sub}</text>
        <text class="box-metric" id="m-${id}" x="${b.x + 14}" y="${b.y + 56}"></text>
        ${id === 'broker' ? `<text class="box-metric" id="m2-broker" x="${b.x + 14}" y="${b.y + 74}"></text><text class="box-metric" id="m3-broker" x="${b.x + 14}" y="${b.y + 90}"></text>` : ''}</g>`;
    }
    svg += '</svg>';
    return svg;
  }

  function setEdge(id, rate, broken) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('broken', !!broken);
    el.classList.toggle('idle', !broken && !(rate > 0));
    if (rate > 0) el.style.setProperty('--speed', `${Math.max(0.45, 2.4 - Math.log2(rate + 1) * 0.45).toFixed(2)}s`);
  }
  function setBox(id, online, metric) {
    const box = document.getElementById(`b-${id}`);
    if (!box) return;
    box.classList.toggle('off', !online);
    document.getElementById(`s-${id}`).setAttribute('class', `sdot ${online ? 'ok' : 'off'}`);
    const m = document.getElementById(`m-${id}`);
    if (m) m.textContent = online ? metric : 'OFFLINE';
  }

  function updatePipeline() {
    const s = app.state;
    const r = s.flow.rates || {};
    const sv = s.services;
    const dev = Object.fromEntries(s.devices.map((d) => [d.id, d]));
    const brokerOn = sv.broker.online;

    for (const d of PIPE.devices) {
      const info = dev[d.id];
      const online = info && info.online;
      if (d.id === 'atuador-irrigacao') {
        setBox(d.id, online, `${info?.openValves ?? 0} válvulas abertas`);
        setEdge(`e-${d.id}`, r.commands * 5, !online || !brokerOn);
      } else {
        setBox(d.id, online, `${info?.msgsPerMin ?? 0} msg/min`);
        setEdge(`e-${d.id}`, (info?.msgsPerMin || 0) / 60, !online || !brokerOn);
      }
    }
    setBox('broker', brokerOn, `${sv.broker.clients} clientes conectados`);
    document.getElementById('m2-broker').textContent = brokerOn ? `${num(sv.broker.msgsRecv1m, 0)} msg/min entrada` : '';
    document.getElementById('m3-broker').textContent = brokerOn ? `${sv.broker.retained} msgs retidas` : '';
    if (sv.broker.version) document.getElementById('sub-broker').textContent = sv.broker.version.replace('mosquitto version', 'Mosquitto');
    setBox('ingest', sv.ingest.online, `${num(r.mqttIn)} msg/s · ${r.latencyAvg ?? 0} ms`);
    setBox('rules', true, `${num(r.evaluations)} aval/s · ${sv.rules.activeAlerts} alertas`);
    setBox('automation', true, `${sv.automation.commands} comandos · ${sv.automation.cmdLatencyAvg ?? '—'} ms`);
    setBox('storage', true, `${sv.storage.rows.toLocaleString('pt-BR')} registros`);
    setBox('api', true, `${sv.api.wsClients} cliente(s) WS`);
    setBox('dashboard', sv.api.wsClients > 0, 'ao vivo');

    setEdge('e-broker-ingest', r.mqttIn, !brokerOn);
    setEdge('e-ingest-rules', r.evaluations, !brokerOn);
    setEdge('e-ingest-storage', r.dbWrites);
    setEdge('e-rules-api', r.wsOut);
    setEdge('e-api-dashboard', r.wsOut);
    setEdge('e-rules-automation', r.commands * 5);
    setEdge('e-automation-broker', r.commands * 5, !brokerOn);
    document.getElementById('lbl-mqtt').textContent = `${num(r.mqttIn)} msg/s`;
    document.getElementById('lbl-db').textContent = `${num(r.dbWrites)} grav/s`;
  }

  function renderFlow() {
    const s = app.state;
    const r = s.flow.rates || {};
    const sv = s.services;
    const root = $('#page');
    if (!app.flowBuilt) {
      root.innerHTML = `
        <div class="grid g-kpi" id="flow-kpis"></div>
        <div class="card"><div class="card-head"><div><h3>Fluxograma em tempo real</h3><div class="sub">A velocidade das partículas acompanha a vazão de mensagens · vermelho = etapa interrompida</div></div>
          <div class="legend" style="margin:0"><span><i style="background:var(--accent)"></i>dados</span><span><i style="background:var(--water)"></i>comandos</span><span><i style="background:var(--crit)"></i>falha</span></div></div>
          <div class="card-body" style="overflow-x:auto"><div style="min-width:760px">${buildPipeline()}</div></div></div>
        <div class="grid g-flow">
          <div class="card"><div class="card-head"><h3>Vazão de mensagens MQTT</h3><span class="sub">msg/s · últimos 2 min</span></div><div class="card-body"><div id="ch-throughput"></div></div></div>
          <div class="card"><div class="card-head"><h3>Latência ponta a ponta</h3><span class="sub">sensor → serviço central · média em ms</span></div><div class="card-body"><div id="ch-latency"></div></div></div>
        </div>
        <div class="card"><div class="card-head"><h3>Serviços</h3><span class="sub">containers de infraestrutura</span></div><div class="card-body"><div class="svc-grid" id="flow-services"></div></div></div>
        <div class="card"><div class="card-head"><div><h3>Dispositivos físicos (containers Docker)</h3>
          <div class="sub">Teste a resiliência: <span class="mono">docker stop agro-node-leste</span> e veja o fluxo reagir</div></div></div>
          <div class="table-wrap" id="flow-devices"></div></div>
        <div class="card"><div class="card-head"><h3>Últimos eventos do sistema</h3><a class="btn" href="eventos.html">Ver todos</a></div><div class="card-body"><div class="ev-list" id="flow-events"></div></div></div>`;
      app.flowBuilt = true;
    }

    const online = s.devices.filter((d) => d.online).length;
    $('#flow-kpis').innerHTML = [
      ['Mensagens/s', num(r.mqttIn), 'entrada no serviço central', 'ok'],
      ['Latência média', `${r.latencyAvg ?? 0}<small>ms</small>`, `p95: ${r.latencyP95 ?? 0} ms`, r.latencyP95 > 500 ? 'warn' : 'ok'],
      ['Dispositivos online', `${online}<small>de ${s.devices.length}</small>`, 'nós, estação e atuador', online === s.devices.length ? 'ok' : 'crit'],
      ['Broker MQTT', sv.broker.online ? 'Online' : 'Offline', `${sv.broker.clients} clientes · uptime ${brokerUptime(sv)}`, sv.broker.online ? 'ok' : 'crit'],
      ['Comandos enviados', sv.automation.commands, `latência do atuador: ${sv.automation.cmdLatencyAvg ?? '—'} ms`, 'water'],
      ['Registros no banco', sv.storage.rows.toLocaleString('pt-BR'), `${(sv.storage.sizeBytes / 1048576).toFixed(1)} MB · ${num(r.dbWrites)} grav/s`, ''],
    ].map(([l, v, f, c]) => `<div class="card kpi ${c}"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div><div class="kpi-foot">${f}</div></div>`).join('');

    updatePipeline();

    const tl = s.flow.timeline;
    Charts.lineChart($('#ch-throughput'), { points: tl.map((p) => [p.t, p.mqttIn]), color: '#3ecf8e', label: 'Vazão', unit: 'msg/s', decimals: 1, floor: 0, height: 170 });
    Charts.lineChart($('#ch-latency'), { points: tl.map((p) => [p.t, p.latencyAvg]), color: '#5ba8f5', label: 'Latência', unit: 'ms', decimals: 0, floor: 0, height: 170 });

    const svc = (name, tech, ok, kv) => `<div class="svc"><div class="svc-head"><div><div class="svc-name">${name}</div><div class="svc-tech">${tech}</div></div>${badge(ok ? 'ok' : 'crit', ok ? 'operando' : 'falha')}</div>
      <div class="kv">${kv.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('')}</div></div>`;
    $('#flow-services').innerHTML = [
      svc('Broker MQTT', 'agro-broker · porta 1883', sv.broker.online, [['Versão', esc((sv.broker.version || '—').replace('mosquitto version ', ''))], ['Clientes', sv.broker.clients], ['Entrada', `${num(sv.broker.msgsRecv1m, 0)} msg/min`], ['Saída', `${num(sv.broker.msgsSent1m, 0)} msg/min`], ['Uptime', brokerUptime(sv)]]),
      svc('Ingestão', 'agro-core · mqtt.js', sv.ingest.online, [['Vazão', `${num(r.mqttIn)} msg/s`], ['Latência média', `${r.latencyAvg} ms`], ['Latência p95', `${r.latencyP95} ms`], ['Total processado', sv.ingest.totalMsgs.toLocaleString('pt-BR')]]),
      svc('Motor de regras', 'agro-core · rules.js', sv.rules.online, [['Avaliações/s', num(r.evaluations)], ['Total de avaliações', sv.rules.evaluations.toLocaleString('pt-BR')], ['Talhões em alerta', sv.rules.activeAlerts], ['Alertas emitidos', sv.rules.alerts]]),
      svc('Automação de irrigação', 'agro-core → atuador', sv.automation.online, [['Comandos enviados', sv.automation.commands], ['Latência de atuação', `${sv.automation.cmdLatencyAvg ?? '—'} ms`], ['Válvulas abertas', s.farm.irrigating]]),
      svc('Persistência', esc(sv.storage.engine), sv.storage.online, [['Registros', sv.storage.rows.toLocaleString('pt-BR')], ['Tamanho', `${(sv.storage.sizeBytes / 1048576).toFixed(2)} MB`], ['Gravações/s', num(r.dbWrites)], ['Último lote', `${sv.storage.lastFlushMs} ms`]]),
      svc('API + WebSocket', 'agro-core · porta 3000', sv.api.online, [['Clientes WebSocket', sv.api.wsClients], ['Mensagens WS/s', num(r.wsOut)], ['Requisições HTTP', sv.api.httpReqs.toLocaleString('pt-BR')], ['Uptime', uptime(s.uptimeS)]]),
    ].join('');

    $('#flow-devices').innerHTML = `<table><thead><tr><th>Dispositivo</th><th>Tipo</th><th>Container</th><th>Status</th><th>Última mensagem</th><th>Msgs/min</th><th>Bateria</th><th>Sinal</th><th>Firmware</th><th>Uptime</th></tr></thead>
      <tbody>${s.devices.map((d) => `<tr>
        <td><div class="row-title">${esc(d.name)}</div><div class="row-sub mono">${d.id}${d.plots ? ' · ' + d.plots.join(', ') : ''}</div></td>
        <td class="t2">${KIND_LABEL[d.kind]}</td>
        <td class="mono t2">agro-${d.id}</td>
        <td>${badge(d.online ? 'ok' : 'crit', d.online ? 'online' : 'offline')}</td>
        <td class="t2">${ago(d.lastSeenAgoMs)}</td>
        <td class="mono">${d.msgsPerMin}</td>
        <td>${d.battery == null ? '—' : `<span class="bar-mini" style="width:44px"><span style="width:${d.battery}%;background:${d.battery > 30 ? 'var(--ok)' : 'var(--warn)'}"></span></span>${num(d.battery, 0)}%`}</td>
        <td class="t2">${signal(d.rssi)}</td>
        <td class="mono t2">${esc(d.firmware || '—')}</td>
        <td class="t2">${uptime(d.uptimeS)}</td>
      </tr>`).join('')}</tbody></table>`;

    $('#flow-events').innerHTML = app.events.slice(-8).reverse().map(eventRow).join('');
  }

  window.addEventListener('resize', () => { app.flowBuilt = false; AG.render(); });

  AG.start({ render: renderFlow, liveEvents: true });
})();
