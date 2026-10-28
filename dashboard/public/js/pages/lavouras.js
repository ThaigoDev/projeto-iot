// Página "Lavouras": tabela de todos os talhões com filtro saudáveis / precisam de atenção.
(function () {
  const { app, $, ICON, esc, num, badge, meta, scoreColor, sortBySeverity } = window.AG;
  let cropFilter = 'all';

  function renderCrops() {
    const plots = app.state.plots.slice().sort(sortBySeverity);
    const counts = {
      all: plots.length,
      ok: plots.filter((p) => p.status === 'ok').length,
      attention: plots.filter((p) => p.status === 'warn' || p.status === 'crit').length,
    };
    const shown = plots.filter((p) => cropFilter === 'all' || (cropFilter === 'ok' ? p.status === 'ok' : p.status === 'warn' || p.status === 'crit'));
    const cols = ['soilMoisture', 'soilTemp', 'ph', 'ec', 'ndvi', 'pests'];
    const cell = (p, k) => {
      const c = p.checks[k];
      const v = p.metrics?.[k];
      return `<td class="cell-metric ${c ? c.status : ''}" title="Ideal: ${c ? c.range.join(' – ') : ''}">${num(v, meta(k).decimals)}</td>`;
    };
    $('#page').innerHTML = `
      <div class="toolbar">
        <div class="seg" id="crop-filter">
          <button data-f="all" class="${cropFilter === 'all' ? 'active' : ''}">Todas<span class="n">${counts.all}</span></button>
          <button data-f="ok" class="${cropFilter === 'ok' ? 'active' : ''}">Saudáveis<span class="n">${counts.ok}</span></button>
          <button data-f="attention" class="${cropFilter === 'attention' ? 'active' : ''}">Precisam de atenção<span class="n">${counts.attention}</span></button>
        </div>
        <span class="muted" style="font-size:12px;margin-left:auto">Valores em amarelo/vermelho estão fora da faixa ideal da cultura · passe o mouse para ver a faixa</span>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Talhão</th><th>Cultura</th><th>Setor</th><th>Status</th><th>Saúde</th>
          ${cols.map((k) => `<th>${esc(meta(k).label.replace(' (nutrientes)', '').replace('Vigor vegetativo ', ''))}${meta(k).unit ? ` <span style="text-transform:none">(${meta(k).unit})</span>` : ''}</th>`).join('')}
          <th>Irrigação</th><th>Principal ocorrência</th></tr></thead>
        <tbody>${shown.map((p) => `<tr class="click" data-plot="${p.id}">
          <td class="mono">${p.id}</td>
          <td><div class="row-title"><span class="crop-dot" style="background:${p.color}"></span>${esc(p.cropName)}</div><div class="row-sub">${esc(p.variety)}</div></td>
          <td class="t2">${esc(p.nodeId.replace('node-', ''))}</td>
          <td>${badge(p.status)}</td>
          <td><span class="bar-mini"><span style="width:${p.score}%;background:${scoreColor(p.score)}"></span></span>${p.score}</td>
          ${cols.map((k) => cell(p, k)).join('')}
          <td>${p.valve.open ? `<span class="badge water">${ICON.drop}${num(p.valve.flowLpm)} L/min</span>` : '<span class="muted">fechada</span>'}</td>
          <td class="t2">${p.issues[0] ? esc(p.issues[0].title) : '<span class="muted">—</span>'}</td>
        </tr>`).join('')}</tbody>
      </table></div></div>`;
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('#crop-filter [data-f]');
    if (!t) return;
    cropFilter = t.dataset.f;
    renderCrops();
  });

  AG.start({ render: renderCrops });
})();
