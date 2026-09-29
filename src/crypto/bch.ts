/**
 * Binary primitive narrow-sense BCH codes: generator polynomial, systematic
 * encoding, syndromes, Berlekamp-Massey, Chien search.
 *
 * Hand-rolled, because the code is the teaching subject. The whole fuzzy
 * extractor rests on one property of this file — that a word within t flips of
 * a codeword decodes back to that codeword, and a word further away does not
 * quietly pretend to — so the decoder returns a discriminated result and never
 * a best guess dressed as a success.
 *
 * `bch.test.ts` verifies BCH(15,7,t=2) exhaustively: all 128 codewords against
 * every error pattern of weight <= 2, each answer cross-checked against a
 * brute-force nearest-codeword search that shares no code with the decoder, and
 * all 58,240 weight-3 patterns checked to confirm the decoder either fails or
 * lands on a DIFFERENT codeword. Never the original one, never "clean".
 */

import { type BitVec, weight, xor, zeros } from './bits';
import { alphaPow, gfDiv, gfMul, makeGF, type GF } from './gf2m';

export interface BchCode {
  readonly m: number;
  /** Block length, 2^m - 1. */
  readonly n: number;
  /** Message length, n - deg(g). Derived, never assumed. */
  readonly k: number;
  /** Designed error-correcting capability. */
  readonly t: number;
  readonly gf: GF;
  /** Generator polynomial over GF(2), coefficient of x^i at index i. */
  readonly gen: BitVec;
  /** Human label, e.g. "BCH(127, 64), t = 10". */
  readonly label: string;
}

/** The exponents whose minimal polynomials multiply to g: {1..2t} closed under doubling. */
function rootExponents(n: number, t: number): number[] {
  const seen = new Set<number>();
  for (let j = 1; j <= 2 * t; j++) {
    let e = j % n;
    while (!seen.has(e)) {
      seen.add(e);
      e = (e * 2) % n;
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/** Multiply two polynomials whose coefficients are GF(2^m) elements. */
function polyMulGF(gf: GF, a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) {
      if (b[j] === 0) continue;
      out[i + j] ^= gfMul(gf, a[i], b[j]);
    }
  }
  return out;
}

export function makeBch(m: number, t: number): BchCode {
  const gf = makeGF(m);
  const n = gf.n;
  if (t < 1 || 2 * t >= n) throw new Error(`t=${t} out of range for n=${n}`);

  // g(x) = product over the conjugacy-closed root set of (x + alpha^j). The set
  // is closed under the Frobenius map x -> x^2, which is exactly what forces
  // every coefficient back into GF(2); the assertion below measures that rather
  // than trusting it.
  let g: number[] = [1];
  for (const e of rootExponents(n, t)) {
    g = polyMulGF(gf, g, [alphaPow(gf, e), 1]);
  }
  const gen = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) {
    if (g[i] !== 0 && g[i] !== 1) {
      throw new Error(`generator coefficient ${g[i]} at x^${i} is not in GF(2)`);
    }
    gen[i] = g[i];
  }

  const k = n - (gen.length - 1);
  if (k <= 0) throw new Error(`BCH(m=${m}, t=${t}) has no information bits`);

  return { m, n, k, t, gf, gen, label: `BCH(${n}, ${k}), t = ${t}` };
}

/** The codes offered in the UI. `k` is computed by `makeBch`, never hard-coded. */
export const CODE_CHOICES: ReadonlyArray<{ id: string; m: number; t: number }> = Object.freeze([
  { id: 'bch-15-7', m: 4, t: 2 },
  { id: 'bch-31-16', m: 5, t: 3 },
  { id: 'bch-63-39', m: 6, t: 4 },
  { id: 'bch-127-64', m: 7, t: 10 },
  { id: 'bch-255-131', m: 8, t: 18 },
]);

/**
 * The smallest code, used wherever an exhibit or a test enumerates all 2^k
 * codewords. 128 codewords is small enough to list; BCH(127, 64) is not.
 */
export const SMALL_CODE_ID = 'bch-15-7';

export function codeById(id: string): BchCode {
  const spec = CODE_CHOICES.find((c) => c.id === id);
  if (!spec) throw new Error(`unknown code id: ${id}`);
  return makeBch(spec.m, spec.t);
}

