import { describe, expect, it } from 'vitest';
import { weight, xor } from '../crypto/bits';
import { makePrng } from './prng';
import {
  laterReading,
  makeDevice,
  MAX_SKEW,
  MIN_SKEW,
  powerUpReading,
  probabilityOfOne,
} from './source';

describe('the device model', () => {
  it('is reproducible from its seed and changes with it', () => {
    const a = makeDevice(63, 12345, 0.8);
    const b = makeDevice(63, 12345, 0.8);
    const c = makeDevice(63, 12346, 0.8);
    expect([...a.pMax]).toEqual([...b.pMax]);
    expect([...a.lean]).toEqual([...b.lean]);
    expect([...a.lean]).not.toEqual([...c.lean]);
  });

  it('keeps each cell leaning the same way as the skew slider moves', () => {
    // The slider must make the SAME device more predictable, not swap it for a
    // different one -- otherwise the entropy bar and the attack curve are two
    // unrelated experiments drawn side by side.
    const low = makeDevice(127, 999, 0.55);
    const high = makeDevice(127, 999, 0.95);
    expect([...low.lean]).toEqual([...high.lean]);
    for (let i = 0; i < low.n; i++) expect(high.pMax[i]).toBeGreaterThanOrEqual(low.pMax[i]);
  });

  it('clamps the skew to the stated range', () => {
    expect(makeDevice(15, 1, 0.1).skew).toBe(MIN_SKEW);
    expect(makeDevice(15, 1, 2).skew).toBe(MAX_SKEW);
  });

  it('is an unbiased fair-coin source at the bottom of the range', () => {
    const d = makeDevice(255, 7, MIN_SKEW);
    for (let i = 0; i < d.n; i++) {
      expect(d.pMax[i]).toBe(0.5);
      expect(probabilityOfOne(d, i)).toBe(0.5);
    }
  });

  it('every pMax stays a probability, and matches probabilityOfOne', () => {
    for (const skew of [0.5, 0.6, 0.75, 0.9, 0.99]) {
      const d = makeDevice(127, 4242, skew);
      for (let i = 0; i < d.n; i++) {
        expect(d.pMax[i]).toBeGreaterThanOrEqual(0.5);
        expect(d.pMax[i]).toBeLessThanOrEqual(1);
        const p1 = probabilityOfOne(d, i);
        expect(Math.max(p1, 1 - p1)).toBeCloseTo(d.pMax[i], 12);
      }
    }
  });

  it('readings follow the per-cell bias to within sampling error', () => {
    const d = makeDevice(64, 31337, 0.9);
    const rng = makePrng(5);
    const N = 4000;
    const leanCount = new Int32Array(d.n);
    for (let trial = 0; trial < N; trial++) {
      const w = powerUpReading(d, rng);
      for (let i = 0; i < d.n; i++) if (w[i] === d.lean[i]) leanCount[i]++;
    }
    for (let i = 0; i < d.n; i++) {
      // 5 sigma on a binomial proportion, plus a floor for the near-certain cells.
      const sigma = Math.sqrt((d.pMax[i] * (1 - d.pMax[i])) / N);
      expect(Math.abs(leanCount[i] / N - d.pMax[i])).toBeLessThanOrEqual(5 * sigma + 0.005);
    }
  });

  it('two readings of the same device differ, which is the whole problem', () => {
    const d = makeDevice(127, 8, 0.7);
    const rng = makePrng(9);
    const a = powerUpReading(d, rng);
    const { reading: b, flips } = laterReading(a, 0.08, rng);
    expect(weight(xor(a, b))).toBeGreaterThan(0);
    expect(weight(flips)).toBe(weight(xor(a, b)));
  });

  it('BER = 0 returns the identical reading and BER = 1 inverts every cell', () => {
    const d = makeDevice(31, 3, 0.6);
    const rng = makePrng(11);
    const w = powerUpReading(d, rng);
    expect([...laterReading(w, 0, rng).reading]).toEqual([...w]);
    const all = laterReading(w, 1, rng);
    expect(weight(all.flips)).toBe(31);
    expect([...all.reading]).toEqual([...w].map((b) => b ^ 1));
  });

  it('the flip count tracks the BER across the slider range', () => {
    const rng = makePrng(77);
    const w = powerUpReading(makeDevice(255, 2, 0.5), rng);
    for (const ber of [0.02, 0.05, 0.1, 0.25]) {
      let total = 0;
      const rounds = 400;
      for (let i = 0; i < rounds; i++) total += weight(laterReading(w, ber, rng).flips);
      const mean = total / rounds;
      const sigma = Math.sqrt(255 * ber * (1 - ber));
      expect(Math.abs(mean - 255 * ber)).toBeLessThanOrEqual((5 * sigma) / Math.sqrt(rounds) + 0.5);
    }
  });
});

describe('the model PRNG', () => {
  it('is deterministic per seed and decorrelated across seeds', () => {
    const a = makePrng(1);
    const b = makePrng(1);
    const c = makePrng(2);
    const seqA = Array.from({ length: 64 }, () => a.next());
    const seqB = Array.from({ length: 64 }, () => b.next());
    const seqC = Array.from({ length: 64 }, () => c.next());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it('stays inside [0,1) and hits both halves', () => {
    const rng = makePrng(4242);
    let low = 0;
    for (let i = 0; i < 20000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      if (v < 0.5) low++;
    }
    expect(low).toBeGreaterThan(9500);
    expect(low).toBeLessThan(10500);
  });

  it('int() stays in range and chance() tracks its probability', () => {
    const rng = makePrng(7);
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(13);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(13);
    }
    let hits = 0;
    for (let i = 0; i < 20000; i++) if (rng.chance(0.25)) hits++;
    expect(Math.abs(hits / 20000 - 0.25)).toBeLessThan(0.02);
  });
});
