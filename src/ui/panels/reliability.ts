/**
 * Act 5: measured reliability against the binomial prediction.
 *
 * The prediction has one moving part and no fitted parameter. A reproduction
 * succeeds exactly when the flip pattern has weight at most t, so the failure
 * rate is 1 - P(Binomial(n, BER) <= t). The sweep runs the entire pipeline —
 * enrol with a fresh random codeword, derive the real key, reproduce, compare
 * the key bytes — and the two curves are laid on top of each other.
 */

import { type ReliabilityPoint } from '../../model/trials';
import { predictedFailureRate } from '../../model/stats';
import { chart, dataTable } from '../chart';
import {
  button,
  callout,
  claim,
  clear,
  disclosure,
  h,
  liveRegion,
  panelIntro,
  pct,
  select,
  verdict,
} from '../dom';
import { type Store } from '../state';
import { runReliability } from '../worker-client';
import { Measurement, validCount, validProbability } from '../measurement';

const BER_POINTS = [0, 0.01, 0.02, 0.04, 0.06, 0.08, 0.1, 0.13, 0.16, 0.2];
let trialsPerPoint = 400;
const measurement = new Measurement<ReliabilityPoint>();

function context(store: Store): string {
  const s = store.state;
  return JSON.stringify([s.codeId, s.deviceSeed, s.skew]);
}

export function renderReliabilityPanel(root: HTMLElement, store: Store): void {
  clear(root);
  const s = store.state;
  measurement.sync(context(store));

  root.append(
    panelIntro(
      'Does it actually work as often as the maths says?',
      'Everything so far was one reading. The useful question for a device that has to unlock ' +
        'every morning for ten years is how often this fails — and whether the failure rate is ' +
        'something you can predict before shipping, or something you find out in the field.',
      'It is predictable, and the prediction is short. Reproduction succeeds exactly when at most ' +
        't cells flipped, so the failure rate is the tail of a binomial distribution. Nothing is ' +
        'fitted to the measurement below; the curve is drawn from n, t and the bit-error rate alone.',
    ),
    h(
      'div',
      { class: 'control-row' },
      select({
        id: 'trials-select',
        label: 'Trials at each bit-error rate',
        value: String(trialsPerPoint),
        choices: [200, 400, 1000, 2000].map((v) => ({ value: String(v), label: `${v} trials` })),
        onChange: (v) => {
          trialsPerPoint = Number(v);
        },
      }),
      button(
        'Run the sweep',
        () => {
          if (measurement.running) return;
          void runSweep(root, store);
        },
        { variant: 'primary', id: 'run-reliability' },
      ),
    ),
    callout(
      'scope',
      `Each trial enrols a fresh reading of the modelled device under ${s.code.label}, derives a ` +
        'real HKDF-SHA-256 key, takes a later reading at the given bit-error rate, and compares ' +
        'the reproduced key byte for byte. The sweep is seeded, so the same run gives the same ' +
        'numbers.',
    ),
    liveRegion('reliability-out'),
  );

  const out = root.querySelector<HTMLElement>('#reliability-out');
  if (!out) return;
  const runButton = root.querySelector<HTMLButtonElement>('#run-reliability');
  if (runButton) runButton.disabled = measurement.running;
  if (measurement.running) {
    out.append(h('p', { class: 'progress', 'data-claim': 'reliability-progress' }, measurement.progress));
    return;
  }
  if (measurement.error) {
    out.append(verdict('reliability-error', 'fail', 'The sweep did not finish', { detail: measurement.error }));
  }

  if (!measurement.points) {
    out.append(
      callout('info', `Press Run the sweep to measure ${BER_POINTS.length * trialsPerPoint} reproductions.`),
      predictionOnly(s.code.n, s.code.t, s.code.label),
    );
    return;
  }
  renderResults(out, measurement.points, s.code.label, s.code.n, s.code.t, s.ber);
}

