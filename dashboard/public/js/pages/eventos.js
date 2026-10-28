// Página "Eventos e alertas": histórico completo com filtro por gravidade.
(function () {
  const { app, $, eventRow } = window.AG;
  let eventFilter = 'all';

  function renderEvents() {
    const filters = { all: 'Todos', crit: 'Críticos', warn: 'Atenção', ok: 'Normalizações', info: 'Operação' };
    const count = (f) => (f === 'all' ? app.events.length : app.events.filter((e) => e.severity === f).length);
    const list = app.events.filter((e) => eventFilter === 'all' || e.severity === eventFilter).slice().reverse();
    $('#page').innerHTML = `
      <div class="toolbar"><div class="seg" id="event-filter">${Object.entries(filters).map(([k, l]) =>
        `<button data-f="${k}" class="${eventFilter === k ? 'active' : ''}">${l}<span class="n">${count(k)}</span></button>`).join('')}</div></div>
      <div class="card"><div class="card-body"><div class="ev-list">
        ${list.length ? list.map(eventRow).join('') : '<div class="empty">Nenhum evento nesta categoria.</div>'}
      </div></div></div>`;
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('#event-filter [data-f]');
    if (!t) return;
    eventFilter = t.dataset.f;
    renderEvents();
  });

  AG.start({ render: renderEvents, liveEvents: true });
})();
