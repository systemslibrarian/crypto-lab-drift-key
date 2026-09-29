/**
 * The entropy accounting and the reliability prediction.
 *
 * Every number here is computed from the model parameters on screen. None is a
 * constant lifted from a paper, and none is described as "the key's entropy" —
 * the quantity the secure-sketch bound is about is the AVERAGE MIN-ENTROPY OF
 * THE SOURCE GIVEN THE HELPER, which is not the same object as the entropy of
 * the derived key (invariant I4).
 *
 * The bound (Dodis, Reyzin & Smith, EUROCRYPT 2004; journal version Dodis,
 * Ostrovsky, Reyzin & Smith, SIAM J. Comput. 38(1), 2008) is: for a binary
 * linear [n, k] code used in the code-offset construction, and ANY source W
 * with min-entropy m,
 *
 *     Hinf~(W | SS(W))  >=  m - (n - k).
 *
 * It is an upper bound on the LOSS, not an estimate of it, and it holds for
 * non-uniform sources without modification. Bias does not make the helper leak
 * more than n - k bits; it lowers m, so the same subtraction can leave nothing.
 */

/** log(j!) for j <= 255, summed exactly once. */
const LOG_FACTORIAL: Float64Array = (() => {
  const f = new Float64Array(512);
  for (let j = 1; j < f.length; j++) f[j] = f[j - 1] + Math.log(j);
  return f;
})();

function logBinom(n: number, j: number): number {
  return LOG_FACTORIAL[n] - LOG_FACTORIAL[j] - LOG_FACTORIAL[n - j];
}

const LN2 = Math.LN2;

/**
 * The source's min-entropy, H_inf(W) = -log2 max_w Pr[W = w].
 *
 * For independent cells the most likely word is the per-cell lean, so the
 * maximum probability is the product of the pMax values and the min-entropy is
 * the sum of their negative logs. The formula is printed beside the number.
 */
export function minEntropyBits(pMax: Float64Array | number[]): number {
  let m = 0;
  for (let i = 0; i < pMax.length; i++) m += -Math.log2(pMax[i]);
  return m;
}

/** The sketch's worst-case cost: the syndrome is n - k bits wide. */
export function sketchLossBits(n: number, k: number): number {
  return n - k;
}

/** m - (n - k). Deliberately allowed to be negative; see `residualVerdict`. */
export function residualBoundBits(minEntropy: number, loss: number): number {
  return minEntropy - loss;
}

export type ResidualState = 'guaranteed' | 'thin' | 'none';

/**
 * How to read the residual. Below zero the bound promises nothing at all, which
 * is a different statement from "the helper leaks more" and from "the key is
 * recoverable" — the measured attack beside it decides that separately.
 */
export function residualVerdict(residual: number): ResidualState {
  if (residual <= 0) return 'none';
  if (residual < 32) return 'thin';
  return 'guaranteed';
}

/** P(Binomial(n, p) <= t), computed in log space so large n does not overflow. */
export function binomialAtMost(n: number, p: number, t: number): number {
  if (t >= n) return 1;
  if (t < 0) return 0;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  const logP = Math.log(p);
  const logQ = Math.log1p(-p);
  let total = 0;
  for (let j = 0; j <= t; j++) {
    total += Math.exp(logBinom(n, j) + j * logP + (n - j) * logQ);
  }
  return Math.min(1, total);
}

/**
 * The predicted key-failure rate at a given bit-error rate.
 *
 * A reproduction succeeds exactly when the flip pattern has weight <= t: at
 * weight <= t the decoder returns the enrolled codeword, and past it the
 * decoder cannot return the enrolled codeword at all (see `bch.test.ts`, which
 * checks that over the whole 2^15 space of BCH(15,7)). So the failure rate is
 * 1 - P(Binomial(n, ber) <= t), with no fitted parameter.
 */
export function predictedFailureRate(n: number, ber: number, t: number): number {
  return 1 - binomialAtMost(n, ber, t);
}

/** log2 of the number of words within Hamming distance t of a fixed word. */
export function log2BallSize(n: number, t: number): number {
  let maxTerm = -Infinity;
  const terms: number[] = [];
  for (let j = 0; j <= t; j++) {
    const term = logBinom(n, j);
    terms.push(term);
    if (term > maxTerm) maxTerm = term;
  }
  let sum = 0;
  for (const term of terms) sum += Math.exp(term - maxTerm);
  return (maxTerm + Math.log(sum)) / LN2;
}

/**
 * The success probability of ONE guess against a uniform source: the guesser
 * wins exactly when the true word lands in the decoding ball around the guess,
 * so it is |B_t| / 2^n. Returned as a log2 because it is far below anything a
 * decimal can show.
 */
export function log2ChanceLevel(n: number, t: number): number {
  return log2BallSize(n, t) - n;
}

/**
 * The attacker's success probability against the STATED bias model, computed
 * exactly rather than only measured.
 *
 * The guess is the per-cell lean, so a cell disagrees with the guess
 * independently with probability 1 - pMax[i], and the attack wins when at most
 * t cells disagree. Those probabilities differ per cell, so this is a Poisson
 * binomial rather than a binomial: the distribution is built by convolution,
 * which is exact. The measured rate in the worker is compared against it.
 */
export function exactAttackSuccess(pMax: Float64Array | number[], t: number): number {
  let dist = new Float64Array(pMax.length + 1);
  dist[0] = 1;
  let support = 0;
  for (let i = 0; i < pMax.length; i++) {
    const q = 1 - pMax[i];
    const next = new Float64Array(pMax.length + 1);
    for (let j = 0; j <= support; j++) {
      const mass = dist[j];
      if (mass === 0) continue;
      next[j] += mass * (1 - q);
      next[j + 1] += mass * q;
    }
    support = Math.min(support + 1, pMax.length);
    dist = next;
  }
  let total = 0;
  for (let j = 0; j <= Math.min(t, pMax.length); j++) total += dist[j];
  return Math.min(1, total);
}

/**
 * Wilson score interval for a measured proportion. Used so the page compares a
 * measurement against a prediction with an honest interval rather than an
 * eyeballed "close enough".
 */
export function wilsonInterval(
  successes: number,
  trials: number,
  z = 1.959963984540054,
): { lo: number; hi: number } {
  if (trials === 0) return { lo: 0, hi: 1 };
  const phat = successes / trials;
  const denom = 1 + (z * z) / trials;
  const centre = phat + (z * z) / (2 * trials);
  const spread = z * Math.sqrt((phat * (1 - phat)) / trials + (z * z) / (4 * trials * trials));
  return {
    lo: Math.max(0, (centre - spread) / denom),
    hi: Math.min(1, (centre + spread) / denom),
  };
}
