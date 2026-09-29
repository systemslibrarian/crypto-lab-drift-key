# Build brief — crypto-lab-drift-key (Revision 2)

Written against `audits/_MASTER-TEMPLATE.md` (copy it into this repo alongside this brief). The template is binding; disagreements go in the PR description.

Priority: third of this batch, after glass-box and return-path.

---

## NEW DEMO BRIEF

| Field | Value |
|---|---|
| Repo name | `crypto-lab-drift-key` (check the catalog for a name collision first. Deliberately **not** "Fuzzy Vault", which is a different scheme: Juels–Sudan 2002) |
| Short name (H1) | Drift Key |
| Subtitle (spec label) | Fuzzy extractors · code-offset (Juels–Wattenberg 1999) · Dodis–Reyzin–Smith 2004 |
| One-liner | Turn a reading that's never the same twice into the same key every time, and see exactly how much secrecy the public helper data costs. |
| Concept to teach | Physical sources (SRAM power-up states in PUFs, biometrics) never give the exact same bits twice. A fuzzy extractor publishes helper data at enrollment; later readings within the error-correction radius reproduce the same key. The helper data is public. For a binary [n,k] linear code it costs at most n − k bits of the source's average min-entropy, and whether what remains is enough depends on how much min-entropy the source had to begin with. |
| Primitives / spec | Code-offset / fuzzy commitment (Juels & Wattenberg, CCS 1999); secure sketches and fuzzy extractors (Dodis, Reyzin, Smith, EUROCRYPT 2004; journal version Dodis, Ostrovsky, Reyzin, Smith, SIAM J. Comput. 2008 — "DORS"); binary BCH codes; HKDF-SHA-256 (RFC 5869, via WebCrypto) as the practical key-derivation step; reusability (Boyen, CCS 2004) as context; SRAM-PUF key generation (Guajardo, Kumar, Schrijen, Tuyls, CHES 2007) as context |
| `--accent` | `#A3E635` (proposed; confirm neighbours per `CLAUDE.md`) |
| Favicon emoji | 〰️ |
| In scope | A labeled noise model standing in for an SRAM PUF; real BCH encode/decode; code-offset enroll/reproduce; measured failure rate against the binomial prediction; min-entropy accounting (source min-entropy, the n − k sketch loss, the residual); a biased-source demo where low starting min-entropy lets a measured guessing attack recover the key from public helper data; an honest reuse panel |
| Non-goals | Any claim that the page reads a real PUF; ring-oscillator physics; biometric feature extraction; computational fuzzy extractors (LWE-based); a live demonstration of Boyen's reuse attacks; attacks on commercial PUF products |

---

## Revision notes (keep in the repo)

- The original gap analysis proposed a "PUF" lab. A browser has no PUF, so any PUF noise here would be simulated, and calling it a PUF lab would break the catalog's "no simulated math" rule. The fuzzy-extractor math is real and fully implementable, so the lab teaches that. The noise source is an explicit, labeled model with its parameters on screen.
- **Revision 1 stated the n − k bound as a uniform-source result applying to "the key's min-entropy". Both parts were wrong.** DORS bounds the residual *average* min-entropy of the *source W given the sketch*, for any source with min-entropy m: at least m − (n − k). The key is produced by a separate extractor/KDF step, which has its own loss.
- **Revision 1 said a biased source makes the helper data leak "more than the bound suggests". That was wrong.** The n − k loss already covers non-uniform sources. Bias lowers the *starting* min-entropy m, so the same n − k loss can leave little or nothing. Act 6 is rewritten around that.
- **Revision 1's Act 7 said XOR-ing two helpers "reveals structure", implying extra leakage about w. That was wrong.** For the same w, h1 ⊕ h2 = c1 ⊕ c2 and w cancels; the first helper already fixes w's coset (the n − k-bit syndrome), so the second adds nothing about w. With a noisy re-read, what's exposed is the noise pattern w ⊕ w′, not w. Boyen 2004 motivates stronger reuse definitions; it isn't demonstrated by this XOR. Act 7 is rewritten as an honest "what reuse does and doesn't show here" panel.

---

## 1. SCOPE

