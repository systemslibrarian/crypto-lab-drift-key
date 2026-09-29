import { describe, expect, it } from 'vitest';
import { codeById } from '../crypto/bch';
import { makeDevice } from './source';
import {
  binomialAtMost,
  exactAttackSuccess,
  log2BallSize,
  log2ChanceLevel,
  minEntropyBits,
  predictedFailureRate,
  residualBoundBits,
  residualVerdict,
  sketchLossBits,
  wilsonInterval,
} from './stats';

/** Direct factorial binomial, for small n where it is exact. An independent route. */
function binomNaive(n: number, p: number, t: number): number {
  const fact = (x: number): number => (x <= 1 ? 1 : x * fact(x - 1));
  let s = 0;
  for (let j = 0; j <= t; j++) {
    s += (fact(n) / (fact(j) * fact(n - j))) * p ** j * (1 - p) ** (n - j);
  }
  return s;
}

describe('min-entropy of the stated model', () => {
  it('is exactly n bits for a fair-coin source', () => {
    const d = makeDevice(127, 1, 0.5);
    expect(minEntropyBits(d.pMax)).toBeCloseTo(127, 10);
  });

  it('is zero for a fully determined source', () => {
    expect(minEntropyBits(new Float64Array(64).fill(1))).toBe(0);
  });

  it('matches -log2 of the most likely word, computed as a product', () => {
    const d = makeDevice(31, 5150, 0.87);
    let maxProb = 1;
    for (let i = 0; i < d.n; i++) maxProb *= d.pMax[i];
    expect(minEntropyBits(d.pMax)).toBeCloseTo(-Math.log2(maxProb), 8);
  });

  it('falls monotonically as the skew rises, which is the Act 6 thesis', () => {
    let previous = Infinity;
    for (const skew of [0.5, 0.6, 0.7, 0.8, 0.9, 0.99]) {
      const m = minEntropyBits(makeDevice(127, 11, skew).pMax);
      expect(m).toBeLessThan(previous);
      previous = m;
    }
  });
});

describe('the sketch loss and the residual bound', () => {
  it('is n - k, and does not move when the source changes', () => {
    const code = codeById('bch-127-64');
    expect(sketchLossBits(code.n, code.k)).toBe(63);
    const low = minEntropyBits(makeDevice(code.n, 3, 0.5).pMax);
    const high = minEntropyBits(makeDevice(code.n, 3, 0.95).pMax);
    expect(residualBoundBits(low, 63)).toBeCloseTo(low - 63, 12);
    expect(residualBoundBits(high, 63)).toBeCloseTo(high - 63, 12);
  });

  it('is allowed to be negative, and is not clamped to something reassuring', () => {
    expect(residualBoundBits(13.3, 63)).toBeCloseTo(-49.7, 6);
    expect(residualBoundBits(13.3, 63)).toBeLessThan(0);
  });

  it('reads a non-positive residual as no guarantee rather than a small one', () => {
    expect(residualVerdict(64)).toBe('guaranteed');
    expect(residualVerdict(12)).toBe('thin');
    expect(residualVerdict(0)).toBe('none');
    expect(residualVerdict(-49.7)).toBe('none');
  });
});

describe('the binomial reliability prediction', () => {
  it('agrees with a direct factorial computation at small n', () => {
    for (const [n, t] of [
      [15, 2],
      [31, 3],
      [20, 5],
    ] as const) {
      for (const p of [0.01, 0.05, 0.1, 0.25, 0.4]) {
        expect(binomialAtMost(n, p, t)).toBeCloseTo(binomNaive(n, p, t), 10);
      }
    }
  });

  it('handles the boundaries without special-casing them wrong', () => {
    expect(binomialAtMost(63, 0, 4)).toBe(1);
    expect(binomialAtMost(63, 1, 4)).toBe(0);
    expect(binomialAtMost(63, 1, 63)).toBe(1);
    expect(binomialAtMost(63, 0.3, -1)).toBe(0);
    expect(binomialAtMost(63, 0.5, 63)).toBe(1);
  });

  it('sums to one over the whole range at any p', () => {
    for (const p of [0.03, 0.2, 0.5, 0.77]) {
      expect(binomialAtMost(127, p, 127)).toBeCloseTo(1, 10);
    }
  });

  it('predicts zero failures at BER = 0 and certain failure at BER = 1', () => {
    const code = codeById('bch-63-39');
    expect(predictedFailureRate(code.n, 0, code.t)).toBe(0);
    expect(predictedFailureRate(code.n, 1, code.t)).toBe(1);
  });

  it('rises monotonically with the BER', () => {
    const code = codeById('bch-127-64');
    let previous = -1;
    for (const ber of [0, 0.01, 0.03, 0.06, 0.1, 0.2, 0.4]) {
      const r = predictedFailureRate(code.n, ber, code.t);
      expect(r).toBeGreaterThanOrEqual(previous);
      previous = r;
    }
  });
});

