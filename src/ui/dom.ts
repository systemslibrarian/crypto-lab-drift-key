/** Small dependency-free DOM helpers shared by the panels. */

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined;

/** Hyperscript: h('button', { class: 'x', onclick: fn }, 'label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export type VerdictResult = 'pass' | 'fail' | 'alarm' | 'warn' | 'info';

/**
 * A rendered outcome.
 *
 * Three things travel together and must never disagree: the words, the
 * machine-readable `data-result`, and the tone class that colours it. The
 * claims suite asserts all three at once, so flipping only `data-result` — a
 * page whose sentence contradicts its own marker — is a failure rather than a
 * pass (template §4.1c).
 *
 * `data-check` separates a check THE CONSTRUCTION PERFORMS from a measurement
 * only this page can make. It is what lets the negative-claim fixture assert
 * that every construction check reports success in the very state where the key
 * has already been recovered from public data.
 */
export function verdict(
  id: string,
  result: VerdictResult,
  headline: string,
  options: { detail?: string; check?: 'construction' | 'measurement' } = {},
): HTMLElement {
  const icon = result === 'pass' ? '✓' : result === 'fail' ? '✕' : result === 'alarm' ? '‼' : result === 'warn' ? '!' : '·';
  return h(
    'p',
    {
      class: `verdict verdict-${result}`,
      'data-verdict': id,
      'data-result': result,
      'data-check': options.check ?? 'measurement',
    },
    h('span', { class: 'verdict-icon', 'aria-hidden': 'true' }, icon),
    h('strong', {}, headline),
    options.detail ? ` · ${options.detail}` : null,
  );
}

/**
 * A measured number. Carries its own marker for the same reason a verdict does:
 * a figure painted with no assertion behind it is exactly as unchecked as a
 * word would be, and it is the easier one to ship because it does not look like
 * a claim.
 */
export function claim(id: string, label: string, value: string, sub?: string): HTMLElement {
  return h(
    'div',
    { class: 'claim' },
    h('span', { class: 'claim-label' }, label),
    h('span', { class: 'claim-value', 'data-claim': id }, value),
    sub ? h('span', { class: 'claim-sub' }, sub) : null,
  );
}

/**
 * A labelled read-only value, wrapping rather than scrolling.
 *
 * `full` carries the untruncated value into the `title`, so a long hex run can
 * be shown middle-elided without the complete value leaving the page. A reader
 * gets it on hover; the claims suite reads it to recompute the construction's
 * own identities from values the page actually printed, rather than from a
 * prefix that would let two different words compare equal.
 */
export function field(
  label: string,
  value: string,
  opts: { id?: string; tone?: string; full?: string } = {},
): HTMLElement {
  return h(
    'div',
    { class: `field${opts.tone ? ` field-${opts.tone}` : ''}` },
    h('span', { class: 'field-label' }, label),
    h(
      'code',
      {
        class: 'field-value',
        ...(opts.id ? { 'data-claim': opts.id } : {}),
        ...(opts.full && opts.full !== value ? { title: opts.full } : {}),
      },
      value,
    ),
  );
}

/** A scoping note. Never dismissible; `kind` only chooses the tone. */
export function callout(kind: 'info' | 'danger' | 'caveat' | 'scope', ...children: Child[]): HTMLElement {
  return h('p', { class: `callout callout-${kind}` }, ...children);
}

export function panelIntro(title: string, ...paras: (string | HTMLElement)[]): HTMLElement {
  return h(
    'div',
    { class: 'panel-intro' },
    h('h2', {}, title),
    ...paras.map((p) => (typeof p === 'string' ? h('p', {}, p) : p)),
  );
}

/**
 * A block of derivation, as a keyboard-reachable scroll region.
 *
 * A `<pre>` holding an equation does not wrap, so at phone width it becomes a
 * horizontal scroller — and a scroller with no focusable content inside it is
 * unreachable from the keyboard (WCAG 2.1.1). `tabindex="0"` plus a named
 * `role="group"` makes it a focus target the arrow keys can then scroll. The
 * gate caught the version of this without them, at 380px.
 */
