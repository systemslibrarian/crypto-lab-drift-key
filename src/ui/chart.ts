/**
 * A small SVG plot for the two measured sweeps.
 *
 * VISUAL HONESTY, in the two senses the template means.
 *
 * The prediction and the measurement are told apart by SHAPE, not by colour: a
 * prediction is a dashed line, a measurement is a filled dot with its 95%
 * interval drawn as a bar through it. In greyscale, or to a reader who sees no
 * difference between the two hues, the plot still reads. The legend says the
 * same thing in words.
 *
 * Measurements are drawn WITH their interval rather than as bare dots. A dot
 * alone invites the reading that measurement and prediction "agree" or "do not"
 * by eyeball; the bar is the honest width of what a few hundred trials can say.
 *
 * The plot is a `role="img"` with a text summary, and every series is also
 * printed as a table beside it, so nothing here is available only to a reader
 * who can see it.
 */

import { h } from './dom';

const NS = 'http://www.w3.org/2000/svg';

export interface ChartPoint {
  readonly x: number;
  readonly y: number;
  readonly lo?: number;
  readonly hi?: number;
}

export interface ChartSeries {
  readonly id: string;
  readonly label: string;
  readonly kind: 'line' | 'points';
  readonly tone: 'predicted' | 'measured';
  readonly points: readonly ChartPoint[];
}

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export interface ChartOptions {
  readonly id: string;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly xTicks: readonly number[];
  readonly xFormat: (v: number) => string;
  readonly yFormat?: (v: number) => string;
  readonly series: readonly ChartSeries[];
  readonly summary: string;
  /** A labelled vertical rule — where the visitor currently is on the x axis. */
  readonly marker?: { readonly x: number; readonly label: string };
}

export function chart(options: ChartOptions): HTMLElement {
  const W = 640;
  const H = 340;
  const M = { top: 14, right: 16, bottom: 52, left: 62 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const xs = options.series.flatMap((s) => s.points.map((p) => p.x));
  const xMin = Math.min(...xs, ...options.xTicks);
  const xMax = Math.max(...xs, ...options.xTicks);
  const span = xMax - xMin || 1;
  const sx = (x: number): number => M.left + ((x - xMin) / span) * plotW;
  const sy = (y: number): number => M.top + (1 - Math.min(1, Math.max(0, y))) * plotH;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'chart',
    role: 'img',
    'aria-label': options.summary,
    'data-chart': options.id,
  });

  // Gridlines and the y axis.
  const yFormat = options.yFormat ?? ((v: number) => `${Math.round(v * 100)}%`);
  for (const y of [0, 0.25, 0.5, 0.75, 1]) {
    svg.append(
      svgEl('line', { x1: M.left, y1: sy(y), x2: W - M.right, y2: sy(y), class: 'chart-grid' }),
    );
    const label = svgEl('text', { x: M.left - 10, y: sy(y) + 4, class: 'chart-tick', 'text-anchor': 'end' });
    label.textContent = yFormat(y);
    svg.append(label);
  }

  for (const x of options.xTicks) {
    svg.append(
      svgEl('line', { x1: sx(x), y1: M.top, x2: sx(x), y2: M.top + plotH, class: 'chart-grid chart-grid-v' }),
    );
    const label = svgEl('text', { x: sx(x), y: H - M.bottom + 20, class: 'chart-tick', 'text-anchor': 'middle' });
    label.textContent = options.xFormat(x);
    svg.append(label);
  }

  svg.append(
    svgEl('line', { x1: M.left, y1: M.top, x2: M.left, y2: M.top + plotH, class: 'chart-axis' }),
    svgEl('line', { x1: M.left, y1: M.top + plotH, x2: W - M.right, y2: M.top + plotH, class: 'chart-axis' }),
  );

  const xTitle = svgEl('text', { x: M.left + plotW / 2, y: H - 8, class: 'chart-axis-label', 'text-anchor': 'middle' });
  xTitle.textContent = options.xLabel;
  const yTitle = svgEl('text', {
    x: -(M.top + plotH / 2),
    y: 16,
    class: 'chart-axis-label',
    'text-anchor': 'middle',
    transform: 'rotate(-90)',
  });
  yTitle.textContent = options.yLabel;
  svg.append(xTitle, yTitle);

  if (options.marker && options.marker.x >= xMin && options.marker.x <= xMax) {
    const mx = sx(options.marker.x);
    svg.append(
      svgEl('line', { x1: mx, y1: M.top, x2: mx, y2: M.top + plotH, class: 'chart-marker' }),
    );
    const tag = svgEl('text', {
      x: mx,
      y: M.top + 14,
      class: 'chart-marker-label',
      'text-anchor': mx > M.left + plotW * 0.75 ? 'end' : 'start',
      dx: mx > M.left + plotW * 0.75 ? -6 : 6,
    });
    tag.textContent = options.marker.label;
    svg.append(tag);
  }

  for (const series of options.series) {
    if (series.points.length === 0) continue;
    if (series.kind === 'line') {
      svg.append(
        svgEl('polyline', {
          points: series.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' '),
          class: `chart-line chart-${series.tone}`,
          'data-series': series.id,
        }),
      );
      continue;
    }
    for (const p of series.points) {
      if (p.lo !== undefined && p.hi !== undefined) {
        svg.append(
          svgEl('line', { x1: sx(p.x), y1: sy(p.lo), x2: sx(p.x), y2: sy(p.hi), class: `chart-bar chart-${series.tone}` }),
          svgEl('line', { x1: sx(p.x) - 5, y1: sy(p.lo), x2: sx(p.x) + 5, y2: sy(p.lo), class: `chart-bar chart-${series.tone}` }),
          svgEl('line', { x1: sx(p.x) - 5, y1: sy(p.hi), x2: sx(p.x) + 5, y2: sy(p.hi), class: `chart-bar chart-${series.tone}` }),
        );
      }
      svg.append(
        svgEl('circle', { cx: sx(p.x), cy: sy(p.y), r: 4.5, class: `chart-dot chart-${series.tone}`, 'data-series': series.id }),
      );
    }
  }

  const legend = h(
    'ul',
    { class: 'chart-legend', role: 'list' },
    ...options.series.map((s) =>
      h(
        'li',
        { class: 'chart-legend-item', role: 'listitem' },
        h('span', { class: `legend-mark legend-${s.kind} legend-${s.tone}`, 'aria-hidden': 'true' }),
        h('span', {}, s.label),
      ),
    ),
  );

  const wrap = h('div', { class: 'chart-wrap' });
  wrap.append(svg, legend);
  return wrap;
}

/** The numbers behind a plot, as a real table. */
export function dataTable(
  caption: string,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  id: string,
): HTMLElement {
  return h(
    'div',
    { class: 'table-wrap', role: 'region', tabindex: '0', 'aria-label': caption },
    h(
      'table',
      { class: 'data-table', 'data-table': id },
      h('caption', {}, caption),
      h('thead', {}, h('tr', {}, ...headers.map((head) => h('th', { scope: 'col' }, head)))),
      h(
        'tbody',
        {},
        ...rows.map((row) => h('tr', {}, ...row.map((cell, i) => (i === 0 ? h('th', { scope: 'row' }, cell) : h('td', {}, cell))))),
      ),
    ),
  );
}
