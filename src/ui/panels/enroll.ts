/**
 * Acts 3 and 4, and the headline mechanism.
 *
 * The one idea this lab exists to show is that a reading which is never the
 * same twice becomes the same key every time, and that a piece of PUBLIC data
 * is what carries that off. Asserting it in prose would teach nothing, so the
 * stepper below walks the actual arithmetic one line at a time, on the actual
 * enrolment, and compares both sides byte for byte at every point where two
 * things are supposed to be equal.
 *
 * Nothing here is animated on its own. Each stage appears because the reader
 * pressed Next.
 */

import { CODE_CHOICES, codeById } from '../../crypto/bch';
import { bitsToHex, differingPositions, toBitString, xor } from '../../crypto/bits';
import { toHex } from '../../crypto/bits';
import { keyContext } from '../../crypto/kdf';
import { DECODE_BEYOND_RADIUS, DECODE_RESIDUAL_SYNDROME } from '../../crypto/bch';
import { MISCORRECTED, syndromeEquivalence } from '../../crypto/sketch';
import { predictedFailureRate } from '../../model/stats';
import { bitGrid, comparison } from '../bitgrid';
import {
  button,
  callout,
  claim,
  clear,
  derivation,
  disclosure,
  field,
  h,
  liveRegion,
  panelIntro,
  pct,
  select,
  short,
  slider,
  tableRegion,
  verdict,
} from '../dom';
import { type Store } from '../state';

const TOTAL_STEPS = 6;
let step = 0;

export function resetEnrollStep(): void {
  step = 0;
}

