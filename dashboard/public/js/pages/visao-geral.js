// Página "Visão geral": indicadores, mapa dos talhões, clima e listas saudáveis × atenção.
(function () {
  const { app, $, ICON, esc, num, badge, initials, scoreColor, simClock, sortBySeverity, issueList } = window.AG;

  function renderOverview() {
    const s = app.state;
    const f = s.farm;
    const plots = s.plots;
    const healthy = plots.filter((p) => p.status === 'ok').sort((a, b) => b.score - a.score);
    const attention = plots.filter((p) => p.status === 'warn' || p.status === 'crit').sort(sortBySeverity);
    const area = plots.reduce((a, p) => a + p.areaHa, 0);
    const circ = 2 * Math.PI * 22;

    $('#page').innerHTML = `
      <div class="grid g-kpi">
        <div class="card kpi ${f.avgScore >= 85 ? 'ok' : f.avgScore >= 60 ? 'warn' : 'crit'}">
          <div class="kpi-label">Índice de saúde da fazenda</div>
          <div class="ring">
            <svg viewBox="0 0 52 52"><circle class="track" cx="26" cy="26" r="22" fill="none" stroke-width="5"/>
              <circle cx="26" cy="26" r="22" fill="none" stroke="${scoreColor(f.avgScore)}" stroke-width="5" stroke-linecap="round"
                stroke-dasharray="${(circ * f.avgScore) / 100} ${circ}"/></svg>
            <div class="kpi-value">${f.avgScore}<small>/100</small></div>
          </div>
        </div>
        <div class="card kpi ok"><div class="kpi-label">Lavouras saudáveis</div>
          <div class="kpi-value">${f.healthy}<small>de ${f.plots}</small></div>
          <div class="kpi-foot">${Math.round((f.healthy / f.plots) * 100)}% dos talhões</div></div>
        <div class="card kpi warn"><div class="kpi-label">Precisam de atenção</div>
          <div class="kpi-value">${f.warn}</div><div class="kpi-foot">fora da faixa ideal</div></div>
        <div class="card kpi crit"><div class="kpi-label">Situação crítica</div>
          <div class="kpi-value">${f.crit}</div><div class="kpi-foot">ação imediata recomendada</div></div>
        <div class="card kpi water"><div class="kpi-label">Irrigação ativa</div>
          <div class="kpi-value">${f.irrigating}<small>válvulas</small></div><div class="kpi-foot">controle automático</div></div>
        <div class="card kpi"><div class="kpi-label">Área monitorada</div>
          <div class="kpi-value">${num(area)}<small>ha</small></div><div class="kpi-foot">${plots.length} talhões · ${s.devices.filter((d) => d.kind === 'field-node').length} gateways</div></div>
      </div>

      <div class="grid g-main">
        <div class="card">
          <div class="card-head"><div><h3>Mapa dos talhões</h3><div class="sub">Clique em um talhão para ver os detalhes</div></div>
            <div class="legend" style="margin:0">${['ok', 'warn', 'crit'].map((k) => badge(k)).join('')}</div></div>
          <div class="card-body"><div class="sectors">${renderSectors()}</div></div>
        </div>
        <div class="grid" style="gap:20px;align-content:start">
          <div class="card"><div class="card-head"><h3>Condições climáticas</h3><span class="sub">estacao-meteo</span></div>
            <div class="card-body">${renderWeather()}</div></div>
          <div class="card"><div class="card-head"><h3>Distribuição de saúde</h3><span class="sub">${plots.length} talhões</span></div>
            <div class="card-body">
              <div class="health-bar">
                <span style="flex-grow:${f.healthy};background:var(--ok)"></span>
                <span style="flex-grow:${f.warn};background:var(--warn)"></span>
                <span style="flex-grow:${f.crit};background:var(--crit)"></span>
              </div>
              <div class="legend">
                <span><i style="background:var(--ok)"></i>Saudáveis ${f.healthy}</span>
                <span><i style="background:var(--warn)"></i>Atenção ${f.warn}</span>
                <span><i style="background:var(--crit)"></i>Críticos ${f.crit}</span>
              </div>
            </div></div>
        </div>
      </div>

      <div class="grid g-2">
        <div class="card">
          <div class="card-head"><div><h3>Precisam de atenção</h3><div class="sub">Ordenado por gravidade, com recomendação de manejo</div></div>${badge(attention.length ? (f.crit ? 'crit' : 'warn') : 'ok', `${attention.length}`)}</div>
          <div class="card-body">
            ${attention.length ? attention.map(alertItem).join('') : `<div class="empty">${ICON.ok}Nenhuma lavoura precisa de atenção agora.</div>`}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><h3>Lavouras saudáveis</h3><div class="sub">Todos os indicadores dentro da faixa ideal</div></div>${badge('ok', `${healthy.length}`)}</div>
          <div class="card-body"><div class="list">
            ${healthy.length ? healthy.map(healthyRow).join('') : '<div class="empty">Nenhuma lavoura saudável no momento.</div>'}
          </div></div>
        </div>
      </div>`;
  }

  function renderSectors() {
    const byNode = {};
    for (const p of app.state.plots) (byNode[p.nodeId] ||= []).push(p);
    return app.config.nodes.map((n) => {
      const dev = app.state.devices.find((d) => d.id === n.id);
      return `<div class="sector">
        <div class="sector-head"><b>${esc(n.name)}</b>${dev && dev.online ? badge('ok', 'online') : badge('crit', 'offline')}</div>
        <div class="plots">${(byNode[n.id] || []).map(plotTile).join('')}</div>
      </div>`;
    }).join('');
  }

  function plotTile(p) {
    const m = p.metrics || {};
    return `<button class="plot ${p.status}" data-plot="${p.id}">
      <div class="plot-top"><span class="plot-id">${p.id}</span><span style="display:flex;gap:4px">
        ${p.valve.open ? `<span class="badge water" style="padding:2px 6px" title="Irrigando">${ICON.drop}</span>` : ''}
        ${p.status === 'unknown' ? '' : `<span class="badge ${p.status}" style="padding:2px 6px">${ICON[p.status]}</span>`}</span></div>
      <div class="plot-crop"><span class="crop-dot" style="background:${p.color}"></span>${esc(p.cropName)}</div>
      <div class="plot-score">${p.status === 'unknown' ? '—' : p.score}<small> saúde</small></div>
      <div class="plot-meta"><span>${num(m.soilMoisture, 0)}% umid.</span><span>NDVI ${num(m.ndvi, 2)}</span></div>
    </button>`;
  }

  function renderWeather() {
    const w = app.state.weather;
    if (!w) return '<div class="empty">Aguardando dados da estação…</div>';
    const [ico, sky] = w.rainMmH > 0 ? [ICON.rain, 'Chuva'] : w.solarWm2 > 0 ? [ICON.sun, w.solarWm2 > 600 ? 'Sol forte' : 'Céu aberto'] : [ICON.moon, 'Noite'];
    return `<div class="sky"><div class="sky-ico">${ico}</div>
        <div><div class="kpi-value">${num(w.airTemp)}<small>°C</small></div><div class="muted" style="font-size:12px">${sky} · hora simulada ${simClock(w.simHour)}</div></div></div>
      <div class="weather-grid">
        <div class="wx"><div class="wx-label">Umidade relativa</div><div class="wx-value">${num(w.airHumidity, 0)}<small>%</small></div></div>
        <div class="wx"><div class="wx-label">Radiação solar</div><div class="wx-value">${num(w.solarWm2, 0)}<small>W/m²</small></div></div>
        <div class="wx"><div class="wx-label">Vento</div><div class="wx-value">${num(w.windKmh)}<small>km/h</small></div></div>
        <div class="wx"><div class="wx-label">Precipitação</div><div class="wx-value">${num(w.rainMmH)}<small>mm/h</small></div></div>
      </div>`;
  }

  function alertItem(p) {
    return `<button class="alert-item ${p.status}" data-plot="${p.id}">
      <div class="alert-head">
        <div class="crop-avatar" style="background:${p.color}">${initials(p.cropName)}</div>
        <div class="grow"><div class="row-title">${esc(p.cropName)} <span class="plot-id">${p.id}</span></div>
          <div class="row-sub">${esc(p.variety)} · ${num(p.areaHa)} ha · saúde ${p.score}/100</div></div>
        ${p.valve.open ? `<span class="badge water">${ICON.drop}Irrigando</span>` : ''}${badge(p.status)}
      </div>
      ${issueList(p.issues)}
    </button>`;
  }

  function healthyRow(p) {
    const m = p.metrics || {};
    return `<button class="list-row" data-plot="${p.id}">
      <div class="crop-avatar" style="background:${p.color}">${initials(p.cropName)}</div>
      <div><div class="row-title">${esc(p.cropName)} <span class="plot-id">${p.id}</span>${p.valve.open ? `<span class="drop">${ICON.drop}</span>` : ''}</div>
        <div class="row-sub">${esc(p.variety)} · ${p.daysPlanted} dias após plantio</div></div>
      <div class="row-stats"><div><b>${p.score}</b>saúde</div><div><b>${num(m.soilMoisture, 0)}%</b>umidade</div><div><b>${num(m.ndvi, 2)}</b>NDVI</div></div>
    </button>`;
  }

  AG.start({ render: renderOverview });
})();