export function derivation(label: string, text: string): HTMLElement {
  return h('pre', { class: 'derivation', tabindex: '0', role: 'group', 'aria-label': label }, text);
}

/**
 * Wrap a table in a keyboard-reachable horizontal scroll region.
 *
 * The template allows a table to be wider than the viewport, but only inside
 * its own `overflow-x: auto` container -- the page body itself must never
 * scroll sideways (WCAG 1.4.10). And a scroller with no focusable content
 * needs `tabindex="0"` and a named role to be operable at all (WCAG 2.1.1).
 * The gate caught a bare `.code-table` pushing the document to 436px at a
 * 380px viewport.
 */
export function tableRegion(label: string, table: HTMLElement): HTMLElement {
  return h('div', { class: 'table-wrap', role: 'region', tabindex: '0', 'aria-label': label }, table);
}

/** A disclosure that ships SHUT, for the depth an expert wants on demand. */
export function disclosure(summary: string, ...children: Child[]): HTMLElement {
  return h('details', { class: 'disclose' }, h('summary', {}, summary), h('div', { class: 'disclose-body' }, ...children));
}

/** Middle-truncate a long hex run; the full value stays in the title attribute. */
export function short(hex: string, keep = 12): string {
  if (hex.length <= keep * 2 + 1) return hex;
  return `${hex.slice(0, keep)}…${hex.slice(-keep)}`;
}

export function fmt(value: number, places = 2): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(places);
}

/** A probability as a percentage, with enough resolution to read a small one. */
export function pct(value: number): string {
  if (value === 0) return '0%';
  if (value < 0.0001) return '< 0.01%';
  return `${(value * 100).toFixed(value < 0.01 ? 3 : 1)}%`;
}

/** A labelled range slider with its value echoed in the label. */
export function slider(options: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  /** Fires continuously while dragging; update the readout only. */
  onInput?: (v: number) => void;
  /** Fires on release. Where the work goes, so dragging does not thrash. */
  onChange: (v: number) => void;
}): HTMLElement {
  const output = h('span', { class: 'slider-value', 'data-claim': `${options.id}-value` }, options.format(options.value));
  const input = h('input', {
    type: 'range',
    id: options.id,
    class: 'slider',
    min: String(options.min),
    max: String(options.max),
    step: String(options.step),
    value: String(options.value),
    oninput: (event: Event) => {
      const v = Number((event.target as HTMLInputElement).value);
      output.textContent = options.format(v);
      options.onInput?.(v);
    },
    onchange: (event: Event) => options.onChange(Number((event.target as HTMLInputElement).value)),
  });
  return h(
    'div',
    { class: 'control' },
    h('label', { class: 'control-label', for: options.id }, options.label, output),
    input,
  );
}

export function button(
  label: string,
  onClick: () => void,
  opts: { variant?: 'primary' | 'ghost'; id?: string } = {},
): HTMLButtonElement {
  return h('button', {
    type: 'button',
    class: `btn btn-${opts.variant ?? 'ghost'}`,
    ...(opts.id ? { id: opts.id } : {}),
    onclick: onClick,
  }, label);
}

/** A native select with a visible label and a custom chevron (template §4.2). */
export function select(options: {
  id: string;
  label: string;
  value: string;
  choices: { value: string; label: string }[];
  onChange: (v: string) => void;
}): HTMLElement {
  const node = h(
    'select',
    {
      id: options.id,
      class: 'select',
      onchange: (event: Event) => options.onChange((event.target as HTMLSelectElement).value),
    },
    ...options.choices.map((c) =>
      h('option', { value: c.value, ...(c.value === options.value ? { selected: true } : {}) }, c.label),
    ),
  );
  return h(
    'div',
    { class: 'control' },
    h('label', { class: 'control-label', for: options.id }, options.label),
    h('div', { class: 'select-wrap' }, node),
  );
}

/**
 * A live output region. One per panel, rather than a live region per verdict:
 * a dozen simultaneous `role="status"` elements announce over each other.
 */
export function liveRegion(id: string): HTMLElement {
  return h('div', { class: 'output', id, role: 'status', 'aria-live': 'polite' });
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}
