// Gráfico de linha leve em SVG (série única, faixa ideal opcional, crosshair + tooltip).
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const tooltip = () => document.getElementById('tooltip');

  function niceRange(min, max) {
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.12;
    return [min - pad, max + pad];
  }

  function fmtTime(t) {
    return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  /**
   * @param el    contêiner
   * @param opts  { points: [[t, v]], color, label, unit, decimals, band: [lo, hi], floor, height }
   */
  function lineChart(el, opts) {
    const pts = opts.points.filter((p) => p[1] != null && !Number.isNaN(p[1]));
    const W = Math.max(280, el.clientWidth || 600);
    const H = opts.height || 180;
    const m = { l: 40, r: 12, t: 10, b: 24 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const dec = opts.decimals ?? 1;
    // Não redesenha enquanto o usuário inspeciona o gráfico com o mouse
    if (el.dataset.hovering && !opts.force) return;

    el.classList.add('chart');
    if (!pts.length) {
      el.innerHTML = `<div class="empty" style="height:${H}px;display:grid;place-items:center">Aguardando dados…</div>`;
      return;
    }

    let vals = pts.map((p) => p[1]);
    if (opts.band) vals = vals.concat(opts.band);
    let [y0, y1] = niceRange(Math.min(...vals), Math.max(...vals));
    if (opts.floor != null) y0 = Math.max(opts.floor, y0);
    const t0 = pts[0][0];
    const t1 = Math.max(pts[pts.length - 1][0], t0 + 1);
    const x = (t) => m.l + ((t - t0) / (t1 - t0)) * iw;
    const y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;

    let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${opts.label || ''}">`;
    for (let i = 0; i <= 3; i++) {
      const v = y0 + ((y1 - y0) * i) / 3;
      const yy = y(v);
      svg += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text class="axis-label" x="${m.l - 8}" y="${yy + 3.5}" text-anchor="end">${v.toFixed(dec > 1 ? 2 : dec === 0 && y1 - y0 > 6 ? 0 : 1)}</text>`;
    }
    if (opts.band) {
      const [lo, hi] = opts.band;
      const yt = y(Math.min(hi, y1));
      const yb = y(Math.max(lo, y0));
      svg += `<rect class="band" x="${m.l}" y="${yt}" width="${iw}" height="${Math.max(0, yb - yt)}"/>`;
      if (hi < y1) svg += `<line class="band-edge" x1="${m.l}" x2="${W - m.r}" y1="${yt}" y2="${yt}"/>`;
      if (lo > y0) svg += `<line class="band-edge" x1="${m.l}" x2="${W - m.r}" y1="${yb}" y2="${yb}"/>`;
    }
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const t = t0 + ((t1 - t0) * i) / ticks;
      const anchor = i === 0 ? 'start' : i === ticks ? 'end' : 'middle';
      svg += `<text class="axis-label" x="${x(t)}" y="${H - 6}" text-anchor="${anchor}">${new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</text>`;
    }
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    const area = `${d}L${x(pts[pts.length - 1][0]).toFixed(1)},${m.t + ih}L${x(pts[0][0]).toFixed(1)},${m.t + ih}Z`;
    const gid = 'g' + Math.random().toString(36).slice(2, 8);
    svg += `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${opts.color}" stop-opacity=".22"/><stop offset="1" stop-color="${opts.color}" stop-opacity="0"/></linearGradient></defs>`;
    svg += `<path d="${area}" fill="url(#${gid})"/>`;
    svg += `<path d="${d}" fill="none" stroke="${opts.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = pts[pts.length - 1];
    svg += `<circle cx="${x(last[0])}" cy="${y(last[1])}" r="4" fill="${opts.color}" stroke="var(--surface)" stroke-width="2"/>`;
    svg += `<g class="hover" style="display:none"><line class="crosshair" y1="${m.t}" y2="${m.t + ih}"/><circle r="4.5" fill="${opts.color}" stroke="var(--surface)" stroke-width="2"/></g>`;
    svg += `<rect x="${m.l}" y="0" width="${iw}" height="${H}" fill="transparent" class="hit"/>`;
    svg += '</svg>';
    el.innerHTML = svg;

    const root = el.querySelector('svg');
    const hover = root.querySelector('.hover');
    const line = hover.querySelector('line');
    const dot = hover.querySelector('circle');
    const hit = root.querySelector('.hit');
    hit.addEventListener('mousemove', (ev) => {
      const r = root.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const t = t0 + ((px - m.l) / iw) * (t1 - t0);
      let best = pts[0];
      for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
      const bx = x(best[0]);
      const by = y(best[1]);
      el.dataset.hovering = '1';
      hover.style.display = '';
      line.setAttribute('x1', bx); line.setAttribute('x2', bx);
      dot.setAttribute('cx', bx); dot.setAttribute('cy', by);
      const tip = tooltip();
      tip.hidden = false;
      tip.innerHTML = `${fmtTime(best[0])}<br>${opts.label ? opts.label + ': ' : ''}<b>${best[1].toFixed(dec)}${opts.unit ? ' ' + opts.unit : ''}</b>`;
      tip.style.left = `${Math.min(window.innerWidth - 200, ev.clientX + 14)}px`;
      tip.style.top = `${ev.clientY - 46}px`;
    });
    hit.addEventListener('mouseleave', () => {
      delete el.dataset.hovering;
      hover.style.display = 'none';
      tooltip().hidden = true;
    });
  }

  window.Charts = { lineChart };
})();
