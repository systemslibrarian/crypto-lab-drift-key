/**
 * The code-offset secure sketch (Juels & Wattenberg, CCS 1999, as "fuzzy
 * commitment"; Dodis, Reyzin & Smith, EUROCRYPT 2004, as a secure sketch), with
 * HKDF-SHA-256 as the key-derivation step on top.
 *
 * Enrol:      pick a uniformly random codeword c, publish h = w XOR c,
 *             derive key = HKDF(w).
 * Reproduce:  given h and a fresh reading w', compute h XOR w' = c XOR e,
 *             decode to c, recover w = h XOR c, derive the key again.
 *
 * Two boundaries are drawn in the types on purpose.
 *
 * FIRST, public and secret never share an object. `PublicHelper` is exactly what
 * a device publishes and an attacker sees; `EnrollmentSecret` is what never
 * leaves the device. Invariant I3 — that the page must not render the enrolled
 * secret in a way suggesting the helper is secret too — is easier to hold when
 * the two cannot be confused at the type level.
 *
 * SECOND, `reproduce` is everything a real device can compute, and it CANNOT
 * tell whether it succeeded: a mis-correction returns a perfectly well-formed
 * key for a codeword that is not the enrolled one. Deciding that requires the
 * enrolled secret, so it lives in `judge`, which the UI labels as a page-side
 * measurement a deployed device would not have. Folding the two together would
 * have taught that the construction detects its own failures. It does not.
 */

import { type BitVec, equal, xor } from './bits';
import {
  type BchCode,
  type DecodeFailureCode,
  type DecodeResult,
  decode,
  encode,
  syndromeBits,
} from './bch';
import { bytesEqual, deriveKey } from './kdf';

/** Failure codes surfaced in the UI and asserted in the claims suite. */
export const HELPER_LENGTH_MISMATCH = 'HELPER_LENGTH_MISMATCH';
export const KEY_MISMATCH = 'KEY_MISMATCH';
export const MISCORRECTED = 'MISCORRECTED';

/**
 * The code-offset construction has no failure code for a source that never had
 * enough min-entropy to begin with. Enrol and reproduce behave identically
 * whether the residual bound is 64 bits or well below zero. The absence is the
 * exhibit, so it is named here and rendered on the page rather than left to be
 * noticed.
 */
export const NO_CODE_FOR_WEAK_SOURCE = 'NO_CODE_FOR_WEAK_SOURCE';

/** Everything the device publishes. Nothing here is secret. */
export interface PublicHelper {
  readonly helper: BitVec;
  /** The extractor seed. Public in the construction, so public here. */
  readonly salt: Uint8Array;
  readonly codeLabel: string;
}

/** Everything the device keeps. Never rendered in the public column. */
export interface EnrollmentSecret {
  readonly sourceWord: BitVec;
  readonly codeword: BitVec;
  readonly key: Uint8Array;
}

export interface Enrollment {
  readonly pub: PublicHelper;
  readonly secret: EnrollmentSecret;
}

/** A uniformly random message, from the platform CSPRNG. */
export function randomMessageBits(k: number): BitVec {
  const bytes = new Uint8Array(k);
  crypto.getRandomValues(bytes);
  const out = new Uint8Array(k);
  for (let i = 0; i < k; i++) out[i] = bytes[i] & 1;
  return out;
}

export function randomSalt(bytes = 16): Uint8Array {
  const s = new Uint8Array(bytes);
  crypto.getRandomValues(s);
  return s;
}

/**
 * Enrol. `message` selects the random codeword; it is a parameter rather than
 * drawn inside so a seeded sweep can be reproducible and a test can pin it.
 */
export async function enroll(
  code: BchCode,
  sourceWord: BitVec,
  message: BitVec,
  salt: Uint8Array,
): Promise<Enrollment> {
  if (sourceWord.length !== code.n) {
    throw new Error(`source word length ${sourceWord.length} != n ${code.n}`);
  }
  const codeword = encode(code, message);
  const helper = xor(sourceWord, codeword);
  const key = await deriveKey(sourceWord, salt, code.label);
  return {
    pub: { helper, salt, codeLabel: code.label },
    secret: { sourceWord, codeword, key },
  };
}

