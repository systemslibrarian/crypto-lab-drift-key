/**
 * The labelled noise source: an SRAM-PUF-SHAPED MODEL, not a PUF.
 *
 * A browser has no physical unclonable function and cannot acquire one, so
 * nothing here is measured from hardware. What this module provides is a source
 * whose parameters are stated on screen — per-cell power-up bias and a per-read
 * bit-error rate — so that every entropy figure and every reliability curve in
 * the lab is computed from a model the reader can see, rather than from a
 * physical claim the page cannot support. The error correction, the helper data
 * and the key derivation on top of it are real.
 *
 * Two axes, deliberately independent:
 *
 *   BIAS   fixes how predictable each cell is at power-up, and therefore the
 *          source's min-entropy. Cell i leans toward `lean[i]` and shows that
 *          value with probability `pMax[i]`.
 *   BER    fixes how often a cell reads differently from one power-up to the
 *          next, and therefore reliability.
 *
 * REAL SRAM DOES NOT SEPARATE THEM. A strongly biased cell is also a stable
 * one, and a balanced cell is the unstable one — so a real device's per-cell
 * error rates have to be measured, not assumed, and the two sliders here would
 * be coupled. Holding them apart is what makes the binomial prediction in
 * `stats.ts` exact, and the page says so wherever the curve is drawn.
 */

import { type BitVec } from '../crypto/bits';
import { makePrng, type Prng } from './prng';

/** The public bias model. An attacker is assumed to know all of it. */
export interface DeviceModel {
  readonly n: number;
  readonly seed: number;
  /** Skew parameter that produced it: the average of `pMax`, in [0.5, 1]. */
  readonly skew: number;
  /** pMax[i] = max(p_i, 1 - p_i), the probability cell i shows its lean. */
  readonly pMax: Float64Array;
  /** Which value cell i leans toward. */
  readonly lean: Uint8Array;
}

export const MIN_SKEW = 0.5;
export const MAX_SKEW = 0.99;

/**
 * Build a device. `seed` fixes which cells lean which way and their relative
 * strengths; `skew` scales those strengths. Moving the skew slider therefore
 * makes the SAME device more or less predictable rather than swapping it for a
 * different one, which is what lets the entropy bar and the attack curve be
 * read as one experiment.
 */
export function makeDevice(n: number, seed: number, skew: number): DeviceModel {
  const clamped = Math.min(MAX_SKEW, Math.max(MIN_SKEW, skew));
  const rng = makePrng(seed);
  const pMax = new Float64Array(n);
  const lean = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    // Spread around the slider value so the min-entropy sum is genuinely a sum
    // over distinct terms and not n copies of one number.
    const spread = 0.5 + rng.next(); // uniform in [0.5, 1.5)
    lean[i] = rng.chance(0.5) ? 1 : 0;
    pMax[i] = Math.min(1, 0.5 + (clamped - 0.5) * spread);
  }
  return { n, seed, skew: clamped, pMax, lean };
}

/** P(cell i reads 1). Public; the attacker's whole knowledge of the source. */
export function probabilityOfOne(model: DeviceModel, i: number): number {
  return model.lean[i] ? model.pMax[i] : 1 - model.pMax[i];
}

/** A power-up reading: cell i shows its lean with probability pMax[i]. */
export function powerUpReading(model: DeviceModel, rng: Prng): BitVec {
  const w = new Uint8Array(model.n);
  for (let i = 0; i < model.n; i++) {
    w[i] = rng.chance(model.pMax[i]) ? model.lean[i] : (model.lean[i] ^ 1) & 1;
  }
  return w;
}

/**
 * A later reading of the same device: every cell flips independently with
 * probability `ber`. Returns the reading and the flip pattern, because the
 * flips are what the Reproduce exhibit draws.
 */
export function laterReading(
  enrolled: BitVec,
  ber: number,
  rng: Prng,
): { reading: BitVec; flips: BitVec } {
  const reading = Uint8Array.from(enrolled);
  const flips = new Uint8Array(enrolled.length);
  for (let i = 0; i < enrolled.length; i++) {
    if (rng.chance(ber)) {
      flips[i] = 1;
      reading[i] ^= 1;
    }
  }
  return { reading, flips };
}