- **Act 1 — Noisy by nature.** Labeled simulator: n cells, each with its own power-up bias, plus a per-read bit-error rate (BER) slider. Generate several readings of the "same device" and show that they differ. Banner: *simulated source; real SRAM behaviour varies*.
- **Act 2 — Why hashing fails.** SHA-256 of reading 1 vs reading 2: completely different. That's the problem.
- **Act 3 — Enroll.** Pick a uniformly random codeword c from the BCH code (or the concatenated repetition + BCH construction; see V2). Publish helper h = w ⊕ c, and derive key = HKDF(w, context). Show what's public and what's secret. In Full-lab mode, show that h is equivalent to publishing the n − k-bit syndrome of w.
- **Act 4 — Reproduce.** New reading w′. Compute h ⊕ w′ = c ⊕ e, decode to c, recover w = h ⊕ c, rederive the key, and show it matches. Push the BER past the code's radius and watch it fail.
- **Act 5 — Measured reliability.** Over many trials: key-failure rate vs BER, plotted against the binomial prediction for a t-error-correcting code. The curves should agree.
- **Act 6 — What the helper data costs.**
  - Show three numbers, computed from the stated model:
    - **m**, the source's min-entropy (for independent cells with bias pᵢ, m = Σ −log₂ max(pᵢ, 1 − pᵢ));
    - the sketch loss **n − k**;
    - the residual **m − (n − k)**.
  - Then raise the bias: m falls, the loss stays the same, and the residual drops toward or below zero. Below zero, the page says there is **no entropy guarantee left**, not "the helper leaks more".
  - Make it concrete with a **measured** guessing attack that uses only public data:
    1. The attacker knows the bias model and computes the most likely reading ŵ.
    2. They decode h ⊕ ŵ to a codeword ĉ, set w* = h ⊕ ĉ, and derive the key.
    3. The page reports the attacker's success rate over trials against each bias setting, next to the residual-entropy figure.
  - The attack succeeding at high bias is consistent with the DORS bound, not a violation of it.
- **Act 7 — Reusing one source: what the XOR shows and what it doesn't.**
  - Enroll the same source twice with independent codewords.
  - Exact-same w: h1 ⊕ h2 = c1 ⊕ c2, a codeword. Show that w cancels and that both helpers carry the same syndrome.
  - Noisy re-read w′ = w ⊕ e: decoding h1 ⊕ h2 gives the noise pattern e, which cells flipped. Show a counter of bits of w learned from this step: zero.
  - Then text only: Boyen 2004 shows ordinary fuzzy-extractor security can fail under repeated use in stronger models (e.g., attacker-influenced perturbations), which is why reusable fuzzy extractors are a separate notion. This page doesn't demonstrate that attack.
- **Act 8 — Why it matters.** Device keys that never sit in non-volatile memory (SRAM PUFs), biometric template protection. Text plus citations only.

## 2. SECURITY / CORRECTNESS INVARIANTS

- **I1.** The BCH encoder/decoder is verified independently:
  - for a small code such as BCH(15,7) with t = 2, exhaustively over all codewords and every error pattern of weight ≤ t, via brute-force nearest-codeword search (§4.1b re-derivation);
  - for the production code size, on random codewords with random ≤ t errors.
  - Decoding must fail or mis-correct, never silently "succeed", for errors of weight > t. Test this.
- **I2.** HKDF comes from WebCrypto, not a hand-rolled implementation. Pin RFC 5869 test vectors through the same call path.
- **I3.** The page never shows the enrolled secret next to the helper data in a way that suggests the helper is secret. Public items carry a "public" label.
- **I4.** Every entropy number is computed from the stated model parameters, with the formula visible in Full-lab mode. The page labels the residual as *average min-entropy of the source given the helper*, never as "the key's entropy". No hard-coded "128-bit secure" text.
- **I5.** The Act 6 attacker module can import only public data (h) and the public bias model, never w, c, or the key. Enforce with a module boundary and an import test.
- **I6.** Every rendered verdict (key match, failure, attack success, "no guarantee left") gets a §4.1c mutation.
- **I7.** The noise-model banner can't be dismissed while the lab is on screen (§4.1d: the page claims the source is simulated, so test that the claim is present).

## 3. ARCHITECTURE

- `source` — the labeled SRAM-like simulator: per-cell bias, per-read flips. Seedable.
- `bch` — GF(2^m) arithmetic, generator polynomial, systematic encode, syndrome → Berlekamp–Massey → Chien search decode.
- `sketch` — code-offset enroll/reproduce, plus a syndrome view. Optional repetition inner code (V2).
- `kdf` — WebCrypto HKDF.
- `attacker` — the Act 6 guessing attack, public inputs only (I5).
- `stats` — the binomial failure prediction and entropy accounting.
- Trials run in a Worker.

