/**
 * xoshiro128** seeded through splitmix32.
 *
 * THIS IS NOT A CRYPTOGRAPHIC GENERATOR AND IS NOT USED AS ONE. It drives the
 * labelled device model — which cells lean which way, which cells flip on a
 * given read — so that a run is reproducible from the seed printed on the page.
 * Everything with a security meaning uses `crypto.getRandomValues` instead: the
 * random codeword at enrolment and the extractor salt, both in `sketch.ts`.
 *
 * Blackman & Vigna, "Scrambled Linear Pseudorandom Number Generators" (ACM TOMS
 * 47(4), 2021) for xoshiro; splitmix32 is the 32-bit analogue of the SplittableRandom
 * mixer used to expand a single seed word into the four-word state.
 */

export interface Prng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, bound). */
  int(bound: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

export function makePrng(seed: number): Prng {
  const mix = splitmix32(seed);
  let s0 = mix();
  let s1 = mix();
  let s2 = mix();
  let s3 = mix();
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1; // the all-zero state is a fixed point

  const nextUint32 = (): number => {
    const result = (Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  };

  return {
    next: () => nextUint32() / 0x100000000,
    int: (bound: number) => Math.floor((nextUint32() / 0x100000000) * bound),
    chance: (p: number) => nextUint32() / 0x100000000 < p,
  };
}

/** A fresh seed for the "new device" control. */
export function randomSeed(): number {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] >>> 0;
}
