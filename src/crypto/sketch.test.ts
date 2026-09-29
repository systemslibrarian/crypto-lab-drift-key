import { describe, expect, it } from 'vitest';
import { allCodewords, type BchCode, CODE_CHOICES, codeById, encode, isCodeword, syndromeBits } from './bch';
import { type BitVec, equal, fromHex, fromInt, toBitString, weight, xor, zeros } from './bits';
import { bytesEqual } from './kdf';
import {
  enroll,
  judge,
  KEY_MISMATCH,
  MISCORRECTED,
  HELPER_LENGTH_MISMATCH,
  reproduce,
  syndromeEquivalence,
} from './sketch';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randomBits(n: number, rand: () => number): BitVec {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = rand() < 0.5 ? 0 : 1;
  return b;
}

function errorOfWeight(n: number, w: number, rand: () => number): BitVec {
  const e = zeros(n);
  let placed = 0;
  while (placed < w) {
    const i = Math.floor(rand() * n);
    if (!e[i]) {
      e[i] = 1;
      placed++;
    }
  }
  return e;
}

const SALT = fromHex('a3e63500112233445566778899aabbcc');

describe('code-offset enrol and reproduce', () => {
  it.each(CODE_CHOICES.map((c) => c.id))(
    '%s: a re-read within the radius gives back the same key, byte for byte',
    async (id) => {
      const code = codeById(id);
      const rand = lcg(0x0ff5e7 ^ code.n);
      for (let trial = 0; trial < 12; trial++) {
        const w = randomBits(code.n, rand);
        const e = await enroll(code, w, randomBits(code.k, rand), SALT);
        const flips = Math.floor(rand() * (code.t + 1));
        const reading = xor(w, errorOfWeight(code.n, flips, rand));
        const attempt = await reproduce(code, e.pub, reading);
        const verdict = judge(attempt, e.secret);

        expect(verdict.outcome).toBe('reproduced');
        expect(verdict.keyMatches).toBe(true);
        expect(attempt.recoveredWord && equal(attempt.recoveredWord, w)).toBe(true);
        expect(attempt.recoveredKey && bytesEqual(attempt.recoveredKey, e.secret.key)).toBe(true);
        expect(attempt.errorPositions.length).toBe(flips);
      }
    },
  );

  it.each(CODE_CHOICES.map((c) => c.id))(
    '%s: past the radius the key never comes back, and the outcome is named',
    async (id) => {
      const code = codeById(id);
      const rand = lcg(0xbadbed ^ code.n);
      const outcomes = new Set<string>();
      for (let trial = 0; trial < 30; trial++) {
        const w = randomBits(code.n, rand);
        const e = await enroll(code, w, randomBits(code.k, rand), SALT);
        const flips = code.t + 1 + Math.floor(rand() * 3);
        const attempt = await reproduce(code, e.pub, xor(w, errorOfWeight(code.n, flips, rand)));
        const verdict = judge(attempt, e.secret);
        expect(verdict.keyMatches).toBe(false);
        expect(verdict.outcome).not.toBe('reproduced');
        expect(verdict.failureCode).toBeTruthy();
        outcomes.add(verdict.outcome);
      }
      expect([...outcomes].every((o) => o === 'decode-failure' || o === 'miscorrected')).toBe(true);
    },
  );

  it('BER = 0 reproduces trivially and the decoder says it corrected nothing', async () => {
    const code = codeById('bch-63-39');
    const w = randomBits(code.n, lcg(7));
    const e = await enroll(code, w, randomBits(code.k, lcg(11)), SALT);
    const attempt = await reproduce(code, e.pub, w);
    expect(attempt.decodeStatus).toBe('clean');
    expect(attempt.errorPositions).toEqual([]);
    expect(judge(attempt, e.secret).outcome).toBe('reproduced');
  });

  it('a mis-correction really does return a well-formed key for the wrong codeword', async () => {
    // Hand-built rather than hoped for: take a codeword c, a second codeword c2
    // at exactly the minimum distance, and push the reading to the midpoint so
    // the decoder lands on c2. BCH(15,7) has d = 5 and t = 2, so a weight-3
    // error toward c2 leaves the received word at distance 2 from c2.
    const code = codeById('bch-15-7');
    const words = allCodewords(code);
    const c = words[1];
    const c2 = words.find((x) => weight(xor(x, c)) === 5);
    expect(c2).toBeTruthy();
    if (!c2) return;

    const delta = xor(c, c2);
    const towards = zeros(code.n);
    let moved = 0;
    for (let i = 0; i < code.n && moved < 3; i++) {
      if (delta[i]) {
        towards[i] = 1;
        moved++;
      }
    }
    const w = randomBits(code.n, lcg(3));
    // Enrol with c itself as the random codeword, so the offset arithmetic below
    // is exact rather than probabilistic.
    const fixed = await enroll(code, w, c.slice(code.n - code.k), SALT);
    expect(equal(fixed.secret.codeword, c)).toBe(true);

    const reading = xor(w, towards);
    const attempt = await reproduce(code, fixed.pub, reading);
    const verdict = judge(attempt, fixed.secret);

    expect(attempt.decodeStatus).toBe('corrected');
    expect(verdict.outcome).toBe('miscorrected');
    expect(verdict.failureCode).toBe(MISCORRECTED);
    expect(verdict.keyMatches).toBe(false);
    // The key is well formed: full length, and simply wrong.
    expect(attempt.recoveredKey?.length).toBe(32);
    expect(attempt.recoveredWord && equal(attempt.recoveredWord, w)).toBe(false);
  });

  it('KEY_MISMATCH is raised when the word matches but the key does not', () => {
    // Constructed directly, because the construction cannot produce it: HKDF is
    // deterministic, so a matching word always gives a matching key. The branch
    // exists so a future salt- or context-handling bug is named rather than
    // reported as a mis-correction.
    const word = fromInt(0b1011, 15);
    const verdict = judge(
      {
        decodeStatus: 'corrected',
        failureCode: null,
        detail: '',
        errorPositions: [],
        recoveredWord: word,
        recoveredKey: new Uint8Array(32).fill(1),
      },
      { sourceWord: word, codeword: zeros(15), key: new Uint8Array(32).fill(2) },
    );
    expect(verdict.outcome).toBe('miscorrected');
    expect(verdict.failureCode).toBe(KEY_MISMATCH);
    expect(verdict.wordMatches).toBe(true);
  });

  it('a helper of the wrong length fails closed with its own code', async () => {
    const code = codeById('bch-31-16');
    const attempt = await reproduce(
      code,
      { helper: zeros(30), salt: SALT, codeLabel: code.label },
      zeros(31),
    );
    expect(attempt.failureCode).toBe(HELPER_LENGTH_MISMATCH);
    expect(attempt.recoveredKey).toBeNull();
  });

  it('refuses to enrol a source word of the wrong length', async () => {
    const code = codeById('bch-31-16');
    await expect(enroll(code, zeros(30), zeros(code.k), SALT)).rejects.toThrow(/source word length/);
  });
});