function predictionOnly(n: number, t: number, label: string): HTMLElement {
  const points = BER_POINTS.map((ber) => ({ x: ber, y: predictedFailureRate(n, ber, t) }));
  return chart({
    id: 'reliability-prediction',
    xLabel: 'Bit-error rate of the later reading',
    yLabel: 'Key-failure rate',
    xTicks: BER_POINTS,
    xFormat: (v) => `${(v * 100).toFixed(0)}%`,
    series: [
      { id: 'predicted', label: `Predicted: 1 − P(Binomial(${n}, BER) ≤ ${t}) — dashed line`, kind: 'line', tone: 'predicted', points },
    ],
    summary:
      `Predicted key-failure rate for ${label} against bit-error rate, before any measurement. ` +
      points.map((p) => `at ${(p.x * 100).toFixed(0)} percent, ${pct(p.y)}`).join('; ') + '.',
  });
}

async function runSweep(root: HTMLElement, store: Store): Promise<void> {
  const s = store.state;
  const params = {
    codeId: s.codeId, deviceSeed: s.deviceSeed, skew: s.skew,
    trialSeed: 0x0b1a5, berPoints: BER_POINTS, trialsPerPoint,
  };
  await measurement.run(context(store), async (signal, progress) => {
    const points = await runReliability(params, progress, signal);
    if (points.length !== BER_POINTS.length || !points.every((p, i) =>
      p.ber === BER_POINTS[i] && p.trials === params.trialsPerPoint &&
      [p.successes, p.decodeFailures, p.misCorrections].every((v) => validCount(v, p.trials)) &&
      p.successes + p.decodeFailures + p.misCorrections === p.trials &&
      p.measured === (p.decodeFailures + p.misCorrections) / p.trials &&
      [p.measured, p.predicted, p.lo, p.hi].every(validProbability) && p.lo <= p.hi
    )) throw new Error('Incomplete or invalid reliability measurements; no agreement verdict is available.');
    return points;
  }, () => renderReliabilityPanel(root, store));
}

