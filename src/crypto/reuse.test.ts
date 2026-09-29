import { describe, expect, it } from 'vitest';
import { allCodewords, codeById, isCodeword } from './bch';
import { type BitVec, equal, fromHex, toBitString, weight, xor, zeros } from './bits';
import { enroll, randomMessageBits } from './sketch';
import { enumerateCandidates, reuseSyndromeView, subcodeCodewords } from './reuse';
import { makePrng } from '../model/prng';

const SALT = fromHex('deadbeefcafef00d0011223344556677');

function randomBits(n: number, seed: number): BitVec {
  const rng = makePrng(seed);
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = rng.chance(0.5) ? 1 : 0;
  return b;
}

function flipAt(word: BitVec, positions: number[]): BitVec {
  const out = Uint8Array.from(word);
  for (const p of positions) out[p] ^= 1;
  return out;
}

describe('two enrolments of the same source', () => {
  it.each(['bch-15-7', 'bch-63-39', 'bch-127-64'])(
    '%s: the XOR of two helpers is a codeword, and w cancels',
    async (id) => {
      const code = codeById(id);
      const w = randomBits(code.n, 0x51 ^ code.n);
      const first = await enroll(code, w, randomMessageBits(code.k), SALT);
      const second = await enroll(code, w, randomMessageBits(code.k), SALT);

      const view = reuseSyndromeView(code, first.pub.helper, second.pub.helper);
      expect(view.syndromesEqual).toBe(true);
      expect(view.xorIsCodeword).toBe(true);
      expect(view.xorDecodeStatus).toBe('clean');
      expect(view.exposedFlipPositions).toEqual([]);
      // Independent re-derivation: the XOR really is c1 XOR c2.
      expect(equal(view.xorWord, xor(first.secret.codeword, second.secret.codeword))).toBe(true);
      expect(isCodeword(code, view.xorWord)).toBe(true);
    },
  );

  it.each(['bch-15-7', 'bch-63-39', 'bch-127-64'])(
    '%s: with a noisy re-read the XOR exposes the FLIPS, not the values',
    async (id) => {
      const code = codeById(id);
      const w = randomBits(code.n, 0x9e ^ code.n);
      const positions = Array.from({ length: code.t }, (_, i) => (i * 7 + 3) % code.n);
      const unique = [...new Set(positions)].sort((a, b) => a - b);
      const wPrime = flipAt(w, unique);

      const first = await enroll(code, w, randomMessageBits(code.k), SALT);
      const second = await enroll(code, wPrime, randomMessageBits(code.k), SALT);
      const view = reuseSyndromeView(code, first.pub.helper, second.pub.helper);

      expect(view.syndromesEqual).toBe(false);
      expect(view.xorIsCodeword).toBe(false);
      expect(view.xorDecodeStatus).toBe('corrected');
      expect(view.exposedFlipPositions).toEqual(unique);
      // What is exposed is exactly the noise pattern, whose own value is e.
      expect(weight(xor(w, wPrime))).toBe(unique.length);
    },
  );

  it('a re-read past the radius leaves the XOR undecodable, and says so', async () => {
    const code = codeById('bch-15-7');
    const w = randomBits(code.n, 42);
    const wPrime = flipAt(w, [0, 2, 4, 6, 8, 10, 12]);
    const first = await enroll(code, w, randomMessageBits(code.k), SALT);
    const second = await enroll(code, wPrime, randomMessageBits(code.k), SALT);
    const view = reuseSyndromeView(code, first.pub.helper, second.pub.helper);
    if (view.xorDecodeStatus === 'failure') {
      expect(view.failureCode).toBeTruthy();
      expect(view.exposedFlipPositions).toEqual([]);
    } else {
      // Or it mis-corrects, in which case the positions it names are wrong --
      // still nothing about w, which is the claim under test.
      expect(view.exposedFlipPositions.length).toBeLessThanOrEqual(code.t);
    }
  });
});