/** Remainder of a GF(2) polynomial modulo the generator. Length n - k. */
function polyModGen(code: BchCode, word: BitVec): BitVec {
  const r = Uint8Array.from(word);
  const degG = code.gen.length - 1;
  for (let i = word.length - 1; i >= degG; i--) {
    if (!r[i]) continue;
    for (let j = 0; j <= degG; j++) r[i - degG + j] ^= code.gen[j];
  }
  return r.slice(0, degG);
}

/**
 * The (n - k)-bit syndrome: the received word reduced modulo g(x).
 *
 * This is the object the entropy accounting is about. A linear [n, k] code has
 * 2^(n-k) cosets, the syndrome names which one a word is in, and the code-offset
 * helper reveals exactly that and nothing more — which is why the sketch costs
 * at most n - k bits and not, say, n.
 */
export function syndromeBits(code: BchCode, word: BitVec): BitVec {
  if (word.length !== code.n) throw new Error(`word length ${word.length} != n ${code.n}`);
  return polyModGen(code, word);
}

/** The 2t field syndromes S_j = r(alpha^j), j = 1..2t, as used by the decoder. */
export function fieldSyndromes(code: BchCode, word: BitVec): Int32Array {
  const { gf, t, n } = code;
  const s = new Int32Array(2 * t);
  for (let j = 1; j <= 2 * t; j++) {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      if (word[i]) acc ^= alphaPow(gf, (j * i) % n);
    }
    s[j - 1] = acc;
  }
  return s;
}

export function isCodeword(code: BchCode, word: BitVec): boolean {
  return weight(syndromeBits(code, word)) === 0;
}

/**
 * Systematic encoding: c(x) = x^(n-k) u(x) + [x^(n-k) u(x) mod g(x)].
 * Message bits land in positions n-k .. n-1; parity in 0 .. n-k-1.
 */
export function encode(code: BchCode, message: BitVec): BitVec {
  if (message.length !== code.k) {
    throw new Error(`message length ${message.length} != k ${code.k}`);
  }
  const shifted = zeros(code.n);
  shifted.set(message, code.n - code.k);
  const parity = polyModGen(code, shifted);
  const out = Uint8Array.from(shifted);
  out.set(parity, 0);
  return out;
}

/** The message carried by a codeword, read straight out of the systematic part. */
export function messageOf(code: BchCode, codeword: BitVec): BitVec {
  return codeword.slice(code.n - code.k);
}

/**
 * Failure codes the decoder can raise, exported so the UI names the real cause
 * rather than paraphrasing it and the claims suite can assert on the constant.
 */
export const DECODE_BEYOND_RADIUS = 'DECODE_BEYOND_RADIUS';
export const DECODE_RESIDUAL_SYNDROME = 'DECODE_RESIDUAL_SYNDROME';
export type DecodeFailureCode = typeof DECODE_BEYOND_RADIUS | typeof DECODE_RESIDUAL_SYNDROME;

export type DecodeResult =
  | { status: 'clean'; word: BitVec; errorPositions: number[] }
  | { status: 'corrected'; word: BitVec; errorPositions: number[] }
  | { status: 'failure'; failureCode: DecodeFailureCode; detail: string };

/**
 * Berlekamp-Massey over GF(2^m). Returns the error-locator polynomial Lambda
 * (constant term first) and the register length L.
 */
function berlekampMassey(gf: GF, s: Int32Array): { lambda: number[]; L: number } {
  let lambda = [1];
  let prev = [1];
  let L = 0;
  let shift = 1;
  let b = 1;

  for (let r = 0; r < s.length; r++) {
    let delta = s[r];
    for (let i = 1; i <= L; i++) {
      if (i < lambda.length) delta ^= gfMul(gf, lambda[i], s[r - i]);
    }
    if (delta === 0) {
      shift++;
      continue;
    }
    const scale = gfDiv(gf, delta, b);
    const adjusted = lambda.slice();
    const needed = prev.length + shift;
    while (adjusted.length < needed) adjusted.push(0);
    for (let i = 0; i < prev.length; i++) {
      adjusted[i + shift] ^= gfMul(gf, scale, prev[i]);
    }
    if (2 * L <= r) {
      const old = lambda;
      lambda = adjusted;
      L = r + 1 - L;
      prev = old;
      b = delta;
      shift = 1;
    } else {
      lambda = adjusted;
      shift++;
    }
  }
  while (lambda.length > 1 && lambda[lambda.length - 1] === 0) lambda.pop();
  return { lambda, L };
}

