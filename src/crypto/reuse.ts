/**
 * Act 7: enrolling one source twice, and what the two helpers do and do not
 * give away.
 *
 * The claim this panel exists to support is narrow and worth stating exactly.
 * For the same source word w and two INDEPENDENT uniformly random codewords,
 *
 *     h1 XOR h2 = (w XOR c1) XOR (w XOR c2) = c1 XOR c2,
 *
 * so w cancels and what is left is a codeword. With a noisy re-read
 * w' = w XOR e the XOR becomes c1 XOR c2 XOR e, and decoding it returns e —
 * WHICH CELLS FLIPPED, not what they hold. The first helper already fixed w's
 * coset, which is the whole n - k bits the syndrome can carry, so the second
 * helper adds nothing about w.
 *
 * "Adds nothing" is measured rather than asserted. `enumerateCandidates` counts
 * the candidate set for w before and after the second helper, over every
 * codeword, and reports the difference in bits. That counter is not a constant:
 * the deliberately broken variant below — drawing the codeword from a SUBCODE
 * instead of the whole code — makes it move, which is how the correct case's
 * zero can be read as a result.
 *
 * What this does NOT show: Boyen (CCS 2004) proves that ordinary
 * fuzzy-extractor security can fail under repeated enrolment in stronger
 * models, including perturbations an attacker gets to choose. Those attacks are
 * not demonstrated here and this XOR is not evidence for or against them; they
 * are why reusable fuzzy extractors are a separate definition.
 */

import { type BchCode, decode, encode, syndromeBits } from './bch';
import { type BitVec, equal, weight, xor } from './bits';

export interface ReuseSyndromeView {
  readonly syndrome1: BitVec;
  readonly syndrome2: BitVec;
  /** True when the two enrolments saw the identical reading. */
  readonly syndromesEqual: boolean;
  /** h1 XOR h2. */
  readonly xorWord: BitVec;
  readonly xorIsCodeword: boolean;
  readonly xorDecodeStatus: 'clean' | 'corrected' | 'failure';
  /**
   * The cells the XOR exposes as having flipped between the two readings.
   * A fact about the noise; every one of those cells still has an unknown value.
   */
  readonly exposedFlipPositions: number[];
  readonly failureCode: string | null;
}

/** The public-data-only view of two helpers for the same source. */
export function reuseSyndromeView(
  code: BchCode,
  helper1: BitVec,
  helper2: BitVec,
): ReuseSyndromeView {
  const syndrome1 = syndromeBits(code, helper1);
  const syndrome2 = syndromeBits(code, helper2);
  const xorWord = xor(helper1, helper2);
  const result = decode(code, xorWord);
  return {
    syndrome1,
    syndrome2,
    syndromesEqual: equal(syndrome1, syndrome2),
    xorWord,
    xorIsCodeword: weight(syndromeBits(code, xorWord)) === 0,
    xorDecodeStatus: result.status,
    exposedFlipPositions: result.status === 'failure' ? [] : result.errorPositions,
    failureCode: result.status === 'failure' ? result.failureCode : null,
  };
}

export interface CandidateCount {
  /** How many codewords the attacker has to consider, i.e. |C'|. */
  readonly codewordsConsidered: number;
  /** |A|: source words consistent with the FIRST helper alone. */
  readonly candidatesFromFirst: number;
  /** |A| narrowed by the second helper, under the "re-read within t" rule. */
  readonly candidatesAfterSecond: number;
  /** log2(2^n / |A|): what the first helper cost. */
  readonly bitsLostToFirst: number;
  /** log2(|A| / survivors): what the SECOND helper added. The Act 7 counter. */
  readonly bitsLearnedFromSecond: number;
  /** False when no pair is within t, i.e. the assumption itself does not hold. */
  readonly consistent: boolean;
}

/**
 * The subcode used by the broken variant: codewords whose message has only its
 * lowest `dim` bits free. A linear subcode of the full code, so reproduction
 * still works perfectly — which is exactly what makes it a good lesson.
 */
export function subcodeCodewords(code: BchCode, dim: number): BitVec[] {
  if (dim < 0 || dim > code.k) throw new Error(`subcode dimension ${dim} outside [0, ${code.k}]`);
  if (dim > 14) throw new Error(`refusing to enumerate 2^${dim} codewords`);
  const out: BitVec[] = [];
  for (let v = 0; v < 1 << dim; v++) {
    const msg = new Uint8Array(code.k);
    for (let i = 0; i < dim; i++) msg[i] = (v >>> i) & 1;
    out.push(encode(code, msg));
  }
  return out;
}

/**
 * Count the candidate source words before and after the second helper, by
 * enumeration.
 *
 * A  = { h1 XOR c : c in C' }  -- every w consistent with the first helper.
 * B  = { h2 XOR c : c in C' }  -- every reading consistent with the second.
 * A survivor is an x in A for which SOME y in B is within t flips, which is the
 * only constraint a within-radius re-read imposes. Nothing here is a closed
 * form: the pairs are walked and counted.
 *
 * The answer for the correct construction is that every x survives, so the
 * second helper narrows nothing and the counter reads 0 bits. Under the broken
 * variant the FIRST helper already narrows further than it should, which the
 * `bitsLostToFirst` field reports; the second still adds nothing.
 */
export function enumerateCandidates(
  code: BchCode,
  helper1: BitVec,
  helper2: BitVec,
  codewords: BitVec[],
): CandidateCount {
  const setA = codewords.map((c) => xor(helper1, c));
  const setB = codewords.map((c) => xor(helper2, c));

  let survivors = 0;
  for (const x of setA) {
    for (const y of setB) {
      if (weight(xor(x, y)) <= code.t) {
        survivors++;
        break;
      }
    }
  }

  const bitsLearned = survivors > 0 ? Math.log2(setA.length / survivors) : Number.NaN;
  return {
    codewordsConsidered: codewords.length,
    candidatesFromFirst: setA.length,
    candidatesAfterSecond: survivors,
    bitsLostToFirst: code.n - Math.log2(setA.length),
    bitsLearnedFromSecond: bitsLearned,
    consistent: survivors > 0,
  };
}
