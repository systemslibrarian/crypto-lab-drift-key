/**
 * The bit grid: one square per cell of the source word.
 *
 * VISUAL SEMANTICS. A cell's value is drawn as fill vs no-fill, never as one
 * colour against another, so it survives grayscale and every form of colour
 * vision. A cell called out — flipped between two readings, or named by the
 * decoder as an error position — gets a thick ring in addition to whatever
 * colour the tone carries, so the call-out is a shape and not a hue.
 *
 * The three tones are the lab's whole visual vocabulary for who can see what,
 * and each carries its own word in the caption rather than relying on the tint:
 *   SECRET   the source word, the codeword, the key.
 *   PUBLIC   the helper data, the salt, the bias model. An attacker has these.
 *   DERIVED  the decode's own working, neither published nor enrolled.
 *
 * The grid is a `role="img"` with a text label that says everything the picture
 * does — how many cells, how many are set, which are ringed — so nothing here
 * is available only to a reader who can see it.
 */

import { type BitVec, weight } from '../crypto/bits';
import { h } from './dom';

export type GridTone = 'secret' | 'public' | 'derived' | 'neutral';

export interface GridOptions {
  /** What the grid is, in words. Becomes the start of the accessible label. */
  readonly title: string;
  readonly tone: GridTone;
  /** Cells to ring. */
  readonly marks?: readonly number[];
  /** What the ringed cells mean, for the accessible label. */
  readonly markLabel?: string;
  /** Identifier for the claims suite. */
  readonly id?: string;
}

const TONE_WORD: Record<GridTone, string> = {
  secret: 'SECRET',
  public: 'PUBLIC',
  derived: 'DERIVED',
  neutral: '',
};

function positionList(marks: readonly number[], limit = 12): string {
  if (marks.length === 0) return 'none';
  const shown = marks.slice(0, limit).join(', ');
  return marks.length > limit ? `${shown} and ${marks.length - limit} more` : shown;
}

export function bitGrid(bits: BitVec, options: GridOptions): HTMLElement {
  const marks = options.marks ?? [];
  const marked = new Set(marks);
  const ones = weight(bits);

  const summary =
    `${options.title}. ${TONE_WORD[options.tone] ? `${TONE_WORD[options.tone]}. ` : ''}` +
    `${bits.length} cells, ${ones} reading 1 and ${bits.length - ones} reading 0.` +
    (marks.length > 0
      ? ` ${marks.length} cell${marks.length === 1 ? '' : 's'} ringed (${options.markLabel ?? 'called out'}): ${positionList(marks)}.`
      : '');

  const cells = Array.from(bits, (bit, i) =>
    h('span', {
      class: `cell${bit ? ' cell-on' : ''}${marked.has(i) ? ' cell-marked' : ''}`,
    }),
  );

  return h(
    'div',
    { class: 'grid-block' },
    h(
      'div',
      { class: 'grid-caption' },
      h('span', { class: `tone-chip tone-${options.tone}` }, TONE_WORD[options.tone] || 'VALUE'),
      h('span', { class: 'grid-title' }, options.title),
      h(
        'span',
        { class: 'grid-stat', ...(options.id ? { 'data-claim': `${options.id}-stat` } : {}) },
        `${ones}/${bits.length} set${marks.length ? ` · ${marks.length} ringed` : ''}`,
      ),
    ),
    h(
      'div',
      {
        class: `grid grid-${options.tone}`,
        role: 'img',
        'aria-label': summary,
        ...(options.id ? { 'data-grid': options.id } : {}),
      },
      ...cells,
    ),
  );
}

/**
 * Two values computed by different routes, shown side by side and compared
 * byte for byte. The template's "compute both sides and compare, never assert".
 */
export function comparison(options: {
  id: string;
  leftLabel: string;
  leftValue: string;
  rightLabel: string;
  rightValue: string;
  /** Untruncated values, when the displayed ones are elided. */
  leftFull?: string;
  rightFull?: string;
  passText: string;
  failText: string;
}): HTMLElement {
  // Compare the FULL values where they exist. Comparing elided prefixes would
  // report two different words as identical, which is the one thing a
  // both-sides comparison exists not to do.
  const left = options.leftFull ?? options.leftValue;
  const right = options.rightFull ?? options.rightValue;
  const same = left === right;
  return h(
    'div',
    { class: `compare compare-${same ? 'same' : 'differ'}` },
    h(
      'div',
      { class: 'compare-row' },
      h('span', { class: 'compare-label' }, options.leftLabel),
      h(
        'code',
        {
          class: 'compare-value',
          'data-claim': `${options.id}-left`,
          ...(options.leftFull && options.leftFull !== options.leftValue ? { title: options.leftFull } : {}),
        },
        options.leftValue,
      ),
    ),
    h(
      'div',
      { class: 'compare-row' },
      h('span', { class: 'compare-label' }, options.rightLabel),
      h(
        'code',
        {
          class: 'compare-value',
          'data-claim': `${options.id}-right`,
          ...(options.rightFull && options.rightFull !== options.rightValue ? { title: options.rightFull } : {}),
        },
        options.rightValue,
      ),
    ),
    h(
      'p',
      {
        class: `verdict verdict-${same ? 'pass' : 'fail'}`,
        'data-verdict': options.id,
        'data-result': same ? 'pass' : 'fail',
        'data-check': 'construction',
      },
      h('span', { class: 'verdict-icon', 'aria-hidden': 'true' }, same ? '✓' : '✕'),
      h('strong', {}, same ? options.passText : options.failText),
    ),
  );
}