/** Chien search: positions i in [0, n) with Lambda(alpha^-i) = 0. */
function chienSearch(gf: GF, lambda: number[], n: number): number[] {
  const roots: number[] = [];
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let d = 0; d < lambda.length; d++) {
      if (lambda[d] === 0) continue;
      acc ^= gfMul(gf, lambda[d], alphaPow(gf, (-i * d) % gf.n));
    }
    if (acc === 0) roots.push(i);
  }
  return roots;
}

/**
 * Decode a received word.
 *
 * The three verifications after the search are what make "corrected" mean
 * something: the locator degree must be within the code's radius, the Chien
 * search must find exactly that many distinct positions, and the corrected word
 * must actually be a codeword. A received word beyond the radius therefore
 * either raises a failure code or lands on a genuinely different codeword — the
 * mis-correction case, which the sketch layer detects and the UI shows as its
 * own outcome. There is no path on which a decode past the radius returns the
 * original codeword and reports success.
 */
export function decode(code: BchCode, received: BitVec): DecodeResult {
  if (received.length !== code.n) {
    throw new Error(`received length ${received.length} != n ${code.n}`);
  }
  const s = fieldSyndromes(code, received);
  if (s.every((v) => v === 0)) {
    return { status: 'clean', word: Uint8Array.from(received), errorPositions: [] };
  }

  const { lambda, L } = berlekampMassey(code.gf, s);
  if (L > code.t || lambda.length - 1 > code.t) {
    return {
      status: 'failure',
      failureCode: DECODE_BEYOND_RADIUS,
      detail: `error-locator degree ${Math.max(L, lambda.length - 1)} exceeds t = ${code.t}`,
    };
  }

  const roots = chienSearch(code.gf, lambda, code.n);
  if (roots.length !== lambda.length - 1) {
    return {
      status: 'failure',
      failureCode: DECODE_BEYOND_RADIUS,
      detail: `error-locator of degree ${lambda.length - 1} has ${roots.length} roots in the block`,
    };
  }

  const corrected = Uint8Array.from(received);
  for (const i of roots) corrected[i] ^= 1;

  if (!isCodeword(code, corrected)) {
    return {
      status: 'failure',
      failureCode: DECODE_RESIDUAL_SYNDROME,
      detail: 'the corrected word still has a nonzero syndrome',
    };
  }
  return { status: 'corrected', word: corrected, errorPositions: roots };
}

/**
 * Every codeword, in message order. Only for codes small enough to list — the
 * caller is expected to have checked. Used by the Reuse panel's exhaustive
 * cross-check and by the exhaustive tests.
 */
export function allCodewords(code: BchCode): BitVec[] {
  if (code.k > 14) throw new Error(`refusing to enumerate 2^${code.k} codewords`);
  const out: BitVec[] = [];
  for (let v = 0; v < 1 << code.k; v++) {
    const msg = new Uint8Array(code.k);
    for (let i = 0; i < code.k; i++) msg[i] = (v >>> i) & 1;
    out.push(encode(code, msg));
  }
  return out;
}

/**
 * Brute-force nearest codeword, by exhaustive search.
 *
 * Shares no code with `decode` — no field, no syndromes, no locator — so it is
 * an independent oracle rather than the same arithmetic asked twice. `ties`
 * reports whether the minimum distance is attained more than once, which is the
 * case a bounded-distance decoder is entitled to fail on.
 */
export function nearestCodeword(
  code: BchCode,
  received: BitVec,
  codewords?: BitVec[],
): { codeword: BitVec; distance: number; ties: number } {
  const list = codewords ?? allCodewords(code);
  let best = list[0];
  let bestD = Infinity;
  let ties = 0;
  for (const c of list) {
    const d = weight(xor(c, received));
    if (d < bestD) {
      bestD = d;
      best = c;
      ties = 1;
    } else if (d === bestD) {
      ties++;
    }
  }
  return { codeword: best, distance: bestD, ties };
}

/** Minimum Hamming weight over the nonzero codewords. Small codes only. */
export function minimumDistance(code: BchCode): number {
  let best = Infinity;
  for (const c of allCodewords(code)) {
    const w = weight(c);
    if (w > 0 && w < best) best = w;
  }
  return best;
}
