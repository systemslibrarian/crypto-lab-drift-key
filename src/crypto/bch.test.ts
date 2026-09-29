import { describe, expect, it } from 'vitest';
import {
  allCodewords,
  type BchCode,
  CODE_CHOICES,
  codeById,
  DECODE_BEYOND_RADIUS,
  DECODE_RESIDUAL_SYNDROME,
  decode,
  encode,
  fieldSyndromes,
  isCodeword,
  makeBch,
  messageOf,
  minimumDistance,
  nearestCodeword,
  syndromeBits,
} from './bch';
import { distance, equal, fromInt, weight, xor, zeros } from './bits';

/**
 * A small deterministic generator for the random-parameter sweeps. Not
 * cryptographic and not trying to be: it exists so a failing case is
 * reproducible from the seed printed in the test name.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randomMessage(k: number, rand: () => number): Uint8Array {
  const m = new Uint8Array(k);
  for (let i = 0; i < k; i++) m[i] = rand() < 0.5 ? 0 : 1;
  return m;
}

function errorOfWeight(n: number, w: number, rand: () => number): Uint8Array {
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

describe('BCH parameters', () => {
  // The classical (n, k) pairs. `makeBch` derives k from deg(g), so agreement
  // with the published table is a known-answer test of the whole generator
  // pipeline: cyclotomic cosets, minimal polynomials, and the GF(2) collapse.
  const KNOWN: ReadonlyArray<[number, number, number, number]> = [
    [4, 1, 15, 11],
    [4, 2, 15, 7],
    [4, 3, 15, 5],
    [5, 2, 31, 21],
    [5, 3, 31, 16],
    [5, 5, 31, 11],
    [5, 7, 31, 6],
    [6, 3, 63, 45],
    [6, 4, 63, 39],
    [6, 5, 63, 36],
    [6, 7, 63, 24],
    [7, 5, 127, 92],
    [7, 10, 127, 64],
    [7, 13, 127, 50],
    [8, 10, 255, 179],
    [8, 18, 255, 131],
  ];

  it.each(KNOWN)('BCH over GF(2^%i) with t=%i is (%i, %i)', (m, t, n, k) => {
    const code = makeBch(m, t);
    expect(code.n).toBe(n);
    expect(code.k).toBe(k);
  });

  it.each(CODE_CHOICES.map((c) => c.id))('%s generator divides x^n + 1', (id) => {
    const code = codeById(id);
    // x^n + 1 reduced modulo g must be zero: a cyclic code's generator divides it.
    const xn1 = zeros(code.n + 1);
    xn1[0] = 1;
    xn1[code.n] = 1;
    const r = Uint8Array.from(xn1);
    const degG = code.gen.length - 1;
    for (let i = r.length - 1; i >= degG; i--) {
      if (!r[i]) continue;
      for (let j = 0; j <= degG; j++) r[i - degG + j] ^= code.gen[j];
    }
    expect(weight(r)).toBe(0);
  });

  it.each(CODE_CHOICES.map((c) => c.id))('%s encodes systematically into codewords', (id) => {
    const code = codeById(id);
    const rand = lcg(0xbc4 + code.n);
    for (let trial = 0; trial < 40; trial++) {
      const msg = randomMessage(code.k, rand);
      const c = encode(code, msg);
      expect(c.length).toBe(code.n);
      expect(isCodeword(code, c)).toBe(true);
      expect(weight(syndromeBits(code, c))).toBe(0);
      expect(fieldSyndromes(code, c).every((s) => s === 0)).toBe(true);
      expect([...messageOf(code, c)]).toEqual([...msg]);
    }
  });

  it('BCH(15,7) has minimum distance 5, so t = 2 is exactly its radius', () => {
    expect(minimumDistance(makeBch(4, 2))).toBe(5);
  });

  it('rejects a message of the wrong length rather than padding it', () => {
    const code = makeBch(4, 2);
    expect(() => encode(code, new Uint8Array(6))).toThrow(/message length/);
  });
});

describe('BCH(15,7,t=2) decoded exhaustively against a brute-force oracle', () => {
  const code = makeBch(4, 2);
  const codewords = allCodewords(code);

  it('enumerates exactly 2^k codewords', () => {
    expect(codewords.length).toBe(1 << code.k);
    expect(new Set(codewords.map((c) => c.join(''))).size).toBe(1 << code.k);
  });

  it('corrects every error of weight <= t on every codeword', () => {
    const patterns: Uint8Array[] = [zeros(code.n)];
    for (let i = 0; i < code.n; i++) patterns.push(fromInt(1 << i, code.n));
    for (let i = 0; i < code.n; i++) {
      for (let j = i + 1; j < code.n; j++) {
        patterns.push(fromInt((1 << i) | (1 << j), code.n));
      }
    }
    expect(patterns.length).toBe(1 + 15 + 105);

    let corrected = 0;
    let clean = 0;
    for (const c of codewords) {
      for (const e of patterns) {
        const received = xor(c, e);
        const result = decode(code, received);
        const w = weight(e);

        if (w === 0) {
          expect(result.status).toBe('clean');
          clean++;
        } else {
          expect(result.status).toBe('corrected');
          if (result.status !== 'corrected') continue;
          expect(equal(result.word, c)).toBe(true);
          expect([...result.errorPositions].sort((a, b) => a - b)).toEqual(
            [...e].flatMap((bit, i) => (bit ? [i] : [])),
          );
          corrected++;
        }

        // Independent oracle: the nearest codeword by exhaustive search shares
        // no arithmetic with the decoder. At weight <= t it is unique.
        const near = nearestCodeword(code, received, codewords);
        expect(near.distance).toBe(w);
        expect(near.ties).toBe(1);
        expect(equal(near.codeword, c)).toBe(true);
      }
    }
    expect(clean).toBe(128);
    expect(corrected).toBe(128 * 120);
  });

  it('never silently succeeds on weight t+1: it fails, or lands on a DIFFERENT codeword', () => {
    let failures = 0;
    let miscorrections = 0;
    for (const c of codewords) {
      for (let i = 0; i < code.n; i++) {
        for (let j = i + 1; j < code.n; j++) {
          for (let l = j + 1; l < code.n; l++) {
            const e = fromInt((1 << i) | (1 << j) | (1 << l), code.n);
            const received = xor(c, e);
            const result = decode(code, received);

            expect(result.status).not.toBe('clean');
            if (result.status === 'failure') {
              failures++;
              // A failure is only honest if no codeword was actually within t.
              expect(nearestCodeword(code, received, codewords).distance).toBeGreaterThan(code.t);
              continue;
            }
            expect(result.status).toBe('corrected');
            if (result.status !== 'corrected') continue;
            // The whole point: a success past the radius is a WRONG codeword.
            expect(equal(result.word, c)).toBe(false);
            expect(isCodeword(code, result.word)).toBe(true);
            expect(distance(result.word, received)).toBeLessThanOrEqual(code.t);
            const near = nearestCodeword(code, received, codewords);
            expect(near.distance).toBeLessThanOrEqual(code.t);
            expect(equal(near.codeword, result.word)).toBe(true);
            miscorrections++;
          }
        }
      }
    }
    expect(failures + miscorrections).toBe(128 * 455);
    // Both branches must actually occur, or the sweep proved only one of them.
    expect(failures).toBeGreaterThan(0);
    expect(miscorrections).toBeGreaterThan(0);
  });
});

describe('the production codes on random words', () => {
  function sweep(code: BchCode, trials: number, seed: number): void {
    const rand = lcg(seed);
    for (let trial = 0; trial < trials; trial++) {
      const c = encode(code, randomMessage(code.k, rand));
      const w = Math.floor(rand() * (code.t + 1));
      const e = errorOfWeight(code.n, w, rand);
      const result = decode(code, xor(c, e));
      if (w === 0) {
        expect(result.status).toBe('clean');
        continue;
      }
      expect(result.status).toBe('corrected');
      if (result.status !== 'corrected') continue;
      expect(equal(result.word, c)).toBe(true);
      expect(result.errorPositions.length).toBe(w);
    }
  }

  it.each(CODE_CHOICES.map((c) => c.id))('%s corrects random errors of weight <= t', (id) => {
    sweep(codeById(id), 120, 0x5eed ^ id.length);
  });

  it.each(CODE_CHOICES.map((c) => c.id))('%s never returns the sent codeword past t', (id) => {
    const code = codeById(id);
    const rand = lcg(0xfa11 ^ code.n);
    let sawFailure = 0;
    let sawMiscorrection = 0;
    for (let trial = 0; trial < 160; trial++) {
      const c = encode(code, randomMessage(code.k, rand));
      const w = code.t + 1 + Math.floor(rand() * 4);
      const result = decode(code, xor(c, errorOfWeight(code.n, w, rand)));
      expect(result.status).not.toBe('clean');
      if (result.status === 'failure') {
        expect(result.failureCode).toBeTruthy();
        sawFailure++;
      } else if (result.status === 'corrected') {
        expect(equal(result.word, c)).toBe(false);
        expect(isCodeword(code, result.word)).toBe(true);
        sawMiscorrection++;
      }
    }
    expect(sawFailure + sawMiscorrection).toBe(160);
    // Just past the radius the overwhelmingly likely outcome is a declared
    // failure; this records that the failure branch is the one being exercised.
    expect(sawFailure).toBeGreaterThan(0);
  });

});

describe('BCH(15,7) decoding characterised over the whole 2^15 space', () => {
  const code = makeBch(4, 2);
  const codewords = allCodewords(code);

  /**
   * The strongest statement available about a bounded-distance decoder, and the
   * one the fuzzy extractor rests on: across EVERY word in the space, the
   * decoder corrects exactly the words inside some ball of radius t and
   * declares failure on exactly the words outside every ball. The code is not
   * perfect (128 balls x 121 words = 15,488 of 32,768), so both outcomes are
   * populated and neither branch is vacuous. The nearest-codeword oracle
   * decides which is which, and it shares no arithmetic with the decoder.
   */
  it('corrects inside a ball and fails outside every ball, with no third case', () => {
    let inside = 0;
    let outside = 0;
    for (let v = 0; v < 1 << code.n; v++) {
      const received = fromInt(v, code.n);
      const near = nearestCodeword(code, received, codewords);
      const result = decode(code, received);

      if (near.distance <= code.t) {
        expect(near.ties).toBe(1);
        inside++;
        if (near.distance === 0) {
          expect(result.status).toBe('clean');
        } else {
          expect(result.status).toBe('corrected');
        }
        if (result.status === 'failure') continue;
        expect(equal(result.word, near.codeword)).toBe(true);
        expect(result.errorPositions.length).toBe(near.distance);
      } else {
        outside++;
        expect(result.status).toBe('failure');
        if (result.status !== 'failure') continue;
        expect([DECODE_BEYOND_RADIUS, DECODE_RESIDUAL_SYNDROME]).toContain(result.failureCode);
      }
    }
    expect(inside).toBe(128 * (1 + 15 + 105));
    expect(outside).toBe((1 << code.n) - inside);
    expect(outside).toBeGreaterThan(0);
  });

  it('every failure over the whole space is BEYOND_RADIUS, never a residual syndrome', () => {
    // The measurement behind the comment on DECODE_RESIDUAL_SYNDROME in bch.ts.
    // Deleting the codeword verification that raises it leaves the entire suite
    // green, so its unreachability is asserted rather than assumed: if
    // Berlekamp-Massey or the Chien search ever changes in a way that lets an
    // inconsistent locator through the root-count test, this fails and the
    // comment fails with it.
    const seen = new Set<string>();
    for (let v = 0; v < 1 << code.n; v++) {
      const result = decode(code, fromInt(v, code.n));
      if (result.status === 'failure') seen.add(result.failureCode);
    }
    expect([...seen]).toEqual([DECODE_BEYOND_RADIUS]);
    expect(seen.has(DECODE_RESIDUAL_SYNDROME)).toBe(false);
  });

  it('the all-ones word is a codeword here, so a "saturated" input decodes clean', () => {
    // Recorded because it is the counter-example to the obvious test: "fill the
    // word with ones and expect a failure" asserts something false about this
    // code. BCH(15,7) contains the all-ones vector.
    const ones = new Uint8Array(code.n).fill(1);
    expect(isCodeword(code, ones)).toBe(true);
    expect(decode(code, ones).status).toBe('clean');
  });
  it('rejects a received word of the wrong length', () => {
    expect(() => decode(makeBch(4, 2), new Uint8Array(14))).toThrow(/received length/);
  });
});