function renderResults(
  out: HTMLElement,
  points: ReliabilityPoint[],
  label: string,
  n: number,
  t: number,
  ber: number,
): void {
  const inside = points.filter((p) => p.predicted >= p.lo && p.predicted <= p.hi).length;
  const totalTrials = points.reduce((sum, p) => sum + p.trials, 0);

  // A four-standard-error diagnostic, not a proof or an exact tail test.
  // Wilson intervals have nominal 95% coverage; their discrete coverage and
  // the probability of a large standardized deviation depend on n and p.
  // Label the same point whose standardized deviation defines the verdict.
  const scores = points.map((p) => {
      const variance = p.predicted * (1 - p.predicted);
      // A prediction pinned at 0 or 1 has no sampling spread to measure
      // against, so it is held to exact agreement.
      if (variance <= 0) return p.measured === p.predicted ? 0 : Infinity;
      return Math.abs(p.measured - p.predicted) / Math.sqrt(variance / p.trials);
    });
  const worstZ = Math.max(...scores);
  const worst = points[scores.indexOf(worstZ)];
  const scoreText = Number.isFinite(worstZ) ? `${worstZ.toFixed(1)} standard errors out` : 'impossible under this model';

  out.append(
    chart({
      id: 'reliability',
      xLabel: 'Bit-error rate of the later reading',
      yLabel: 'Key-failure rate',
      xTicks: points.map((p) => p.ber),
      xFormat: (v) => `${(v * 100).toFixed(0)}%`,
      series: [
        {
          id: 'predicted',
          label: `Predicted: 1 − P(Binomial(${n}, BER) ≤ ${t}) — dashed line`,
          kind: 'line',
          tone: 'predicted',
          points: points.map((p) => ({ x: p.ber, y: p.predicted })),
        },
        {
          id: 'measured',
          label: 'Measured, with its 95% interval — dot and bar',
          kind: 'points',
          tone: 'measured',
          points: points.map((p) => ({ x: p.ber, y: p.measured, lo: p.lo, hi: p.hi })),
        },
      ],
      marker: { x: ber, label: `you are here: ${(ber * 100).toFixed(1)}%` },
      summary:
        `Measured key-failure rate for ${label} against the binomial prediction, ${totalTrials} reproductions in total. ` +
        points
          .map(
            (p) =>
              `at bit-error rate ${(p.ber * 100).toFixed(0)} percent, measured ${pct(p.measured)} against a predicted ${pct(p.predicted)}`,
          )
          .join('; ') +
        '.',
    }),
    callout(
      'info',
      h('strong', {}, `This code repairs up to ${t} flipped cells in ${n}. `),
      `At a bit-error rate of ${(ber * 100).toFixed(1)}% a re-read flips about ${(n * ber).toFixed(1)} ` +
        'cells on average, which is where the vertical rule on the chart sits. The curve is the ' +
        'chance that a particular re-read lands past the radius.',
    ),
    verdict(
      'reliability-agreement',
      worstZ <= 4 ? 'pass' : 'warn',
      worstZ <= 4
        ? 'The measurement agrees with the prediction everywhere it was taken'
        : 'A measured point exceeds this run’s agreement check',
      {
        detail:
          `worst point ${scoreText}, at BER ${(worst.ber * 100).toFixed(0)}% ` +
          `(${(Math.abs(worst.measured - worst.predicted) * 100).toFixed(1)} points); ` +
          `${inside} of ${points.length} 95% intervals contain the prediction`,
      },
    ),
    h(
      'div',
      { class: 'claim-row' },
      claim('reliability-trials', 'Reproductions run', String(totalTrials), `${points[0].trials} at each of ${points.length} rates`),
      claim('reliability-intervals', 'Intervals containing the prediction', `${inside} / ${points.length}`, 'nominal 95% Wilson; individual intervals can miss'),
      claim('reliability-worst-z', 'Worst point, in standard errors', Number.isFinite(worstZ) ? worstZ.toFixed(1) : 'impossible', 'four-standard-error diagnostic, not a proof'),
      claim(
        'reliability-miscorrections',
        'Mis-corrections',
        String(points.reduce((sum, p) => sum + p.misCorrections, 0)),
        'wrong key, no error raised',
      ),
    ),
    dataTable(
      `Measured against predicted key-failure rate, ${label}`,
      ['BER', 'Trials', 'Reproduced', 'Decode failures', 'Mis-corrections', 'Measured', '95% interval', 'Predicted'],
      points.map((p) => [
        `${(p.ber * 100).toFixed(1)}%`,
        String(p.trials),
        String(p.successes),
        String(p.decodeFailures),
        String(p.misCorrections),
        pct(p.measured),
        `${pct(p.lo)} – ${pct(p.hi)}`,
        pct(p.predicted),
      ]),
      'reliability',
    ),
    disclosure(
      'Mis-correction is not the same failure as a decode failure',
      h(
        'p',
        {},
        'Past the radius the decoder has two ways to be wrong, and the table counts them ' +
          'separately. It can report a failure, which is the honest outcome — the received word ' +
          'sits outside every ball of radius t and the decoder says so. Or it can land inside a ' +
          'ball belonging to a DIFFERENT codeword, correct towards that one, and report success. ' +
          'The device then derives a well-formed key that is simply not the right key.',
      ),
      h(
        'p',
        {},
        'Which of the two happens depends on the code. A short code with a small minimum distance ' +
          'mis-corrects often; a long one with a large minimum distance almost never does, because ' +
          'the balls are a vanishing fraction of a much bigger space. Select BCH(15, 7) and run the ' +
          'sweep at a high bit-error rate to see the mis-correction column fill up, and BCH(255, 131) ' +
          'to watch it stay at zero.',
      ),
    ),
    callout(
      'caveat',
      h('strong', {}, 'Where this model is kinder than a real device. '),
      'Every cell here flips at the same rate, independently, which is what makes the binomial ' +
        'exact. Real SRAM cells do not: a strongly biased cell is also a stable one, so the error ' +
        'rate varies cell by cell and correlates with the bias. A real deployment characterises ' +
        'per-cell error rates over temperature and voltage and ages the device, and the resulting ' +
        'failure rate is a measurement, not a closed form.',
    ),
  );

  if (points[0].ber === 0) {
    out.append(
      callout(
        'info',
        h('strong', {}, 'At a bit-error rate of zero the reproduction is trivial. '),
        `${points[0].successes} of ${points[0].trials} succeeded, because the later reading WAS ` +
          'the enrolled reading and the decoder had nothing to correct. It is on the chart because ' +
          'leaving it off would make the curve look steeper than it is.',
      ),
    );
  }
}