export function renderEnrollPanel(root: HTMLElement, store: Store): void {
  clear(root);
  const s = store.state;

  root.append(
    panelIntro(
      'Enrol once, reproduce for ever',
      'The trick is to publish something. At enrolment the device picks a random codeword from ' +
        'an error-correcting code — a word the code knows how to repair — and publishes the ' +
        'difference between that codeword and its reading. The difference is called helper data, ' +
        'and it is not secret.',
      'Later, the device reads itself again, subtracts the helper data, and hands the result to ' +
        'the decoder. What comes back is the original codeword, because a handful of flipped ' +
        'cells is exactly the kind of damage the decoder was built to undo. Subtract once more ' +
        'and the original reading is back, bit for bit, and so is the key.',
    ),
    h(
      'div',
      { class: 'control-row' },
      select({
        id: 'code-select',
        label: 'Error-correcting code',
        value: s.codeId,
        choices: CODE_CHOICES.map((c) => {
          const code = codeById(c.id);
          return { value: c.id, label: `${code.label} — corrects ${code.t} flips in ${code.n} cells` };
        }),
        onChange: (v) => void store.setCode(v),
      }),
      slider({
        id: 'ber-slider',
        label: 'Bit-error rate of the later reading',
        min: 0,
        max: 0.3,
        step: 0.005,
        value: s.ber,
        format: (v) => `${(v * 100).toFixed(1)}%`,
        onChange: (v) => void store.setBer(v),
      }),
    ),
    h(
      'div',
      { class: 'control-row' },
      button('Enrol again', () => {
        step = 0;
        void store.enrolNow();
      }, { variant: 'primary', id: 'enrol-again' }),
      button('Take a new reading', () => {
        void store.reproduceNow();
      }, { id: 'new-reading' }),
      button('New device', () => {
        step = 0;
        void store.newDevice();
      }, { id: 'new-device' }),
    ),
    liveRegion('enroll-out'),
  );

  const out = root.querySelector<HTMLElement>('#enroll-out');
  if (!out) return;

  const enrollment = s.enrollment;
  const reproduction = s.reproduction;
  if (!enrollment || !reproduction) {
    out.append(callout('info', 'Enrolling…'));
    return;
  }

  const { code } = s;
  const w = enrollment.secret.sourceWord;
  const c = enrollment.secret.codeword;
  const helper = enrollment.pub.helper;
  const wPrime = reproduction.reading;
  const flips = differingPositions(w, wPrime);
  const offset = xor(helper, wPrime);
  const attempt = reproduction.attempt;

  // ── Who can see what ─────────────────────────────────────────────────────
  out.append(
    h(
      'div',
      { class: 'three-col' },
      h(
        'div',
        { class: 'col col-secret' },
        h('span', { class: 'tone-chip tone-secret' }, 'SECRET'),
        h('h3', {}, 'Never leaves the device'),
        field('Enrolled reading w', short(bitsToHex(w)), { id: 'col-w', full: bitsToHex(w) }),
        field('Random codeword c', short(bitsToHex(c)), { id: 'col-c', full: bitsToHex(c) }),
      ),
      h(
        'div',
        { class: 'col col-public' },
        h('span', { class: 'tone-chip tone-public' }, 'PUBLIC'),
        h('h3', {}, 'Published with the device'),
        field('Helper data h = w XOR c', short(bitsToHex(helper)), { id: 'col-h', full: bitsToHex(helper) }),
        field('Extractor salt', short(toHex(enrollment.pub.salt)), { id: 'col-salt', full: toHex(enrollment.pub.salt) }),
        field('HKDF context', new TextDecoder().decode(keyContext(code.label)), { id: 'col-context' }),
      ),
      h(
        'div',
        { class: 'col col-derived' },
        h('span', { class: 'tone-chip tone-derived' }, 'DERIVED'),
        h('h3', {}, 'Rebuilt on demand, stored nowhere'),
        field('Key = HKDF-SHA-256(w)', short(toHex(enrollment.secret.key)), {
          id: 'col-key',
          full: toHex(enrollment.secret.key),
        }),
        h('p', { class: 'col-note' }, 'The key exists only while the device is powered and reading.'),
      ),
    ),
    callout(
      'info',
      h('strong', {}, 'The helper data is public on purpose. '),
      'It is published, shipped in firmware, or written into a manufacturing record. Nothing on ' +
        'this page treats it as a secret, and the panel that measures what publishing it costs is ' +
        'the point of the whole lab.',
    ),
  );

  // ── The stepper ──────────────────────────────────────────────────────────
  const stages = h('div', { class: 'stages' });
  const progress = h('p', { class: 'step-progress', 'data-claim': 'enroll-step' }, `Step ${step} / ${TOTAL_STEPS}`);

  out.append(
    h('h3', {}, 'Watch the key come back'),
    h(
      'div',
      { class: 'stepper-controls' },
      button('‹ Back', () => {
        if (step > 0) {
          step--;
          renderEnrollPanel(root, store);
        }
      }, { id: 'step-back' }),
      button('Next ›', () => {
        if (step < TOTAL_STEPS) {
          step++;
          renderEnrollPanel(root, store);
        }
      }, { variant: 'primary', id: 'step-next' }),
      button('Restart', () => {
        step = 0;
        renderEnrollPanel(root, store);
      }, { id: 'step-restart' }),
      progress,
    ),
    stages,
  );

  const back = root.querySelector<HTMLButtonElement>('#step-back');
  const next = root.querySelector<HTMLButtonElement>('#step-next');
  if (back) back.disabled = step === 0;
  if (next) next.disabled = step === TOTAL_STEPS;

  const stage = (n: number, title: string, ...children: (Node | string | null)[]): void => {
    if (step < n) return;
    stages.append(
      h('section', { class: 'stage', 'data-stage': String(n) }, h('h4', {}, `${n}. ${title}`), ...children),
    );
  };

  stage(
    0,
    'The device reads itself',
    h('p', {}, 'This reading is the secret. It is used, and then it is gone.'),
    bitGrid(w, { title: 'Enrolled reading w', tone: 'secret', id: 'stage-w' }),
  );

  stage(
    1,
    'Pick a random codeword, publish the difference',
    h(
      'p',
      {},
      `A codeword is drawn uniformly from all 2^${code.k} codewords of ${code.label}. ` +
        'The helper data is the XOR of the reading and that codeword — which is why it looks ' +
        'like nothing: a uniform codeword masks the reading completely, one bit at a time.',
    ),
    bitGrid(c, { title: 'Random codeword c', tone: 'secret', id: 'stage-c' }),
    bitGrid(helper, { title: 'Helper data h = w XOR c — published', tone: 'public', id: 'stage-h' }),
  );

  stage(
    2,
    'Some time later, the device reads itself again',
    h(
      'p',
      {},
      flips.length === 0
        ? 'This time every cell came up the same. That is the easy case, and the page says so rather than pretending it was hard.'
        : `${flips.length} cell${flips.length === 1 ? '' : 's'} came up differently. The device has no way to know which.`,
    ),
    bitGrid(wPrime, {
      title: "Later reading w'",
      tone: 'secret',
      marks: flips,
      markLabel: 'differ from the enrolled reading',
      id: 'stage-wprime',
    }),
  );

  stage(
    3,
    'Subtract the helper data',
    h(
      'p',
      {},
      "h XOR w' = (w XOR c) XOR (w XOR e) = c XOR e. The reading cancels itself out and what is " +
        'left is the codeword with exactly those same cells flipped. The decoder has never seen ' +
        'the reading and does not need to.',
    ),
    bitGrid(offset, {
      title: "h XOR w' — the codeword, damaged",
      tone: 'derived',
      marks: flips,
      markLabel: 'the flipped cells, now errors on a codeword',
      id: 'stage-offset',
    }),
  );

  // The codeword the decoder settled on, reconstructed from the public helper
  // and the word it recovered -- the same identity the device uses, run backwards.
  const decodedCodeword = attempt.recoveredWord ? xor(helper, attempt.recoveredWord) : null;

  if (attempt.decodeStatus === 'failure') {
    stage(
      4,
      'Decode — and fail',
      h(
        'p',
        {},
        `The damage is past what ${code.label} can repair. The decoder does not guess: it reports ` +
          'a failure code and stops.',
      ),
      verdict('decode', 'fail', 'Decoding failed', {
        detail: `${attempt.failureCode} · ${attempt.detail}`,
        check: 'construction',
      }),
      field('Failure code', String(attempt.failureCode), { id: 'decode-failure-code' }),
      callout(
        'caveat',
        `${flips.length} cells flipped and this code corrects ${code.t}. ` +
          'A real device would be unable to unlock. That is the correct behaviour — the ' +
          'alternative is a device that hands out a wrong key and says nothing.',
      ),
    );
    stage(5, 'No codeword, so no reading', verdict('recover-word', 'fail', 'No source word to recover', { check: 'construction' }));
    stage(6, 'No reading, so no key', verdict('recover-key', 'fail', 'No key derived', { check: 'construction' }));
  } else {
    stage(
      4,
      'Decode — the flips are found and undone',
      h(
        'p',
        {},
        attempt.errorPositions.length === 0
          ? 'Nothing to correct: the offset was already a codeword.'
          : `The decoder located ${attempt.errorPositions.length} error position${attempt.errorPositions.length === 1 ? '' : 's'} and flipped them back. It did this from the syndromes alone, with no knowledge of the reading.`,
      ),
      decodedCodeword
        ? bitGrid(decodedCodeword, {
            title: 'Decoded codeword',
            tone: 'derived',
            marks: attempt.errorPositions,
            markLabel: 'positions the decoder corrected',
            id: 'stage-decoded',
          })
        : null,
      comparison({
        id: 'codeword-match',
        leftLabel: 'Codeword the decoder returned',
        leftValue: decodedCodeword ? short(bitsToHex(decodedCodeword)) : '—',
        leftFull: decodedCodeword ? bitsToHex(decodedCodeword) : '—',
        rightLabel: 'Codeword chosen at enrolment',
        rightValue: short(bitsToHex(c)),
        rightFull: bitsToHex(c),
        passText: 'Same codeword, byte for byte',
        failText: 'A DIFFERENT codeword — the decoder mis-corrected',
      }),
      field('Error positions found', attempt.errorPositions.join(', ') || 'none', { id: 'error-positions' }),
      field('Cells that actually flipped', flips.join(', ') || 'none', { id: 'actual-flips' }),
    );

    stage(
      5,
      'Subtract the helper data once more',
      h('p', {}, 'w = h XOR c. The reading is back — the whole reading, including the cells that came up differently this time.'),
      attempt.recoveredWord
        ? bitGrid(attempt.recoveredWord, { title: 'Recovered reading', tone: 'secret', id: 'stage-recovered' })
        : null,
      comparison({
        id: 'word-match',
        leftLabel: 'Recovered reading',
        leftValue: attempt.recoveredWord ? short(bitsToHex(attempt.recoveredWord)) : '—',
        leftFull: attempt.recoveredWord ? bitsToHex(attempt.recoveredWord) : '—',
        rightLabel: 'Enrolled reading',
        rightValue: short(bitsToHex(w)),
        rightFull: bitsToHex(w),
        passText: 'Identical to the enrolled reading',
        failText: 'NOT the enrolled reading',
      }),
    );

    stage(
      6,
      'Derive the key',
      h(
        'p',
        {},
        'HKDF-SHA-256, from WebCrypto, over the recovered reading with the public salt and the ' +
          'public context string. Same input, same key — which is the property that made the hash ' +
          'useless two panels ago and useful now.',
      ),
      comparison({
        id: 'key-match',
        leftLabel: 'Key derived now',
        leftValue: attempt.recoveredKey ? toHex(attempt.recoveredKey) : '—',
        rightLabel: 'Key derived at enrolment',
        rightValue: toHex(enrollment.secret.key),
        passText: 'THE SAME KEY — 32 bytes, byte for byte',
        failText: 'A DIFFERENT KEY',
      }),
      reproduction.verdict.outcome === 'miscorrected'
        ? callout(
            'danger',
            h('strong', {}, 'Mis-correction. '),
            'The decoder succeeded and was wrong: the damage carried the offset closer to a ' +
              'different codeword than the one enrolled, so it repaired towards that one. The ' +
              'device gets a perfectly well-formed 32-byte key that simply is not the right key. ' +
              'This is a distinct outcome from a decode failure, and nothing in the construction ' +
              'tells the device which of the two it just had.',
          )
        : null,
    );
  }

  // ── The outcome, and where it sits against the prediction ────────────────
  const outcome = reproduction.verdict.outcome;
  out.append(
    verdict(
      'reproduce',
      outcome === 'reproduced' ? 'pass' : outcome === 'miscorrected' ? 'alarm' : 'fail',
      outcome === 'reproduced'
        ? 'KEY REPRODUCED'
        : outcome === 'miscorrected'
          ? 'WRONG KEY RETURNED — the decoder mis-corrected'
          : 'KEY NOT REPRODUCED',
      {
        detail:
          outcome === 'reproduced'
            ? `${flips.length} flipped cell${flips.length === 1 ? '' : 's'}, all corrected`
            : outcome === 'miscorrected'
              ? MISCORRECTED
              : String(attempt.failureCode),
        check: 'construction',
      },
    ),
    h(
      'div',
      { class: 'claim-row' },
      claim('flips-this-read', 'Cells flipped this read', String(flips.length), `code corrects ${code.t}`),
      claim('predicted-failure', 'Predicted failure rate at this BER', pct(predictedFailureRate(code.n, s.ber, code.t)), 'binomial, no fitted parameter'),
      claim('code-params', 'Code', code.label, `n − k = ${code.n - code.k} parity bits`),
    ),
  );

  // ── Act 3, full depth: the helper IS the syndrome ────────────────────────
  const eq = syndromeEquivalence(code, enrollment.pub, enrollment.secret);
  out.append(
    disclosure(
      `What exactly does publishing h give away? (the ${code.n - code.k}-bit syndrome)`,
      h(
        'p',
        {},
        'A linear code splits every possible word into 2^(n−k) groups called cosets, and the ' +
          "syndrome names which group a word is in. Codewords are the group containing zero, so " +
          'a codeword has syndrome zero. Because the syndrome is linear,',
      ),
      derivation(
        'Derivation: the helper data has the same syndrome as the secret reading',
        'syn(h) = syn(w XOR c) = syn(w) XOR syn(c) = syn(w) XOR 0 = syn(w)',
      ),
      h(
        'p',
        {},
        `so the helper data has exactly the same syndrome as the secret reading. And as the random ` +
          `codeword ranges over all 2^${code.k} of them, h ranges over all 2^${code.k} words with that ` +
          `syndrome, uniformly. Publishing h therefore says which coset w is in — ${code.n - code.k} bits — ` +
          'and nothing else at all. That single sentence is the whole of the cost accounted for in ' +
          'the next panel but one.',
      ),
      comparison({
        id: 'syndrome-equivalence',
        leftLabel: 'syn(h), from public data alone',
        leftValue: toBitString(eq.helperSyndrome),
        rightLabel: 'syn(w), from the secret reading',
        rightValue: toBitString(eq.sourceSyndrome),
        passText: 'Identical — the helper carries exactly the syndrome',
        failText: 'Different — the equivalence does not hold',
      }),
      field('syn(c), the codeword', toBitString(eq.codewordSyndrome), { id: 'codeword-syndrome' }),
      h(
        'p',
        {},
        'Dodis, Reyzin and Smith call this the code-offset secure sketch; Juels and Wattenberg ' +
          'published the same construction in 1999 as fuzzy commitment.',
      ),
    ),
    disclosure(
      'Failure codes this construction can raise',
      tableRegion(
        'Failure codes this construction can raise',
        h(
        'table',
        { class: 'code-table' },
        h(
          'thead',
          {},
          h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Raised when'), h('th', {}, 'Who can see it')),
        ),
        h(
          'tbody',
          {},
          h(
            'tr',
            {},
            h('td', {}, h('code', {}, DECODE_BEYOND_RADIUS)),
            h('td', {}, 'the error-locator polynomial does not describe a correctable error pattern'),
            h('td', {}, 'the device'),
          ),
          h(
            'tr',
            {},
            h('td', {}, h('code', {}, DECODE_RESIDUAL_SYNDROME)),
            h('td', {}, 'the corrected word still has a nonzero syndrome'),
            h('td', {}, 'the device'),
          ),
          h(
            'tr',
            {},
            h('td', {}, h('code', {}, MISCORRECTED)),
            h('td', {}, 'decoding succeeded on a codeword other than the enrolled one'),
            h('td', {}, h('strong', {}, 'nobody, in a real deployment')),
          ),
        ),
        ),
      ),
      callout(
        'caveat',
        'The third row is the one worth sitting with. A real device holds no copy of the enrolled ' +
          'reading to compare against — that is the entire point of not storing it — so it cannot ' +
          'tell a correct reproduction from a mis-correction. Systems that need to know add a key ' +
          'confirmation value: a MAC or hash of the key, published alongside the helper data. That ' +
          'is an addition to this construction, not a property of it.',
      ),
    ),
  );
}
