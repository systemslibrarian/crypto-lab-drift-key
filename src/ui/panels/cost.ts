/**
 * Act 6: what publishing the helper data costs, and the negative claim.
 *
 * Three numbers, all computed from the model parameters on screen:
 *
 *   m            the source's min-entropy, sum over cells of -log2 max(p, 1-p)
 *   n - k        the sketch loss, the width of the syndrome the helper reveals
 *   m - (n - k)  the residual bound on the AVERAGE MIN-ENTROPY OF THE SOURCE
 *                GIVEN THE HELPER
 *
 * The third is deliberately allowed to be zero or negative and is drawn that
 * way. Below zero the page says there is no entropy guarantee left. It does NOT
 * say the helper leaks more than n - k bits, because it does not: the bound
 * already covers non-uniform sources without modification. What bias changes is
 * m, so the same subtraction can leave nothing.
 *
 * Beside those numbers is a measured attack that uses only public data. It is
 * the reason the accounting is not an abstraction.
 */

import { NO_CODE_FOR_WEAK_SOURCE } from '../../crypto/sketch';
import { bitsToHex, differingPositions } from '../../crypto/bits';
import { toHex } from '../../crypto/bits';
import { type AttackPoint } from '../../model/trials';
import {
  exactAttackSuccess,
  log2ChanceLevel,
  minEntropyBits,
  residualBoundBits,
  residualVerdict,
  sketchLossBits,
} from '../../model/stats';
import { MAX_SKEW, MIN_SKEW } from '../../model/source';
import { bitGrid } from '../bitgrid';
import { chart, dataTable } from '../chart';
import {
  button,
  callout,
  claim,
  clear,
  derivation,
  disclosure,
  field,
  fmt,
  h,
  liveRegion,
  panelIntro,
  pct,
  short,
  slider,
  tableRegion,
  verdict,
} from '../dom';
import { type Store } from '../state';
import { runAttack as runAttackSweep } from '../worker-client';

/**
 * The negative claim. One sentence naming a security property this
 * construction does not provide, scoped to the construction on this page and
 * not to the field.
 */
export const NEGATIVE_CLAIM =
  'Reproducing the key correctly is not evidence that any secrecy is left. This construction ' +
  'raises no failure code for a source that never had enough min-entropy: enrolment, decoding ' +
  'and reproduction behave identically whether the residual bound is 64 bits or 50 bits below zero.';

const SKEW_POINTS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.93, 0.96, 0.99];
let sweepPoints: AttackPoint[] | null = null;
let sweepCodeId = '';
let sweeping = false;