describe('the helper reveals exactly the syndrome (Act 3 equivalence)', () => {
  it.each(CODE_CHOICES.map((c) => c.id))('%s: syn(h) = syn(w), and syn(c) = 0', async (id) => {
    const code = codeById(id);
    const rand = lcg(0x5a17 ^ code.n);
    for (let trial = 0; trial < 20; trial++) {
      const w = randomBits(code.n, rand);
      const e = await enroll(code, w, randomBits(code.k, rand), SALT);
      const eq = syndromeEquivalence(code, e.pub, e.secret);
      expect(eq.holds).toBe(true);
      expect(toBitString(eq.helperSyndrome)).toBe(toBitString(eq.sourceSyndrome));
      expect(weight(eq.codewordSyndrome)).toBe(0);
      expect(eq.helperSyndrome.length).toBe(code.n - code.k);
    }
  });

  it('every helper for a given w lands in the same coset, and the coset has 2^k members', () => {
    // Exhaustive on the small code: as the random codeword ranges over all 128
    // of them, the helper ranges over exactly the 128 words sharing w's
    // syndrome. That set is what an attacker learns from the helper; its size
    // is 2^k, so the helper narrowed 2^n candidates to 2^k -- a loss of exactly
    // n - k bits, measured rather than quoted.
    const code = codeById('bch-15-7');
    const w = fromInt(0b101100110011010, code.n);
    const target = toBitString(syndromeBits(code, w));
    const helpers = new Set<string>();
    for (const c of allCodewords(code)) {
      const h = xor(w, c);
      expect(toBitString(syndromeBits(code, h))).toBe(target);
      helpers.add(toBitString(h));
    }
    expect(helpers.size).toBe(1 << code.k);

    // And nothing outside the coset shares the syndrome.
    let sharing = 0;
    for (let v = 0; v < 1 << code.n; v++) {
      if (toBitString(syndromeBits(code, fromInt(v, code.n))) === target) sharing++;
    }
    expect(sharing).toBe(1 << code.k);
  });

  it('a codeword is exactly a word whose syndrome is zero', () => {
    const code: BchCode = codeById('bch-15-7');
    let zero = 0;
    for (let v = 0; v < 1 << code.n; v++) {
      const word = fromInt(v, code.n);
      const isZero = weight(syndromeBits(code, word)) === 0;
      expect(isZero).toBe(isCodeword(code, word));
      if (isZero) zero++;
    }
    expect(zero).toBe(1 << code.k);
    expect(encode(code, zeros(code.k)).every((b) => b === 0)).toBe(true);
  });
});