describe('the bits-of-w-learned counter, by enumeration', () => {
  const code = codeById('bch-15-7');
  const full = allCodewords(code);

  it('reads exactly zero for the correct construction, counted not assumed', async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = randomBits(code.n, seed);
      const a = await enroll(code, w, randomMessageBits(code.k), SALT);
      const b = await enroll(code, w, randomMessageBits(code.k), SALT);
      const count = enumerateCandidates(code, a.pub.helper, b.pub.helper, full);

      expect(count.codewordsConsidered).toBe(128);
      expect(count.candidatesFromFirst).toBe(128);
      expect(count.candidatesAfterSecond).toBe(128);
      expect(count.bitsLearnedFromSecond).toBe(0);
      expect(count.consistent).toBe(true);
      // The first helper cost n - k = 8 bits: 2^15 candidates down to 2^7.
      expect(count.bitsLostToFirst).toBe(code.n - code.k);
    }
  });

  it('still reads zero when the second reading is noisy but within the radius', async () => {
    const w = randomBits(code.n, 77);
    const a = await enroll(code, w, randomMessageBits(code.k), SALT);
    const b = await enroll(code, flipAt(w, [3, 9]), randomMessageBits(code.k), SALT);
    const count = enumerateCandidates(code, a.pub.helper, b.pub.helper, full);
    expect(count.candidatesAfterSecond).toBe(128);
    expect(count.bitsLearnedFromSecond).toBe(0);
  });

  it('is a MEASUREMENT: a codeword drawn from half the code makes it move', async () => {
    // The broken variant. C' has dimension 4 instead of 7, so the first helper
    // narrows w to 16 candidates rather than 128 -- 11 bits lost where the
    // construction promises 8. Reproduction is unaffected, which is the lesson.
    const dim = 4;
    const sub = subcodeCodewords(code, dim);
    expect(sub.length).toBe(1 << dim);
    for (const c of sub) expect(isCodeword(code, c)).toBe(true);

    const w = randomBits(code.n, 101);
    const msgA = new Uint8Array(code.k);
    const msgB = new Uint8Array(code.k);
    for (let i = 0; i < dim; i++) {
      msgA[i] = i % 2;
      msgB[i] = (i + 1) % 2;
    }
    const a = await enroll(code, w, msgA, SALT);
    const b = await enroll(code, w, msgB, SALT);

    const broken = enumerateCandidates(code, a.pub.helper, b.pub.helper, sub);
    expect(broken.candidatesFromFirst).toBe(16);
    expect(broken.bitsLostToFirst).toBe(code.n - dim);
    expect(broken.bitsLostToFirst).toBeGreaterThan(code.n - code.k);
    // The SECOND helper still adds nothing; it is the FIRST that leaks more.
    expect(broken.candidatesAfterSecond).toBe(16);
    expect(broken.bitsLearnedFromSecond).toBe(0);

    // And the same two helpers, counted against the full code, read the
    // construction's own figure -- so the counter tracks what it is given.
    const asFull = enumerateCandidates(code, a.pub.helper, b.pub.helper, full);
    expect(asFull.candidatesFromFirst).toBe(128);
    expect(asFull.bitsLostToFirst).toBe(code.n - code.k);
  });

  it('reports inconsistency, not a bit count, when no pair is within the radius', () => {
    // Two helpers that cannot both come from one within-radius pair of readings.
    const h1 = zeros(code.n);
    const h2 = Uint8Array.from(h1);
    for (let i = 0; i < code.n; i++) h2[i] = i % 2;
    const count = enumerateCandidates(code, h1, h2, subcodeCodewords(code, 1));
    if (!count.consistent) {
      expect(count.candidatesAfterSecond).toBe(0);
      expect(Number.isNaN(count.bitsLearnedFromSecond)).toBe(true);
    } else {
      expect(count.bitsLearnedFromSecond).toBe(0);
    }
  });

  it('refuses to enumerate a subcode too large to walk', () => {
    expect(() => subcodeCodewords(codeById('bch-127-64'), 64)).toThrow(/refusing to enumerate/);
    expect(() => subcodeCodewords(code, 9)).toThrow(/outside/);
  });

  it('the surviving set is a real intersection test, not a length read-off', () => {
    // Hand-built: two helpers whose cosets are far apart under a 1-codeword set.
    const single = [zeros(code.n)];
    const h1 = zeros(code.n);
    const h2 = Uint8Array.from(h1);
    h2[0] = 1;
    h2[1] = 1;
    h2[2] = 1;
    const count = enumerateCandidates(code, h1, h2, single);
    // Distance 3 > t = 2, so the one candidate does not survive.
    expect(count.candidatesFromFirst).toBe(1);
    expect(count.candidatesAfterSecond).toBe(0);
    expect(count.consistent).toBe(false);
    expect(toBitString(h2).slice(0, 3)).toBe('111');
  });
});