export function renderCostPanel(root: HTMLElement, store: Store): void {
  clear(root);
  const s = store.state;
  if (sweepCodeId && sweepCodeId !== s.codeId) sweepPoints = null;

  const m = minEntropyBits(s.device.pMax);
  const loss = sketchLossBits(s.code.n, s.code.k);
  const residual = residualBoundBits(m, loss);
  const state = residualVerdict(residual);

  root.append(
    panelIntro(
      'The helper data is public. What does that cost?',
      'Publishing anything derived from a secret costs some of the secret. The useful thing about ' +
        'this construction is that the cost is not an estimate — it is a bound you can write down ' +
        'before you build anything, and it depends only on the code you chose.',
      'A linear code with n-bit codewords carrying k bits of message has n − k parity bits. The ' +
        'helper data reveals exactly which of the 2^(n−k) cosets the reading is in, and nothing ' +
        'else, so it costs at most n − k bits of the reading’s min-entropy. Whether what is ' +
        'left is enough depends entirely on how much the source had to begin with.',
    ),
    h(
      'div',
      { class: 'control-row' },
      slider({
        id: 'skew-slider',
        label: 'Cell skew — the average of max(p, 1 − p) across cells',
        min: MIN_SKEW,
        max: MAX_SKEW,
        step: 0.01,
        value: s.skew,
        format: (v) => v.toFixed(2),
        onChange: (v) => void store.setSkew(v),
      }),
    ),
    h(
      'div',
      { class: 'control-row' },
      button('Run the attack on this enrolment', () => void store.runAttack(), {
        variant: 'primary',
        id: 'run-attack',
      }),
      button(
        'Sweep the bias',
        () => {
          if (!sweeping) void runSweep(root, store);
        },
        { id: 'run-attack-sweep' },
      ),
      button('Weak-source fixture', () => void store.weakSourceFixture(), { id: 'weak-fixture' }),
    ),
    entropyBar({ m, loss, residual, n: s.code.n, k: s.code.k, state }),
    h(
      'div',
      { class: 'claim-row' },
      claim('min-entropy', 'Source min-entropy m', `${fmt(m, 1)} bits`, `over ${s.code.n} cells`),
      claim('sketch-loss', 'Sketch loss n − k', `${loss} bits`, 'fixed by the code'),
      claim(
        'residual',
        'Residual bound m − (n − k)',
        `${fmt(residual, 1)} bits`,
        state === 'none' ? 'no guarantee left' : state === 'thin' ? 'thin' : 'a real guarantee',
      ),
    ),
    verdict(
      'residual-state',
      state === 'none' ? 'alarm' : state === 'thin' ? 'warn' : 'pass',
      state === 'none'
        ? 'NO ENTROPY GUARANTEE LEFT'
        : state === 'thin'
          ? `Guaranteed at least ${fmt(residual, 1)} bits — thin`
          : `Guaranteed at least ${fmt(residual, 1)} bits of average min-entropy`,
      {
        detail:
          state === 'none'
            ? 'the bound promises nothing at this bias; it does not say the helper leaks more'
            : 'of the source given the helper, not of the derived key',
      },
    ),
    liveRegion('cost-out'),
  );

  const out = root.querySelector<HTMLElement>('#cost-out');
  if (!out) return;

  if (s.weakFixture) {
    out.setAttribute('data-fixture', 'weak-source');
  }

  renderAttack(out, store, { m, loss, residual });
  if (sweepPoints) renderSweep(out, sweepPoints, s.code.label);

  out.append(
    h(
      'div',
      { class: 'negative-claim', 'data-negative-claim': 'weak-source-invisible' },
      h('span', { class: 'tone-chip tone-negative' }, 'WHAT THIS DOES NOT BUY'),
      h('p', {}, NEGATIVE_CLAIM),
      tableRegion(
        'Conditions and the failure code each raises',
        h(
        'table',
        { class: 'code-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Condition'), h('th', {}, 'Failure code raised'))),
        h(
          'tbody',
          {},
          h('tr', {}, h('td', {}, 'The later reading drifted past the code’s radius'), h('td', {}, h('code', {}, 'DECODE_BEYOND_RADIUS'))),
          h('tr', {}, h('td', {}, 'The helper data is the wrong length'), h('td', {}, h('code', {}, 'HELPER_LENGTH_MISMATCH'))),
          h(
            'tr',
            { class: 'row-absent' },
            h('td', {}, 'The source never had enough min-entropy'),
            h('td', {}, h('code', { 'data-claim': 'weak-source-code' }, NO_CODE_FOR_WEAK_SOURCE), ' — there is none'),
          ),
        ),
        ),
      ),
      h(
        'p',
        {},
        'The last row is the exhibit. There is no code to raise, because the construction never ' +
          'looks: it corrects errors and derives a key, and how much entropy the source had is a ' +
          'property of the device that no step in the pipeline measures. Characterising the ' +
          'source is a separate job, done with real hardware over temperature and voltage and ' +
          'lifetime, and nothing on this page or in this construction substitutes for it.',
      ),
    ),
    disclosure(
      'The formulas, and what each quantity is actually about',
      h('h4', {}, 'Source min-entropy'),
      derivation(
        'Formula: the source min-entropy as a sum over cells',
        'm = H_inf(W) = -log2 max_w Pr[W = w]\n  = sum over cells of -log2 max(p_i, 1 - p_i)',
      ),
      h(
        'p',
        {},
        'The cells are independent in this model, so the most likely word is the per-cell ' +
          'majority and its probability is the product of the per-cell maxima. Min-entropy, not ' +
          'Shannon entropy: what matters for a key is the probability of the single best guess, ' +
          'not the average surprise.',
      ),
      h('h4', {}, 'The sketch loss, and what the residual is a bound on'),
      derivation(
        'Bound: the residual average min-entropy of the source given the sketch',
        'Hinf~(W | SS(W))  >=  H_inf(W) - (n - k)',
      ),
      h(
        'p',
        {},
        'SS(W) is the code-offset sketch — the helper data. The left-hand side is the AVERAGE ' +
          'MIN-ENTROPY of the source given the helper: how hard W still is to guess for someone ' +
          'holding the published data. The bound holds for any source with min-entropy m, ' +
          'uniform or not.',
      ),
      callout(
        'caveat',
        h('strong', {}, 'This is not the entropy of the key. '),
        'The key comes from a separate extraction step, which has its own loss. The security ' +
          'proof for fuzzy extractors uses a strong randomness extractor — universal hashing and ' +
          'the leftover hash lemma — and gives an information-theoretic statement about how close ' +
          'the output is to uniform. This lab derives its key with HKDF-SHA-256 instead, which is ' +
          'what a real device ships and rests on different assumptions. Nothing on this page ' +
          'claims a bit count for the key itself.',
      ),
      h(
        'p',
        {},
        `For ${s.code.label} on this device: m = ${fmt(m, 2)} bits, n − k = ${loss} bits, ` +
          `residual ≥ ${fmt(residual, 2)} bits.`,
      ),
    ),
  );
}

