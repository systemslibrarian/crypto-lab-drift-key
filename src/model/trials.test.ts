import { describe, expect, it } from 'vitest';
import { codeById } from '../crypto/bch';
import { attackSweep, reliabilitySweep } from './trials';
import { log2ChanceLevel, minEntropyBits, residualBoundBits } from './stats';
import { makeDevice } from './source';

/**
 * Every sweep here is SEEDED, and the seed is part of the test.
 *
 * With the seed pinned the result is a fixed measurement: it passes every time
 * or it fails every time, and a failure means the arithmetic moved rather than
 * the dice. Fresh randomness would make a 95% interval go red one run in twenty
 * by construction, which is a test that fails on its own schedule.
 *
 * WHAT THE TOLERANCE IS, AND WHY IT IS NOT THE 95% INTERVAL. A Monte Carlo
 * estimate of a probability p from N trials has standard error
 * sqrt(p(1-p)/N), and the agreement asserted here is four of those. The 95%
 * interval is the right thing to PUT ON THE PAGE, where a reader is looking at
 * one measurement; it is the wrong thing to assert across a dozen seeded points,
 * because a 1-in-20 tail per point is a suite that reds out routinely. It did:
 * BCH(63,39) at BER 0.12 measured 0.912 against a predicted 0.888 on 1200
 * trials, a 2.6-sigma draw. That was checked rather than tuned away -- 200,000
 * direct samples of the flip weight gave P(wt > t) = 0.88838 against the
 * predicted 0.88789, and over 20,000 decodes the decoder returned the enrolled
 * codeword for every error of weight <= t and for NONE of weight > t. The model
 * and the prediction agree; the one point was sampling.
 *
 * Four sigma is a 1-in-15,000 tail per point, so the suite is stable, and it
 * still catches any systematic error above a few percent -- which is what a
 * broken decoder, a mis-stated t, or a flip generator that is not Bernoulli
 * would produce. `claims.spec.ts` separately re-derives the Wilson interval the
 * PAGE prints from the counts the page prints, so the displayed arithmetic is
 * checked too.
 */
const DEVICE_SEED = 0x7a11e5;
const TRIAL_SEED = 0x0b1a5;

/** Four standard errors of a proportion estimated from `trials` samples. */
function tolerance(p: number, trials: number): number {
  return 4 * Math.sqrt((p * (1 - p)) / trials) + 1 / trials;
}

describe('measured reliability against the binomial prediction', () => {
  it.each([
    ['bch-15-7', [0.02, 0.08, 0.2]],
    ['bch-63-39', [0.02, 0.05, 0.12]],
    ['bch-127-64', [0.04, 0.08, 0.13]],
  ] as const)('%s: the prediction lies inside the measured 95%% interval', async (id, bers) => {
    const points = await reliabilitySweep({
      codeId: id,
      deviceSeed: DEVICE_SEED,
      skew: 0.5,
      trialSeed: TRIAL_SEED,
      berPoints: bers,
      trialsPerPoint: 1200,
    });
    expect(points.length).toBe(bers.length);
    for (const p of points) {
      expect(p.trials).toBe(1200);
      expect(Math.abs(p.measured - p.predicted)).toBeLessThanOrEqual(
        tolerance(p.predicted, p.trials),
      );
      expect(p.successes + p.decodeFailures + p.misCorrections).toBe(p.trials);
      expect(p.measured).toBeCloseTo((p.trials - p.successes) / p.trials, 12);
      // The interval the page prints is recomputed from the counts the page prints.
      // Floating-point slack: at zero observed successes the Wilson lower bound
      // is mathematically 0 and evaluates to ~6e-18, so an exact comparison
      // fails on rounding rather than on anything about the measurement.
      expect(p.lo).toBeLessThanOrEqual(p.measured + 1e-12);
      expect(p.hi).toBeGreaterThanOrEqual(p.measured - 1e-12);
    }
  });

  it('BER = 0 is a trivial success, and the page is entitled to say so', async () => {
    const [point] = await reliabilitySweep({
      codeId: 'bch-63-39',
      deviceSeed: DEVICE_SEED,
      skew: 0.7,
      trialSeed: TRIAL_SEED,
      berPoints: [0],
      trialsPerPoint: 300,
    });
    expect(point.successes).toBe(300);
    expect(point.measured).toBe(0);
    expect(point.predicted).toBe(0);
    expect(point.misCorrections).toBe(0);
  });

  it('mis-correction is a distinct outcome, and BCH(15,7) reaches it', async () => {
    const [point] = await reliabilitySweep({
      codeId: 'bch-15-7',
      deviceSeed: DEVICE_SEED,
      skew: 0.5,
      trialSeed: TRIAL_SEED,
      berPoints: [0.2],
      trialsPerPoint: 800,
    });
    expect(point.misCorrections).toBeGreaterThan(0);
    expect(point.decodeFailures).toBeGreaterThan(0);
    expect(point.successes + point.decodeFailures + point.misCorrections).toBe(800);
  });

  it('the failure rate rises monotonically across the swept range', async () => {
    const points = await reliabilitySweep({
      codeId: 'bch-127-64',
      deviceSeed: DEVICE_SEED,
      skew: 0.5,
      trialSeed: TRIAL_SEED,
      berPoints: [0, 0.02, 0.05, 0.08, 0.12, 0.18],
      trialsPerPoint: 400,
    });
    for (let i = 1; i < points.length; i++) {
      expect(points[i].measured).toBeGreaterThanOrEqual(points[i - 1].measured);
      expect(points[i].predicted).toBeGreaterThanOrEqual(points[i - 1].predicted);
    }
  });

  it('the skew does not move the reliability curve, because the axes are independent', async () => {
    const at = async (skew: number) =>
      (
        await reliabilitySweep({
          codeId: 'bch-63-39',
          deviceSeed: DEVICE_SEED,
          skew,
          trialSeed: TRIAL_SEED,
          berPoints: [0.06],
          trialsPerPoint: 900,
        })
      )[0];
    const flat = await at(0.5);
    const skewed = await at(0.95);
    expect(flat.predicted).toBe(skewed.predicted);
    // Same seed, same flip stream: the two runs differ only through the source
    // words, which the outcome does not depend on.
    expect(Math.abs(flat.measured - skewed.measured)).toBeLessThan(0.05);
  });
});