export interface ReproduceAttempt {
  readonly decodeStatus: DecodeResult['status'];
  readonly failureCode: DecodeFailureCode | typeof HELPER_LENGTH_MISMATCH | null;
  readonly detail: string;
  /** Positions the decoder believes flipped between enrolment and this reading. */
  readonly errorPositions: number[];
  readonly recoveredWord: BitVec | null;
  readonly recoveredKey: Uint8Array | null;
}

/**
 * Reproduce, from public data and a fresh reading only.
 *
 * This is the whole of what a deployed device computes. It does not take the
 * enrolled word, the enrolled codeword or the enrolled key, and it returns no
 * judgement about whether the key it produced is the right one.
 */
export async function reproduce(
  code: BchCode,
  pub: PublicHelper,
  reading: BitVec,
): Promise<ReproduceAttempt> {
  if (pub.helper.length !== code.n || reading.length !== code.n) {
    return {
      decodeStatus: 'failure',
      failureCode: HELPER_LENGTH_MISMATCH,
      detail: `helper ${pub.helper.length} bits and reading ${reading.length} bits against n = ${code.n}`,
      errorPositions: [],
      recoveredWord: null,
      recoveredKey: null,
    };
  }
  const offset = xor(pub.helper, reading); // = c XOR e
  const result = decode(code, offset);
  if (result.status === 'failure') {
    return {
      decodeStatus: 'failure',
      failureCode: result.failureCode,
      detail: result.detail,
      errorPositions: [],
      recoveredWord: null,
      recoveredKey: null,
    };
  }
  const recoveredWord = xor(pub.helper, result.word);
  const recoveredKey = await deriveKey(recoveredWord, pub.salt, pub.codeLabel);
  return {
    decodeStatus: result.status,
    failureCode: null,
    detail: result.status === 'clean' ? 'no flips to correct' : `${result.errorPositions.length} flips corrected`,
    errorPositions: result.errorPositions,
    recoveredWord,
    recoveredKey,
  };
}

export type ReproduceOutcome = 'reproduced' | 'decode-failure' | 'miscorrected';

export interface Verdict {
  readonly outcome: ReproduceOutcome;
  readonly failureCode: string | null;
  readonly keyMatches: boolean;
  readonly wordMatches: boolean;
}

/**
 * Compare an attempt against the enrolment. Requires the secret, which a
 * deployed device does not have — the page says so where this is rendered.
 */
export function judge(attempt: ReproduceAttempt, secret: EnrollmentSecret): Verdict {
  if (attempt.decodeStatus === 'failure' || !attempt.recoveredKey || !attempt.recoveredWord) {
    return {
      outcome: 'decode-failure',
      failureCode: attempt.failureCode,
      keyMatches: false,
      wordMatches: false,
    };
  }
  const wordMatches = equal(attempt.recoveredWord, secret.sourceWord);
  const keyMatches = bytesEqual(attempt.recoveredKey, secret.key);
  if (keyMatches && wordMatches) {
    return { outcome: 'reproduced', failureCode: null, keyMatches, wordMatches };
  }
  return {
    outcome: 'miscorrected',
    failureCode: wordMatches ? KEY_MISMATCH : MISCORRECTED,
    keyMatches,
    wordMatches,
  };
}

/**
 * The Act 3 equivalence, measured rather than asserted: the (n-k)-bit syndrome
 * of the public helper equals the syndrome of the secret source word, because
 * the codeword that separates them has syndrome zero. Publishing h therefore
 * reveals which of the 2^(n-k) cosets w is in, and nothing else — which is the
 * whole of the n - k bound.
 */
export function syndromeEquivalence(
  code: BchCode,
  pub: PublicHelper,
  secret: EnrollmentSecret,
): { helperSyndrome: BitVec; sourceSyndrome: BitVec; codewordSyndrome: BitVec; holds: boolean } {
  const helperSyndrome = syndromeBits(code, pub.helper);
  const sourceSyndrome = syndromeBits(code, secret.sourceWord);
  const codewordSyndrome = syndromeBits(code, secret.codeword);
  return {
    helperSyndrome,
    sourceSyndrome,
    codewordSyndrome,
    holds: equal(helperSyndrome, sourceSyndrome),
  };
}