interface BarInput {
  m: number;
  loss: number;
  residual: number;
  n: number;
  k: number;
  state: 'guaranteed' | 'thin' | 'none';
}

/**
 * The entropy bar.
 *
 * The residual row has its own zero line and a negative residual extends to the
 * LEFT of it. The template's visual-honesty rule and the brief both single this
 * out: a negative residual drawn as a short positive bar would be a picture
 * that contradicts the number beside it.
 */
function entropyBar(input: BarInput): HTMLElement {
  const scale = Math.max(input.m, input.loss, 1);
  const wide = (bits: number): string => `${Math.max(0, Math.min(100, (bits / scale) * 100))}%`;
  const deficit = Math.max(0, -input.residual);
  const zeroAt = deficit > 0 ? Math.min(60, (deficit / scale) * 100 + 6) : 4;

  return h(
    'div',
    { class: 'entropy-bar', 'data-claim': 'entropy-bar' },
    h(
      'div',
      { class: 'bar-row' },
      h('span', { class: 'bar-label' }, 'Source min-entropy m'),
      h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill bar-entropy', style: `width:${wide(input.m)}` })),
      h('span', { class: 'bar-value', 'data-claim': 'bar-m' }, `${fmt(input.m, 1)} bits`),
    ),
    h(
      'div',
      { class: 'bar-row' },
      h('span', { class: 'bar-label' }, `Sketch loss n − k (${input.n} − ${input.k})`),
      h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill bar-loss', style: `width:${wide(input.loss)}` })),
      h('span', { class: 'bar-value', 'data-claim': 'bar-loss' }, `${input.loss} bits`),
    ),
    h(
      'div',
      { class: 'bar-row bar-row-residual' },
      h('span', { class: 'bar-label' }, 'Residual bound'),
      h(
        'div',
        { class: 'bar-track bar-track-signed' },
        h('div', { class: 'bar-zero', style: `left:${zeroAt}%` }, h('span', { class: 'bar-zero-label' }, '0')),
        input.residual > 0
          ? h('div', {
              class: 'bar-fill bar-residual',
              style: `left:${zeroAt}%;width:${Math.min(100 - zeroAt, (input.residual / scale) * 100)}%`,
            })
          : h('div', {
              class: 'bar-fill bar-deficit',
              style: `left:${Math.max(0, zeroAt - (deficit / scale) * 100)}%;width:${Math.min(zeroAt, (deficit / scale) * 100)}%`,
            }),
      ),
      h(
        'span',
        { class: `bar-value ${input.residual > 0 ? '' : 'bar-value-deficit'}`, 'data-claim': 'bar-residual' },
        `${fmt(input.residual, 1)} bits`,
      ),
    ),
    h(
      'p',
      { class: 'bar-note' },
      input.state === 'none'
        ? `The loss exceeds the source’s min-entropy by ${fmt(deficit, 1)} bits, so the bound guarantees nothing. It is drawn below zero because it is below zero.`
        : 'The residual is a lower bound on the average min-entropy of the source given the helper data.',
    ),
  );
}