describe('ball size and the single-guess chance level', () => {
  it('counts the ball exactly at sizes a naive sum can still reach', () => {
    const choose = (n: number, j: number): number => {
      let v = 1;
      for (let i = 0; i < j; i++) v = (v * (n - i)) / (i + 1);
      return v;
    };
    for (const [n, t] of [
      [15, 2],
      [31, 3],
      [63, 4],
    ] as const) {
      let sum = 0;
      for (let j = 0; j <= t; j++) sum += choose(n, j);
      expect(log2BallSize(n, t)).toBeCloseTo(Math.log2(sum), 8);
    }
  });

  it('puts one uniform guess far below anything a decimal could show', () => {
    const code = codeById('bch-127-64');
    const level = log2ChanceLevel(code.n, code.t);
    expect(level).toBeLessThan(-70);
    expect(level).toBeGreaterThan(-90);
    // The 2^-127 floor is the whole space; the ball only helps by its log-size.
    expect(level).toBeCloseTo(log2BallSize(127, 10) - 127, 10);
  });

  it('a radius spanning the whole space gives certainty', () => {
    expect(log2ChanceLevel(15, 15)).toBeCloseTo(0, 10);
  });
});

describe('the exact attack probability', () => {
  it('is the ordinary binomial when every cell is equally skewed', () => {
    const n = 63;
    const q = 0.07;
    const pMax = new Float64Array(n).fill(1 - q);
    expect(exactAttackSuccess(pMax, 4)).toBeCloseTo(binomialAtMost(n, q, 4), 10);
  });

  it('is the chance level for a fair-coin source', () => {
    const code = codeById('bch-15-7');
    const pMax = new Float64Array(code.n).fill(0.5);
    expect(Math.log2(exactAttackSuccess(pMax, code.t))).toBeCloseTo(
      log2ChanceLevel(code.n, code.t),
      8,
    );
  });

  it('is one when every cell is certain', () => {
    expect(exactAttackSuccess(new Float64Array(31).fill(1), 0)).toBeCloseTo(1, 12);
  });

  it('rises with the skew on a real device profile', () => {
    const code = codeById('bch-63-39');
    let previous = -1;
    for (const skew of [0.5, 0.7, 0.8, 0.9, 0.99]) {
      const p = exactAttackSuccess(makeDevice(code.n, 1, skew).pMax, code.t);
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
  });
});

describe('the Wilson interval', () => {
  it('brackets the observed proportion', () => {
    const { lo, hi } = wilsonInterval(37, 200);
    expect(lo).toBeLessThan(37 / 200);
    expect(hi).toBeGreaterThan(37 / 200);
  });

  it('narrows as the sample grows', () => {
    const small = wilsonInterval(50, 100);
    const large = wilsonInterval(5000, 10000);
    expect(large.hi - large.lo).toBeLessThan(small.hi - small.lo);
  });

  it('stays inside [0, 1] at the extremes and is total with no data', () => {
    // The zero-successes lower bound lands a rounding step above zero rather
    // than on it (6.4e-18 for 0/50). Recorded rather than clamped away: the
    // arithmetic is right, and a clamp here would only hide it.
    const none = wilsonInterval(0, 50);
    expect(none.lo).toBeGreaterThanOrEqual(0);
    expect(none.lo).toBeLessThan(1e-12);
    expect(none.hi).toBeGreaterThan(0);
    expect(none.hi).toBeLessThan(1);
    expect(wilsonInterval(50, 50).hi).toBe(1);
    expect(wilsonInterval(50, 50).lo).toBeLessThan(1);
    expect(wilsonInterval(0, 0)).toEqual({ lo: 0, hi: 1 });
  });
});