describe('the measured guessing attack against the entropy accounting', () => {
  it('is nil at zero skew and rises with it, matching the exact probability', async () => {
    const code = codeById('bch-63-39');
    const points = await attackSweep({
      codeId: 'bch-63-39',
      deviceSeed: DEVICE_SEED,
      trialSeed: TRIAL_SEED,
      skewPoints: [0.5, 0.8, 0.9, 0.95, 0.99],
      trialsPerPoint: 600,
    });

    expect(points[0].successes).toBe(0);
    expect(points[0].minEntropy).toBeCloseTo(code.n, 8);
    expect(points[0].residual).toBeCloseTo(code.n - (code.n - code.k), 8);
    expect(log2ChanceLevel(code.n, code.t)).toBeLessThan(-40);

    for (const p of points) {
      expect(Math.abs(p.measured - p.exact)).toBeLessThanOrEqual(tolerance(p.exact, p.trials));
      expect(p.loss).toBe(code.n - code.k);
      expect(p.residual).toBeCloseTo(p.minEntropy - p.loss, 10);
      // Floating-point slack: at zero observed successes the Wilson lower bound
      // is mathematically 0 and evaluates to ~6e-18, so an exact comparison
      // fails on rounding rather than on anything about the measurement.
      expect(p.lo).toBeLessThanOrEqual(p.measured + 1e-12);
      expect(p.hi).toBeGreaterThanOrEqual(p.measured - 1e-12);
    }
    for (let i = 1; i < points.length; i++) {
      expect(points[i].minEntropy).toBeLessThan(points[i - 1].minEntropy);
      expect(points[i].residual).toBeLessThan(points[i - 1].residual);
    }
    expect(points[points.length - 1].measured).toBeGreaterThan(0.4);
  });

  it('the residual goes negative well before the attack starts winning', async () => {
    // The honest gap: "no guarantee left" is not the same statement as "broken".
    // This records where the two actually part company for this device.
    const code = codeById('bch-63-39');
    const points = await attackSweep({
      codeId: 'bch-63-39',
      deviceSeed: DEVICE_SEED,
      trialSeed: TRIAL_SEED,
      skewPoints: [0.8],
      trialsPerPoint: 600,
    });
    const p = points[0];
    expect(p.residual).toBeLessThan(0);
    expect(p.measured).toBeLessThan(0.05);
    expect(minEntropyBits(makeDevice(code.n, DEVICE_SEED, 0.8).pMax)).toBeCloseTo(p.minEntropy, 10);
    expect(residualBoundBits(p.minEntropy, p.loss)).toBeCloseTo(p.residual, 10);
  });

  it('the entropy figures come from the device, not from the sweep', () => {
    const code = codeById('bch-127-64');
    const device = makeDevice(code.n, DEVICE_SEED, 0.9);
    const m = minEntropyBits(device.pMax);
    expect(residualBoundBits(m, code.n - code.k)).toBeCloseTo(m - 63, 10);
    expect(makeDevice(code.n, DEVICE_SEED, 0.9).pMax).toEqual(device.pMax);
  });
});