function renderAttack(out: HTMLElement, store: Store, acct: { m: number; loss: number; residual: number }): void {
  const s = store.state;
  const attack = s.attack;
  const exact = exactAttackSuccess(s.device.pMax, s.code.t);
  const chance = log2ChanceLevel(s.code.n, s.code.t);

  out.append(
    h('h3', {}, 'An attacker with nothing but the public data'),
    h(
      'p',
      {},
      'Suppose someone has the published helper data, the published salt, the code parameters, ' +
        'and characterisation data for this family of devices — which is to say, the bias model. ' +
        'They do not have the device. The obvious attack is to guess the most likely reading, ' +
        'hand it to the ordinary reproduction routine, and see what key comes out.',
    ),
    h(
      'div',
      { class: 'claim-row' },
      claim('attack-exact', 'Success probability at this bias', pct(exact), 'exact, from the model'),
      claim('attack-chance', 'One guess against a fair-coin source', `2^${fmt(chance, 1)}`, 'the chance level'),
      claim('attack-radius', 'Attack wins when the guess is within', `${s.code.t} flips`, `of the enrolled reading`),
    ),
  );

  if (!attack) {
    out.append(callout('info', 'Press "Run the attack on this enrolment" to try it against the real key.'));
    return;
  }

  const enrolled = s.enrollment?.secret.sourceWord;
  const marks = enrolled ? differingPositions(attack.result.guess, enrolled) : [];
  const reproduced = s.reproduction?.verdict.outcome === 'reproduced';

  out.append(
    bitGrid(attack.result.guess, {
      title: 'The attacker’s guess: every cell takes its lean',
      tone: 'public',
      marks,
      markLabel: 'wrong, compared with the enrolled reading',
      id: 'attack-guess',
    }),
    h(
      'div',
      { class: 'claim-row' },
      claim('attack-distance', 'Cells the guess got wrong', String(attack.distanceToTruth), `code corrects ${s.code.t}`),
      claim('attack-enrolments', 'Enrolments watched', String(attack.enrolmentsWatched), 'before this result'),
      claim(
        'attack-key',
        'Key the attacker derived',
        attack.result.candidateKey ? short(toHex(attack.result.candidateKey), 8) : 'none — decode failed',
        attack.result.candidateKey ? '32 bytes' : String(attack.result.failureCode),
      ),
    ),
    verdict(
      'attack',
      attack.keyMatched ? 'alarm' : 'pass',
      attack.keyMatched ? 'THE ATTACKER HAS THE KEY' : 'The attacker did not get the key',
      {
        detail: attack.keyMatched
          ? `guess was ${attack.distanceToTruth} flips from the enrolled reading, inside the radius of ${s.code.t}`
          : `guess was ${attack.distanceToTruth} flips away, outside the radius of ${s.code.t}`,
      },
    ),
  );

  if (s.weakFixture) {
    out.append(
      verdict(
        'weak-source-headline',
        attack.keyMatched && reproduced ? 'alarm' : 'warn',
        attack.keyMatched && reproduced
          ? 'KEY REPRODUCED — AND RECOVERED FROM PUBLIC DATA'
          : 'The fixture did not reach both outcomes at once',
        {
          detail: `residual bound ${fmt(acct.residual, 1)} bits; every check the construction performs passed`,
        },
      ),
      callout(
        'danger',
        h('strong', {}, 'Both of those are true at the same time, and that is the point. '),
        'The device enrolled, decoded and reproduced its key exactly as it does on a good source. ' +
          'Every check on this page that the construction actually performs reports success. And ' +
          'the key is already in the hands of anyone holding the published helper data, because ' +
          `this source has ${fmt(acct.m, 1)} bits of min-entropy and the sketch costs ${acct.loss}.`,
      ),
      field('Helper data — public', short(bitsToHex(s.enrollment?.pub.helper ?? new Uint8Array())), {
        id: 'fixture-helper',
        full: bitsToHex(s.enrollment?.pub.helper ?? new Uint8Array()),
      }),
    );
  }

  out.append(
    callout(
      'caveat',
      h('strong', {}, 'The attack succeeding is consistent with the bound, not a violation of it. '),
      'The bound says the helper costs at most n − k bits. It does not promise that what is left ' +
        'is enough — and at this bias there is nothing left for it to protect. Equally, a residual ' +
        'at or below zero does not mean this particular attacker wins: the bound going quiet and ' +
        'the source becoming guessable are two different thresholds, and the sweep below shows how ' +
        'far apart they are.',
    ),
  );
}

