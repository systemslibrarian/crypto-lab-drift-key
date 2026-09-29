/**
 * The measured sweeps: reliability against the binomial prediction, and the
 * guessing attack against the entropy accounting.
 *
 * Kept out of the worker file so the same code runs under Vitest. Both sweeps
 * run the WHOLE pipeline every trial — enrol with a fresh random codeword,
 * derive the real key through WebCrypto HKDF, reproduce, compare the key bytes
 * — rather than shortcutting to a Hamming-weight test that would agree with the
 * prediction by construction. The prediction has to be met, not assumed.
 */

import { type BchCode, codeById } from '../crypto/bch';
import { type BitVec } from '../crypto/bits';
import { bytesEqual } from '../crypto/kdf';
import { enroll, judge, type ReproduceOutcome, reproduce } from '../crypto/sketch';
import { guessKey } from './attacker';
import { makePrng, type Prng } from './prng';
import { laterReading, makeDevice, powerUpReading } from './source';
import {
  binomialAtMost,
  exactAttackSuccess,
  minEntropyBits,
  predictedFailureRate,
  residualBoundBits,
  sketchLossBits,
  wilsonInterval,
} from './stats';

export interface ReliabilityPoint {
  readonly ber: number;
  readonly trials: number;
  readonly successes: number;
  readonly decodeFailures: number;
  readonly misCorrections: number;
  /** Measured key-failure rate. */
  readonly measured: number;
  /** 1 - P(Binomial(n, ber) <= t), with no fitted parameter. */
  readonly predicted: number;
  readonly lo: number;
  readonly hi: number;
}

export interface AttackPoint {
  readonly skew: number;
  readonly trials: number;
  readonly successes: number;
  readonly measured: number;
  /** Exact Poisson-binomial success probability for this bias model. */
  readonly exact: number;
  readonly lo: number;
  readonly hi: number;
  readonly minEntropy: number;
  readonly loss: number;
  readonly residual: number;
}

function randomMessage(k: number, rng: Prng): BitVec {
  const m = new Uint8Array(k);
  for (let i = 0; i < k; i++) m[i] = rng.chance(0.5) ? 1 : 0;
  return m;
}

function saltFrom(rng: Prng): Uint8Array {
  const s = new Uint8Array(16);
  for (let i = 0; i < s.length; i++) s[i] = rng.int(256);
  return s;
}

export interface SweepProgress {
  (done: number, total: number): void;
}

export interface ReliabilityParams {
  readonly codeId: string;
  readonly deviceSeed: number;
  readonly skew: number;
  readonly trialSeed: number;
  readonly berPoints: readonly number[];
  readonly trialsPerPoint: number;
}

export async function reliabilitySweep(
  params: ReliabilityParams,
  onProgress?: SweepProgress,
): Promise<ReliabilityPoint[]> {
  const code: BchCode = codeById(params.codeId);
  const device = makeDevice(code.n, params.deviceSeed, params.skew);
  const rng = makePrng(params.trialSeed);
  const total = params.berPoints.length * params.trialsPerPoint;
  let done = 0;
  const out: ReliabilityPoint[] = [];

  for (const ber of params.berPoints) {
    const tally: Record<ReproduceOutcome, number> = {
      reproduced: 0,
      'decode-failure': 0,
      miscorrected: 0,
    };
    for (let i = 0; i < params.trialsPerPoint; i++) {
      const w = powerUpReading(device, rng);
      const enrollment = await enroll(code, w, randomMessage(code.k, rng), saltFrom(rng));
      const { reading } = laterReading(w, ber, rng);
      const attempt = await reproduce(code, enrollment.pub, reading);
      tally[judge(attempt, enrollment.secret).outcome]++;
      done++;
      if (onProgress && done % 64 === 0) onProgress(done, total);
    }
    const successes = tally.reproduced;
    const trials = params.trialsPerPoint;
    const failures = trials - successes;
    const { lo, hi } = wilsonInterval(failures, trials);
    out.push({
      ber,
      trials,
      successes,
      decodeFailures: tally['decode-failure'],
      misCorrections: tally.miscorrected,
      measured: failures / trials,
      predicted: predictedFailureRate(code.n, ber, code.t),
      lo,
      hi,
    });
  }
  onProgress?.(total, total);
  return out;
}

export interface AttackParams {
  readonly codeId: string;
  readonly deviceSeed: number;
  readonly trialSeed: number;
  readonly skewPoints: readonly number[];
  readonly trialsPerPoint: number;
}

/**
 * The attack sweep. Each trial enrols a fresh reading and hands the ATTACKER
 * only the published helper, the salt and the bias model; the key comparison
 * happens here, outside the attacker module, because deciding whether an attack
 * worked is not something the attacker can do.
 */
export async function attackSweep(
  params: AttackParams,
  onProgress?: SweepProgress,
): Promise<AttackPoint[]> {
  const code = codeById(params.codeId);
  const rng = makePrng(params.trialSeed);
  const loss = sketchLossBits(code.n, code.k);
  const total = params.skewPoints.length * params.trialsPerPoint;
  let done = 0;
  const out: AttackPoint[] = [];

  for (const skew of params.skewPoints) {
    const device = makeDevice(code.n, params.deviceSeed, skew);
    let successes = 0;
    for (let i = 0; i < params.trialsPerPoint; i++) {
      const w = powerUpReading(device, rng);
      const enrollment = await enroll(code, w, randomMessage(code.k, rng), saltFrom(rng));
      const result = await guessKey(code, {
        pub: enrollment.pub,
        model: { pMax: device.pMax, lean: device.lean },
      });
      if (result.candidateKey && bytesEqual(result.candidateKey, enrollment.secret.key)) {
        successes++;
      }
      done++;
      if (onProgress && done % 64 === 0) onProgress(done, total);
    }
    const trials = params.trialsPerPoint;
    const { lo, hi } = wilsonInterval(successes, trials);
    const minEntropy = minEntropyBits(device.pMax);
    out.push({
      skew,
      trials,
      successes,
      measured: successes / trials,
      exact: exactAttackSuccess(device.pMax, code.t),
      lo,
      hi,
      minEntropy,
      loss,
      residual: residualBoundBits(minEntropy, loss),
    });
  }
  onProgress?.(total, total);
  return out;
}

/** Re-exported so the worker and the UI share one binomial implementation. */
export { binomialAtMost };
