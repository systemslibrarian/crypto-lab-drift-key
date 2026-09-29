/**
 * GF(2^m) arithmetic by log/antilog tables.
 *
 * Hand-rolled on purpose. The field is the part of BCH decoding a learner has
 * to be able to look at — the syndromes are field elements, Berlekamp-Massey
 * runs in the field, and the Chien search walks its powers — so it lives here
 * in full rather than behind a library call. Everything that is genuinely
 * cryptographic in this lab (HKDF-SHA-256, the random codeword) comes from
 * WebCrypto instead; see `kdf.ts`.
 *
 * Elements are plain numbers in [0, 2^m): bit j is the coefficient of x^j in
 * the polynomial-basis representation. `alpha` is the class of x, which is
 * primitive for each polynomial below, so its powers enumerate every nonzero
 * element exactly once.
 */

/**
 * Primitive polynomials over GF(2), as coefficient bitmasks including the
 * leading x^m term. These are the conventional choices used by the BCH
 * literature and by every BCH implementation a reader is likely to compare
 * against; `gf2m.test.ts` proves primitivity for each rather than trusting the
 * table (alpha's multiplicative order must be exactly 2^m - 1).
 */
export const PRIMITIVE_POLY: Readonly<Record<number, number>> = Object.freeze({
  3: 0b1011, // x^3 + x + 1
  4: 0b10011, // x^4 + x + 1
  5: 0b100101, // x^5 + x^2 + 1
  6: 0b1000011, // x^6 + x + 1
  7: 0b10001001, // x^7 + x^3 + 1
  8: 0b100011101, // x^8 + x^4 + x^3 + x^2 + 1
});

export interface GF {
  /** Extension degree. */
  readonly m: number;
  /** 2^m - 1, the multiplicative order and the natural BCH block length. */
  readonly n: number;
  /** The primitive polynomial, as a bitmask including x^m. */
  readonly poly: number;
  /** exp[i] = alpha^i, for i in [0, 2n). Doubled so a product index never wraps. */
  readonly exp: Int32Array;
  /** log[x] = i with alpha^i = x, for x != 0. log[0] is -1 and must never be used. */
  readonly log: Int32Array;
}

const cache = new Map<number, GF>();

export function makeGF(m: number): GF {
  const hit = cache.get(m);
  if (hit) return hit;

  const poly = PRIMITIVE_POLY[m];
  if (poly === undefined) throw new Error(`no primitive polynomial on file for m=${m}`);

  const size = 1 << m;
  const n = size - 1;
  const exp = new Int32Array(2 * n);
  const log = new Int32Array(size).fill(-1);

  let x = 1;
  for (let i = 0; i < n; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & size) x ^= poly; // reduce by the primitive polynomial
  }
  // Second lap, so exp[i + j] is always in range for i, j < n.
  for (let i = 0; i < n; i++) exp[n + i] = exp[i];

  const gf: GF = { m, n, poly, exp, log };
  cache.set(m, gf);
  return gf;
}

export function gfMul(gf: GF, a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return gf.exp[gf.log[a] + gf.log[b]];
}

export function gfInv(gf: GF, a: number): number {
  if (a === 0) throw new Error('gfInv(0) is undefined');
  return gf.exp[(gf.n - gf.log[a]) % gf.n];
}

export function gfDiv(gf: GF, a: number, b: number): number {
  if (b === 0) throw new Error('gfDiv by 0');
  if (a === 0) return 0;
  return gf.exp[(gf.log[a] - gf.log[b] + gf.n) % gf.n];
}

/** alpha^e, for any integer exponent including negatives. */
export function alphaPow(gf: GF, e: number): number {
  const r = ((e % gf.n) + gf.n) % gf.n;
  return gf.exp[r];
}

/**
 * Carry-less multiply of two GF(2) polynomials, then reduce modulo `poly`.
 *
 * The table-free route, kept as the independent re-derivation the field tests
 * check `gfMul` against. A table built from the same shift-and-reduce loop that
 * checks it would agree with its own bug (template §4.1b).
 */
export function gfMulReference(poly: number, m: number, a: number, b: number): number {
  let product = 0;
  for (let i = 0; i < m; i++) {
    if ((b >> i) & 1) product ^= a << i;
  }
  for (let bit = 2 * m - 2; bit >= m; bit--) {
    if ((product >> bit) & 1) product ^= poly << (bit - m);
  }
  return product & ((1 << m) - 1);
}