async function runSweep(root: HTMLElement, store: Store): Promise<void> {
  const s = store.state;
  const out = root.querySelector<HTMLElement>('#cost-out');
  const btn = root.querySelector<HTMLButtonElement>('#run-attack-sweep');
  if (!out) return;
  sweeping = true;
  if (btn) btn.disabled = true;
  const progress = h('p', { class: 'progress', 'data-claim': 'attack-progress' }, 'Starting…');
  out.prepend(progress);
  try {
    const points = await runAttackSweep(
      {
        codeId: s.codeId,
        deviceSeed: s.deviceSeed,
        trialSeed: 0x0b1a5,
        skewPoints: SKEW_POINTS,
        trialsPerPoint: 300,
      },
      (done, total) => {
        progress.textContent = `${done} of ${total} enrolments attacked`;
      },
    );
    sweepPoints = points;
    sweepCodeId = s.codeId;
    renderCostPanel(root, store);
  } catch (error) {
    progress.replaceWith(verdict('attack-sweep-error', 'fail', 'The sweep did not finish', { detail: String(error) }));
  } finally {
    sweeping = false;
    if (btn) btn.disabled = false;
  }
}

function renderSweep(out: HTMLElement, points: AttackPoint[], label: string): void {
  const firstNegative = points.find((p) => p.residual <= 0);
  const firstWinning = points.find((p) => p.measured >= 0.1);

  out.append(
    h('h3', {}, 'The whole bias range, measured'),
    chart({
      id: 'attack',
      xLabel: 'Cell skew — average max(p, 1 − p)',
      yLabel: 'Attacker success rate',
      xTicks: points.map((p) => p.skew),
      xFormat: (v) => v.toFixed(2),
      series: [
        {
          id: 'exact',
          label: 'Exact success probability for this bias model — dashed line',
          kind: 'line',
          tone: 'predicted',
          points: points.map((p) => ({ x: p.skew, y: p.exact })),
        },
        {
          id: 'measured',
          label: 'Measured, with its 95% interval — dot and bar',
          kind: 'points',
          tone: 'measured',
          points: points.map((p) => ({ x: p.skew, y: p.measured, lo: p.lo, hi: p.hi })),
        },
      ],
      summary:
        `Measured attacker success rate for ${label} against cell skew. ` +
        points
          .map(
            (p) =>
              `at skew ${p.skew.toFixed(2)}, min-entropy ${p.minEntropy.toFixed(1)} bits, residual ${p.residual.toFixed(1)} bits, measured success ${(p.measured * 100).toFixed(1)} percent`,
          )
          .join('; ') +
        '.',
    }),
    dataTable(
      `Attacker success against the entropy accounting, ${label}`,
      ['Skew', 'm (bits)', 'n − k', 'Residual', 'Trials', 'Won', 'Measured', '95% interval', 'Exact'],
      points.map((p) => [
        p.skew.toFixed(2),
        fmt(p.minEntropy, 1),
        String(p.loss),
        fmt(p.residual, 1),
        String(p.trials),
        String(p.successes),
        pct(p.measured),
        `${pct(p.lo)} – ${pct(p.hi)}`,
        pct(p.exact),
      ]),
      'attack',
    ),
    verdict(
      'entropy-gap',
      'info',
      firstNegative && firstWinning
        ? `The guarantee runs out at skew ${firstNegative.skew.toFixed(2)}; the attack starts winning at ${firstWinning.skew.toFixed(2)}`
        : 'The guarantee and the attack part company at different points on this axis',
      {
        detail: firstNegative
          ? `residual ${fmt(firstNegative.residual, 1)} bits where the attack still wins ${pct(firstNegative.measured)} of the time`
          : 'raise the skew further to see the residual cross zero',
      },
    ),
    callout(
      'info',
      'Read the two curves together. The residual crosses zero long before the attack becomes ' +
        'practical, which is what a bound looks like when it is doing its job: it stops promising ' +
        'well before the thing it was protecting actually breaks. A residual at zero is not a ' +
        'prediction that the key is gone — it is the point past which this construction will not ' +
        'tell you either way.',
    ),
  );
}
