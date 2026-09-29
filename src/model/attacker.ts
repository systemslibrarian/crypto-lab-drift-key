/**
 * The Act 6 guessing attack. PUBLIC INPUTS ONLY (invariant I5).
 *
 * This module is handed the helper data, the extractor salt, the code
 * parameters and the bias model — every one of which a real attacker has, since
 * the helper is published and the model is characterisation data — and nothing
 * else. It never sees the enrolled source word, the enrolled codeword or the
 * enrolled key, and it never decides whether it succeeded: `guessKey` returns a
 * candidate and the caller compares. That comparison is the experiment, not
 * part of the attack.
 *
 * The boundary is enforced twice. At the type level, the only thing it can be
 * handed is `AttackerView`, which has no secret field. At the module level,
 * `attacker.test.ts` parses this file's own import statements and fails if it
 * ever reaches for `enroll`, `judge`, or anything from the source model beyond
 * the published bias parameters.
 *
 * The attack itself is the obvious one, and that is the point: against a source
 * with too little min-entropy, the obvious attack is enough.
 *
 *   1. Compute the most likely reading w-hat from the public bias model.
 *   2. Run the ordinary reproduction routine on it -- the same `reproduce` the
 *      device runs, with a guess in place of a real reading.
 *   3. If w-hat is within t flips of the enrolled reading, the decoder returns
 *      the enrolled codeword and the derived key is the real one.
 */

import { type BitVec } from '../crypto/bits';
import { type BchCode } from '../crypto/bch';
import { type PublicHelper, reproduce } from '../crypto/sketch';

/** The published bias model. Characterisation data, not a secret. */
export interface PublicBiasModel {
  readonly pMax: Float64Array;
  readonly lean: Uint8Array;
}

/** Everything the attacker is allowed to know. No field here is secret. */
export interface AttackerView {
  readonly pub: PublicHelper;
  readonly model: PublicBiasModel;
}

/**
 * The most likely reading under the bias model: each cell takes its lean.
 *
 * At skew exactly 0.5 every cell is a fair coin and both values are equally
 * likely, so the tie-break to `lean` is arbitrary and the guess is effectively
 * uniform. The page says so, and `stats.log2ChanceLevel` gives the number that
 * follows from it.
 */
export function mostLikelyReading(model: PublicBiasModel): BitVec {
  const out = new Uint8Array(model.lean.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = model.pMax[i] >= 0.5 ? model.lean[i] : ((model.lean[i] ^ 1) & 1);
  }
  return out;
}

export interface AttackResult {
  /** The guessed reading the attack was run on. */
  readonly guess: BitVec;
  /** Whether the decoder accepted the guess at all. */
  readonly decoded: boolean;
  readonly failureCode: string | null;
  /** The source word the attack believes was enrolled, or null. */
  readonly candidateWord: BitVec | null;
  /** The key derived from it, or null. The caller decides whether it is right. */
  readonly candidateKey: Uint8Array | null;
}

export async function guessKey(code: BchCode, view: AttackerView): Promise<AttackResult> {
  const guess = mostLikelyReading(view.model);
  const attempt = await reproduce(code, view.pub, guess);
  return {
    guess,
    decoded: attempt.decodeStatus !== 'failure',
    failureCode: attempt.failureCode,
    candidateWord: attempt.recoveredWord,
    candidateKey: attempt.recoveredKey,
  };
}
