// Página "Planta da fazenda": planta baixa com todos os talhões no lugar, plantas que
// refletem a saúde da lavoura, camadas de dados (saúde, umidade, NDVI, pragas) e a ficha de cada talhão.
(function () {
  const { app, $, ICON, esc, num, badge, meta, crop, initials, scoreColor, issueList } = window.AG;
  const NS = 'http://www.w3.org/2000/svg';

  // Geometria da planta (viewBox 1200 × 760). Estradas em cruz dividem os quatro setores.
  const SECTORS = {
    'node-norte': { label: 'SETOR NORTE', x: 40, y: 30, gw: [548, 318] },
    'node-leste': { label: 'SETOR LESTE', x: 640, y: 30, gw: [652, 318] },
    'node-oeste': { label: 'SETOR OESTE', x: 40, y: 410, gw: [548, 442] },
    'node-sul': { label: 'SETOR SUL', x: 640, y: 410, gw: [652, 442] },
  };
  const SHAPES = {
    'T-01': [[42, 48], [258, 44], [252, 352], [46, 356]],
    'T-02': [[272, 44], [566, 50], [560, 192], [268, 196]],
    'T-03': [[268, 210], [560, 206], [532, 352], [266, 352]],
    'T-08': [[636, 46], [904, 44], [900, 352], [640, 350]],
    'T-07': [[918, 44], [1160, 50], [1156, 178], [916, 182]],
    'T-09': [[916, 196], [1156, 192], [1160, 352], [920, 354]],
    'T-10': [[44, 412], [214, 410], [210, 718], [40, 714]],
    'T-11': [[228, 410], [398, 414], [402, 716], [226, 718]],
    'T-12': [[412, 414], [548, 410], [560, 714], [416, 718]],
    'T-05': [[640, 408], [924, 412], [920, 718], [636, 714]],
    'T-04': [[938, 410], [1162, 414], [1158, 596], [940, 600]],
    'T-06': [[940, 612], [1158, 608], [1160, 716], [936, 718]],
  };
  // Direção das linhas de plantio (graus) para dar variedade visual aos talhões
  const ROW_ANGLE = { 'T-01': 0, 'T-02': 90, 'T-03': 90, 'T-04': 90, 'T-05': 0, 'T-06': 90, 'T-07': 90, 'T-08': 0, 'T-09': 0, 'T-10': 0, 'T-11': 0, 'T-12': 0 };

  const LAYERS = {
    health: { label: 'Saúde', legend: [['var(--ok)', 'Saudável'], ['var(--warn)', 'Atenção'], ['var(--crit)', 'Crítico']] },
    soilMoisture: { label: 'Umidade do solo', legend: [['#b7793a', 'Seco'], ['#5f7d70', 'Ideal'], ['#3f7fd9', 'Encharcado']] },
    ndvi: { label: 'Vigor (NDVI)', legend: [['#d9e8c4', '0,3'], ['#7fb069', '0,6'], ['#1f6b3a', '0,9']] },
    pests: { label: 'Pragas', legend: [['#3a4a42', '0/h'], ['#e8a33d', '8/h'], ['#d9431e', '16+/h']] },
  };

  let layer = 'health';
  let selected = null;
  const lastStatus = {};

  // ---------------------------------------------------------------- cores das camadas
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  function mix(a, b, t) {
    t = Math.max(0, Math.min(1, t));
    const [x, y] = [hex(a), hex(b)];
    return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
  }
  function ramp(stops, t) {
    t = Math.max(0, Math.min(1, t));
    const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
    return mix(stops[seg], stops[seg + 1], t * (stops.length - 1) - seg);
  }
  function layerFill(p) {
    const m = p.metrics;
    if (layer === 'health' || !m) {
      return { ok: '#3ecf8e', warn: '#f2b33d', crit: '#f0544f' }[p.status] || '#3a4a42';
    }
    if (layer === 'soilMoisture') {
      const [lo, hi] = crop(p).ranges.soilMoisture;
      const tol = meta('soilMoisture').tolerance;
      if (m.soilMoisture < lo) return mix('#5f7d70', '#b7793a', (lo - m.soilMoisture) / tol);
      if (m.soilMoisture > hi) return mix('#5f7d70', '#3f7fd9', (m.soilMoisture - hi) / tol);
      return '#5f7d70';
    }
    if (layer === 'ndvi') return ramp(['#d9e8c4', '#7fb069', '#1f6b3a'], (m.ndvi - 0.3) / 0.6);
    return ramp(['#3a4a42', '#e8a33d', '#d9431e'], m.pests / 16);
  }

  // ---------------------------------------------------------------- geometria
  const pts = (shape) => shape.map((p) => p.join(',')).join(' ');
  const centroid = (shape) => shape.reduce((a, p) => [a[0] + p[0] / shape.length, a[1] + p[1] / shape.length], [0, 0]);
  function inside([x, y], shape) {
    let ok = false;
    for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
      const [xi, yi] = shape[i], [xj, yj] = shape[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ok = !ok;
    }
    return ok;
  }

  function buildMap() {
    const plots = app.state.plots;
    let s = `<svg class="farm-map" viewBox="0 0 1200 760" role="img" aria-label="Planta da fazenda com os talhões">
      <defs>
        <pattern id="terrain" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#0e1714"/><circle cx="3" cy="4" r=".8" fill="#18261f"/><circle cx="10" cy="11" r=".7" fill="#16231d"/></pattern>
        <symbol id="plant-ok" viewBox="-8 -9 16 16" overflow="visible"><path d="M0 6V-1" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M0 0C-1-4-4-6-7-6c0 3 3 6 7 6z"/><path d="M0-1C1-5 4-7 7-7c0 3-3 6-7 6z"/></symbol>
        <symbol id="plant-wilt" viewBox="-8 -9 16 16" overflow="visible"><path d="M0 6V0" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M0 1C-2 2-5 4-6 7c3 0 6-2 6-6z"/><path d="M0 0C2 1 5 3 6 6c-3 0-6-2-6-6z"/></symbol>
        ${plots.filter((p) => SHAPES[p.id]).map((p) => `<clipPath id="clip-${p.id}"><polygon points="${pts(SHAPES[p.id])}"/></clipPath>`).join('')}
      </defs>
      <rect width="1200" height="760" fill="url(#terrain)" rx="14"/>
      <rect x="592" y="0" width="16" height="760" class="road"/>
      <rect x="0" y="372" width="1200" height="16" class="road"/>
      <line x1="600" y1="0" x2="600" y2="760" class="road-mark"/><line x1="0" y1="380" x2="1200" y2="380" class="road-mark"/>
      <line x1="586" y1="0" x2="586" y2="760" class="water-main"/><line x1="0" y1="366" x2="1200" y2="366" class="water-main"/>`;

    for (const [, sec] of Object.entries(SECTORS)) {
      s += `<text class="sector-label" x="${sec.x}" y="${sec.y - 8}">${sec.label}</text>`;
    }

    for (const p of plots) {
      const shape = SHAPES[p.id];
      if (!shape) continue;
      const xs = shape.map((q) => q[0]), ys = shape.map((q) => q[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const angle = ROW_ANGLE[p.id] || 0;
      let rows = '';
      if (angle === 0) for (let y = y0 + 12; y < y1; y += 22) rows += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>`;
      else for (let x = x0 + 12; x < x1; x += 22) rows += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}"/>`;
      let plants = '';
      for (let y = y0 + 12; y < y1 - 4; y += 22) {
        for (let x = x0 + 12; x < x1 - 4; x += 22) {
          if (inside([x, y], shape) && inside([x - 6, y - 6], shape) && inside([x + 6, y + 6], shape)) {
            plants += `<use href="#plant-ok" x="${x - 7}" y="${y - 8}" width="14" height="14"/>`;
          }
        }
      }
      let drips = '';
      if (angle === 0) for (let y = y0 + 23; y < y1; y += 22) drips += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>`;
      else for (let x = x0 + 23; x < x1; x += 22) drips += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}"/>`;
      const [cx, cy] = centroid(shape);

      s += `<g class="plot-g" id="pg-${p.id}" data-plot-select="${p.id}">
        <polygon class="plot-fill" points="${pts(shape)}"/>
        <g clip-path="url(#clip-${p.id})">
          <g class="crop-rows" stroke="${p.color}">${rows}</g>
          <g class="drip">${drips}</g>
          <g class="plants">${plants}</g>
        </g>
        <polygon class="plot-edge" points="${pts(shape)}"/>
        <g class="plot-label" transform="translate(${cx},${cy})">
          <rect x="-62" y="-30" width="124" height="60" rx="10"/>
          <text class="pl-crop" y="-9" text-anchor="middle">${esc(p.cropName)}</text>
          <text class="pl-id" y="7" text-anchor="middle">${p.id} · ${num(p.areaHa)} ha</text>
          <text class="pl-val" y="23" text-anchor="middle" id="pv-${p.id}"></text>
        </g>
      </g>`;
    }

    // Sede com serviço central, estação meteorológica e gateways de cada setor
    s += `<g class="hq"><rect x="566" y="346" width="68" height="68" rx="10"/><text x="600" y="377" text-anchor="middle">SEDE</text><text x="600" y="393" text-anchor="middle" class="hq-sub">core · broker</text></g>`;
    s += `<g class="station" id="st-meteo" transform="translate(632,330)"><circle r="11"/><path d="M0 -6v12M-5 -1h10" /></g>`;
    for (const [id, sec] of Object.entries(SECTORS)) {
      const [gx, gy] = sec.gw;
      s += `<g class="gateway" id="gw-${id}" transform="translate(${gx},${gy})"><circle r="11"/><path d="M0 5V-3M-4 -6a6 6 0 0 1 8 0M-7 -9a10 10 0 0 1 14 0"/></g>`;
    }
    s += `<g class="compass" transform="translate(1182,22)"><circle r="14"/><path d="M0 -11 L4 -3 L-4 -3Z"/><text y="9" text-anchor="middle">N</text></g>`;
    s += `<g class="scalebar" transform="translate(40,744)"><line x1="0" x2="110" y1="0" y2="0"/><line x1="0" x2="0" y1="-4" y2="4"/><line x1="110" x2="110" y1="-4" y2="4"/><text x="118" y="4">100 m</text></g>`;
    s += '</svg>';
    return s;
  }

  // ---------------------------------------------------------------- atualização
  function layerValue(p) {
    const m = p.metrics;
    if (!m) return '—';
    if (layer === 'health') return `saúde ${p.score}`;
    if (layer === 'soilMoisture') return `${num(m.soilMoisture, 0)}% umidade`;
    if (layer === 'ndvi') return `NDVI ${num(m.ndvi, 2)}`;
    return `${m.pests} pragas/h`;
  }

  function updateMap() {
    const s = app.state;
    for (const p of s.plots) {
      const g = document.getElementById(`pg-${p.id}`);
      if (!g) continue;
      g.setAttribute('class', `plot-g ${p.status}${p.valve.open ? ' irrigating' : ''}${selected === p.id ? ' selected' : ''}`);
      g.querySelector('.plot-fill').style.fill = layerFill(p);
      g.querySelector('.plot-fill').style.fillOpacity = layer === 'health' ? 0.16 : 0.62;
      document.getElementById(`pv-${p.id}`).textContent = layerValue(p);
      document.getElementById(`pv-${p.id}`).style.fill = layer === 'health' ? scoreColor(p.score) : 'var(--text)';
      if (lastStatus[p.id] !== p.status) {
        const href = p.status === 'crit' ? '#plant-wilt' : '#plant-ok';
        g.querySelectorAll('.plants use').forEach((u) => u.setAttribute('href', href));
        lastStatus[p.id] = p.status;
      }
    }
    const dev = Object.fromEntries(s.devices.map((d) => [d.id, d]));
    for (const id of Object.keys(SECTORS)) {
      document.getElementById(`gw-${id}`)?.setAttribute('class', `gateway ${dev[id]?.online ? 'on' : 'off'}`);
    }
    document.getElementById('st-meteo')?.setAttribute('class', `station ${dev['estacao-meteo']?.online ? 'on' : 'off'}`);
  }

  function renderSidePanel() {
    const p = app.state.plots.find((x) => x.id === selected);
    if (!p) return;
    const c = crop(p);
    const m = p.metrics || {};
    const node = app.config.nodes.find((n) => n.id === p.nodeId);
    $('#plan-side').innerHTML = `
      <div class="card-head" style="padding-bottom:4px">
        <div style="display:flex;gap:12px;align-items:center">
          <div class="crop-avatar" style="background:${p.color}">${initials(p.cropName)}</div>
          <div><h3 style="font-size:17px">${esc(p.cropName)} <span class="plot-id">${p.id}</span></h3>
            <div class="sub">${esc(p.variety)} · ${esc(node.name)}</div></div>
        </div>
        ${badge(p.status)}
      </div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:16px">
        <div class="facts" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          <div class="fact"><div class="k">Saúde</div><div class="v" style="color:${scoreColor(p.score)}">${p.score}/100</div></div>
          <div class="fact"><div class="k">Área</div><div class="v">${num(p.areaHa)} ha</div></div>
          <div class="fact"><div class="k">Plantio</div><div class="v">${p.daysPlanted} dias</div></div>
        </div>
        ${p.issues.length ? `<div class="alert-item ${p.status}" style="cursor:default">${issueList(p.issues, 3)}</div>`
          : `<div class="plan-ok">${ICON.ok}<span>Todos os indicadores dentro da faixa ideal</span></div>`}
        <div class="plan-metrics">${Object.keys(app.config.metrics).map((k) => {
          const mm = meta(k);
          const chk = p.checks[k];
          const [lo, hi] = c.ranges[k];
          const dmin = Math.max(0, lo - mm.tolerance * 2), dmax = hi + mm.tolerance * 2;
          const pct = (x) => Math.min(100, Math.max(0, ((x - dmin) / (dmax - dmin)) * 100));
          return `<div class="pm ${chk ? chk.status : ''}">
            <div class="pm-top"><span>${esc(mm.label)}</span><b>${num(m[k], mm.decimals)}${mm.unit ? ' ' + esc(mm.unit) : ''}</b></div>
            <div class="range"><div class="ideal" style="left:${pct(lo)}%;width:${pct(hi) - pct(lo)}%"></div><div class="marker" style="left:${m[k] == null ? 0 : pct(m[k])}%"></div></div>
          </div>`;
        }).join('')}</div>
        <div class="irrigation" style="padding:10px 12px">
          <span class="badge ${p.valve.open ? 'water' : 'off'}">${ICON.drop}${p.valve.open ? `Irrigando · ${num(p.valve.flowLpm)} L/min` : 'Válvula fechada'}</span>
          <div class="grow"></div>
          <button class="btn" data-plot="${p.id}">Detalhe completo</button>
        </div>
      </div>`;
  }

  function renderCards() {
    const order = Object.keys(SHAPES);
    const plots = app.state.plots.slice().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    $('#plan-cards').innerHTML = plots.map((p) => {
      const m = p.metrics || {};
      const cell = (k, label, d) => `<div class="pc-m ${p.checks[k]?.status || ''}"><span>${label}</span><b>${num(m[k], d)}</b></div>`;
      return `<button class="plan-card ${p.status}${selected === p.id ? ' selected' : ''}" data-plot-select="${p.id}">
        <div class="pc-head"><span class="crop-dot" style="background:${p.color}"></span><b>${esc(p.cropName)}</b><span class="plot-id">${p.id}</span>
          <span style="margin-left:auto">${p.valve.open ? `<span class="badge water" style="padding:2px 6px">${ICON.drop}</span>` : ''}${badge(p.status, String(p.score))}</span></div>
        <div class="pc-grid">
          ${cell('soilMoisture', 'Umidade %', 0)}${cell('soilTemp', 'Solo °C', 1)}${cell('ph', 'pH', 1)}
          ${cell('ec', 'EC', 1)}${cell('ndvi', 'NDVI', 2)}${cell('pests', 'Pragas/h', 0)}
        </div>
      </button>`;
    }).join('');
  }

  function renderPlan() {
    const s = app.state;
    if (!app.planBuilt) {
      const attention = s.plots.filter((p) => p.status === 'crit' || p.status === 'warn');
      selected = selected || (attention[0] || s.plots[0]).id;
      $('#page').innerHTML = `
        <div class="toolbar">
          <div class="seg" id="layer-filter">${Object.entries(LAYERS).map(([k, l]) => `<button data-layer="${k}" class="${k === layer ? 'active' : ''}">${l.label}</button>`).join('')}</div>
          <div class="legend" id="layer-legend" style="margin:0 0 0 8px"></div>
          <span class="muted" style="font-size:12px;margin-left:auto">Plantas murchas indicam situação crítica · gotejamento azul animado = irrigação ativa · clique em um talhão</span>
        </div>
        <div class="grid g-main">
          <div class="card"><div class="card-head"><div><h3>${esc(app.config.farm.name)}</h3><div class="sub">${esc(app.config.farm.location)} · ${num(app.config.farm.areaHa)} ha · ${s.plots.length} talhões em 4 setores</div></div>
            <div class="legend" style="margin:0"><span><i style="background:var(--accent)"></i>gateway online</span><span><i style="background:var(--crit)"></i>offline</span><span><i style="background:var(--water)"></i>adutora</span></div></div>
            <div class="card-body"><div class="map-wrap">${buildMap()}</div></div></div>
          <div class="card plan-side" id="plan-side"></div>
        </div>
        <div class="card"><div class="card-head"><div><h3>Ficha de todos os talhões</h3><div class="sub">Leituras atuais · valores em amarelo/vermelho estão fora da faixa ideal da cultura</div></div></div>
          <div class="card-body"><div class="plan-cards" id="plan-cards"></div></div></div>`;
      for (const k of Object.keys(lastStatus)) delete lastStatus[k];
      app.planBuilt = true;
    }
    $('#layer-legend').innerHTML = LAYERS[layer].legend.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('');
    updateMap();
    renderSidePanel();
    renderCards();
  }

  // ---------------------------------------------------------------- interação
  const tip = () => document.getElementById('tooltip');
  let tipShown = false;
  document.addEventListener('mousemove', (ev) => {
    const g = ev.target.closest && ev.target.closest('.farm-map [data-plot-select]');
    if (!g || !app.state) {
      if (tipShown) { tip().hidden = true; tipShown = false; }
      return;
    }
    tipShown = true;
    const p = app.state.plots.find((x) => x.id === g.dataset.plotSelect);
    const m = p.metrics || {};
    tip().hidden = false;
    tip().innerHTML = `<b>${esc(p.cropName)} · ${p.id}</b> — ${esc({ ok: 'Saudável', warn: 'Atenção', crit: 'Crítico' }[p.status] || '')}<br>
      Umidade ${num(m.soilMoisture, 0)}% · pH ${num(m.ph, 2)} · NDVI ${num(m.ndvi, 2)} · pragas ${m.pests ?? '—'}/h
      ${p.issues[0] ? `<br><span style="color:var(--warn)">${esc(p.issues[0].title)}</span>` : ''}`;
    tip().style.left = `${Math.min(window.innerWidth - 320, ev.clientX + 16)}px`;
    tip().style.top = `${ev.clientY + 16}px`;
  });
  document.addEventListener('click', (ev) => {
    const l = ev.target.closest('#layer-filter [data-layer]');
    if (l) {
      layer = l.dataset.layer;
      document.querySelectorAll('#layer-filter button').forEach((b) => b.classList.toggle('active', b === l));
      return renderPlan();
    }
    const g = ev.target.closest('[data-plot-select]');
    if (g) {
      selected = g.dataset.plotSelect;
      renderPlan();
    }
  });

  AG.start({ render: renderPlan });
})();