## 4. UI

Standard hero roles. Controls: n / code choice, BER, bias strength, number of trials, enroll/reproduce buttons, "enroll again" for Act 7. A three-column layout: *secret* · *public* · *derived key*. Entropy shown as a bar: m, minus n − k, equals the residual, which is visibly allowed to hit zero.

## 5. VISUAL SEMANTICS

- Readings shown as bit grids, with differing bits highlighted between two reads.
- Helper data always drawn in the "public" style.
- The entropy bar never shows a negative residual as a small positive number.
- Never animate the key "emerging" from noise without the decode actually running.

## 6. EDGE CASES

- BER = 0: trivial success. Say so.
- BER right at the radius: show the probabilistic boundary, not a hard cliff.
- Bias = 0: the attacker's success is at chance level, and the page shows that.
- Residual ≤ 0: show "no entropy guarantee", and show the measured attack rate even if it happens to be low for this instance.
- Mis-correction (decoder lands on the wrong codeword): shown as a distinct outcome from decode failure.

## 7. EXTENSION SEAMS

- Different codes (Golay, Reed–Muller) for comparison.
- Debiasing schemes (von Neumann-style) in front of the sketch.
- A reusable-fuzzy-extractor panel if a construction with a clean browser demonstration is chosen later.
- Computational fuzzy extractors (LWE-based) as a later lab.
- A biometric-style source model.

---

## Tests (`e2e/claims.spec.ts`)

- The BCH exhaustive small-code check and random large-code checks (I1).
- The RFC 5869 HKDF vectors.
- Measured failure rate within a stated CI of the binomial prediction at three BER points.
- The displayed m, n − k and residual equal the formulas computed independently in the test.
- The helper's syndrome equals the syndrome of w (the Act 3 equivalence).
- Act 7: for the same w, h1 ⊕ h2 is a codeword; for a noisy re-read, decoding h1 ⊕ h2 returns e (the §4.1d scope: the page claims w is *not* learned from this step, so test that the "bits of w learned" counter is derived, not hard-coded).
- Act 6: the attacker success rate is at chance level at bias 0 and rises at high bias, with thresholds measured and recorded with the seed.
- A §4.1c mutation for every verdict.

## Verification gates

- **V1.** DORS (SIAM J. Comput. 2008): the secure-sketch theorem for an [n,k,2t+1] binary linear code. The residual average min-entropy is ≥ m − (n − k) for any source with min-entropy m, and the code-offset / syndrome equivalence holds. Also the fuzzy-extractor theorem's additional extractor loss. Quote theorem numbers in the README. (A reviewer reports these; confirm the exact statements and numbering before they go on screen.)
- **V2.** Guajardo et al. CHES 2007, plus a helper-data construction paper for the concatenated repetition + BCH choice commonly used for SRAM PUFs. Confirm the paper and parameters before calling them "typical".
- **V3.** Boyen CCS 2004: the reuse models (outsider vs insider-chosen perturbations) and what each breaks. Act 7's text must match the paper's scope. No live attack is claimed.
- **V4.** Optional: PUF-specific helper-data leakage under correlated / non-ideal sources (candidates include Delvaux et al. and Maes). Cite it only if a specific theorem and model is found, and only as text. Act 6 needs no citation beyond DORS.
- **V5.** Juels–Wattenberg 1999 for fuzzy commitment, and Juels–Sudan 2002 only to explain why this lab isn't a fuzzy vault.

## Honesty panel (draft)

- There is no physical device here. The noise source is a labeled model with parameters on screen. The error correction, helper data, and key derivation are real.
- Publishing the helper data costs at most n − k bits of the source's min-entropy. That's a guarantee, not an estimate. Whether enough is left depends on how much min-entropy the source had, and real sources need real characterization.
- A strongly biased source doesn't break the bound; it starts with too little entropy, which is why the guessing attack in Act 6 works.
- Enrolling the same source twice with this construction doesn't reveal it through the XOR of the helpers. Stronger reuse attacks exist in other models (Boyen 2004), and this page doesn't demonstrate them.
- HKDF is a practical key-derivation choice. The DORS security proof uses strong randomness extractors (e.g., universal hashing), so the two rest on different assumptions.

## Category

Grep `CATEGORIES`. The likely fit is HASHING & KDFS or RANDOMNESS; report the choice and why. Don't assume counts.