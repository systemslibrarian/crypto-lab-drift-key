# Drift Key

**Fuzzy extractors · code-offset secure sketch · BCH · HKDF-SHA-256**

Turn a reading that is never the same twice into the same key every time, and see exactly how
much secrecy the public helper data costs.

**[Live demo →](https://systemslibrarian.github.io/crypto-lab-drift-key/)**

---

## What It Is

An interactive lab for **fuzzy extractors**: the construction that turns a noisy, non-repeatable
physical measurement into a stable cryptographic key, at a cost in secrecy you can write down
before you build anything.

The exact primitives on the page:

- **The code-offset secure sketch.** Juels and Wattenberg published it in 1999 as *fuzzy
  commitment*; Dodis, Reyzin and Smith named and analysed it as a *secure sketch* in 2004.
  Enrolment picks a uniformly random codeword `c` and publishes `h = w XOR c`. Reproduction
  computes `h XOR w' = c XOR e`, decodes to `c`, and recovers `w = h XOR c`.
- **Binary primitive narrow-sense BCH codes**, hand-rolled and inspectable: GF(2^m) log/antilog
  arithmetic, the generator polynomial built from cyclotomic cosets, systematic encoding,
  syndromes, Berlekamp–Massey, and a Chien search. Five sizes from BCH(15, 7) to BCH(255, 131).
- **HKDF-SHA-256 from WebCrypto** (RFC 5869) as the key-derivation step, pinned to all three of
  the RFC's SHA-256 test vectors through the same call path the lab derives keys with.
- **A labelled noise model** standing in for an SRAM PUF, with its parameters on screen.

**The security model, stated plainly.** For a binary linear `[n, k]` code used in the code-offset
construction, and *any* source `W` with min-entropy `m`, the sketch leaves

```
Hinf~(W | SS(W))  >=  m - (n - k)
```

That is the *average min-entropy of the source given the helper data* — how hard `W` still is to
guess for someone holding everything that was published. It is an upper bound on the **loss**, not
an estimate of it, and it holds for non-uniform sources without modification.

In Dodis, Ostrovsky, Reyzin and Smith this is **Theorem 5.1**: an `[n, k, 2t+1]` code over `F`
gives an average-case `(F^n, m, m − (n − k)f, t)` secure sketch, and over the binary alphabet
`f = 1`. It rests on their **Lemma 2.2(b)** — a published value with at most `2^λ` possibilities
costs at most `λ` bits of average min-entropy, and the syndrome has exactly `2^(n−k)` of them.
**Construction 2** is the code-offset construction, and the paper says outright that over the
binary alphabet it *is* the Juels–Wattenberg commitment `SS(w) = w ⊕ C(x)`; **Construction 3**
publishes the syndrome directly, and the two are proved equivalent in both directions — which is
the equality the Enrol & Reproduce panel measures on screen. **Lemma 4.1** builds the fuzzy
extractor from a sketch plus an average-case strong extractor.

*These numbers were read from [eprint.iacr.org/2003/235](https://eprint.iacr.org/2003/235), the
revision dated 20 January 2008, which is the journal version — not from the printed SIAM pages.
Numbering can differ between a preprint and the copy-edited article, so every statement is given
in full here and on the page as well; check those rather than the numbers if the two disagree.*

Three things it is **not**:

- It is **not** the entropy of the derived key. The key comes from a further extraction step with
  its own loss. The security proof uses a strong randomness extractor (universal hashing and the
  leftover hash lemma) and gives an information-theoretic statement; this lab uses HKDF-SHA-256,
  which is what a real device ships and rests on different assumptions. No bit count for the key
  itself is claimed anywhere.
- It is **not** a promise that enough is left. Bias does not make the helper leak more than
  `n − k` bits — it lowers `m`, so the same subtraction can leave nothing. The page shows the
  residual going below zero and says there is no guarantee left, which is a different statement
  from "the helper leaks more".
- It is **not** production crypto. This is a teaching demo. The code is written to be read, the
  model PRNG is not cryptographic, and nothing here has been reviewed for deployment.

**There is no physical device in this page.** A browser has no PUF and cannot acquire one, so the
cell readings come from an explicit model whose parameters are on screen. Everything downstream of
the readings — the error-correcting code, the helper data, the key derivation — is real.

## Exhibits

1. **Noisy Source.** Power the modelled device up twice and watch the cells disagree. Then hash
   both readings with real SHA-256 and watch the two digests diverge completely — the problem the
   rest of the lab exists to solve.
2. **Enrol & Reproduce.** The headline mechanism, stepped one line at a time: the enrolled reading
   `w`, a uniformly random codeword `c`, the published helper `h = w XOR c`, a later reading `w'`,
   the offset `h XOR w'`, the decode that finds and undoes the flips, the recovered reading, and
   the key. Every point where two things should be equal is compared byte for byte on screen.
   A three-column split keeps *secret*, *public* and *derived* apart. Push the bit-error rate past
   the code's radius and the real decoder fails, naming its own failure code; choose BCH(15, 7)
   and it will sometimes **mis-correct** instead — returning a perfectly well-formed key that is
   simply the wrong one.
3. **Measured Reliability.** Thousands of full enrol-and-reproduce cycles in a worker, plotted
   against `1 − P(Binomial(n, BER) ≤ t)` with no fitted parameter, with 95% intervals drawn and
   decode failures and mis-corrections counted separately.
4. **What the Helper Costs.** The entropy bar: `m`, minus `n − k`, equals the residual — which is
   allowed to reach zero and go below it, and is drawn below zero when it does. Beside it, a
   measured guessing attack that uses only public data, and a sweep across the whole bias range
   showing how far apart "the bound stops promising" and "the attack starts winning" really are.
   This panel holds the negative claim (below).
5. **Enrolling Twice.** Two helpers for one source. Exactly: `h1 XOR h2 = c1 XOR c2`, a codeword —
   the reading cancels. With a noisy re-read the XOR exposes *which cells flipped*, not what they
   hold. The "bits of the reading the second helper added" counter is **counted, not asserted**:
   every candidate is enumerated. A deliberately broken variant — drawing the codeword from half
   the code — makes that same counter move, which is what makes the zero a result.
6. **Why It Matters.** SRAM PUF device keys, biometric template protection, the honesty list, and
   the references.

## What Can Go Wrong

- **The source has less min-entropy than you assumed.** This is the failure that matters, and the
  construction cannot see it. Enrolment, decoding and reproduction behave identically whether the
  residual bound is 64 bits or 50 below zero. Characterising a real source means measuring per-cell
  behaviour across temperature, voltage and device lifetime — there is no substitute, and nothing
  in the pipeline does it for you.
- **The re-reading drifts past the code's radius.** The device cannot unlock. That is the correct
  behaviour; the alternative is worse.
- **Mis-correction.** Past the radius the decoder can land on a *different* codeword, correct
  towards it, and report success. The device derives a well-formed key that is not the right key —
  and a real device holds no copy of the enrolled reading to compare against, so it cannot tell
  this from a correct reproduction. Systems that need to know add a key confirmation value (a MAC
  or hash of the key, published alongside the helper data). That is an addition to this
  construction, not a property of it.
- **The random codeword is not uniform over the whole code.** Then the `n − k` bound does not
  apply, because that was its hypothesis. The Enrolling Twice panel ships this as a marked, broken
  variant: reproduction still works perfectly and the first helper costs 11 bits instead of 8.
- **Helper-data manipulation.** An attacker who can *modify* the published helper data is outside
  the model this page demonstrates. The code-offset sketch provides no integrity for it.
- **Repeated enrolment in a stronger model.** Boyen (CCS 2004) showed ordinary fuzzy-extractor
  security can fail under repeated use when an attacker can influence the perturbations between
  readings. Reusable fuzzy extractors are a separate notion for that reason. **This page does not
  demonstrate those attacks**, and the XOR exhibit in panel 5 is not evidence about them either way.

### The negative claim

Every lab here declares at least one security property its construction does **not** provide, and
backs it with a state you can reach:

> **Reproducing the key correctly is not evidence that any secrecy is left.** This construction
> raises no failure code for a source that never had enough min-entropy: enrolment, decoding and
> reproduction behave identically whether the residual bound is 64 bits or 50 bits below zero.

The **Weak-source fixture** button on panel 4 drives the page into exactly that state. Every check
the construction performs reports success — the decoder corrects, the codeword matches, the
recovered reading matches, the key matches byte for byte, the syndrome equivalence holds — and the
key has *already* been recovered from the published data by the attacker running beside it. The
headline verdict reads **KEY REPRODUCED — AND RECOVERED FROM PUBLIC DATA**.

`e2e/claims.spec.ts` asserts all three halves of that: that the state is reachable through the UI,
that every construction check in it reports pass (swept across the page, not sampled), and that the
limitation is visible on screen in that state rather than hidden behind a disclosure.

## When to Use It

**Use a fuzzy extractor when** the secret you want is a measurement rather than a stored value: an
SRAM PUF device key, a ring-oscillator or arbiter PUF, a biometric template you must not store. The
appeal is that between power-ups there is nothing on the chip to find.

**Do NOT use one when:**

- **You have not measured the source's min-entropy.** The `n − k` bound is arithmetic; `m` is an
  empirical fact about your hardware, and the whole guarantee is their difference. A fuzzy
  extractor over an uncharacterised source is a key derived from an unknown quantity.
- **You could just store a key in protected hardware.** A secure element with real key storage is
  simpler, faster and better understood. Fuzzy extractors earn their complexity where that option
  does not exist.
- **Your error metric is not Hamming distance.** Set difference wants a fuzzy vault (Juels–Sudan
  2002), which is a different scheme; edit distance wants something else again.
- **You need to re-enrol under an adversary's influence.** That is the reusability setting, and it
  needs a construction designed for it.

## Live Demo

**<https://systemslibrarian.github.io/crypto-lab-drift-key/>**

Power the device up twice and see the cells disagree. Step through the enrolment one line at a
time and watch the key come back byte for byte. Push the bit-error slider past the code's radius
and break it. Run a few thousand reproductions and lay the measurement over the prediction. Then
raise the cell skew, watch the residual bound cross zero, and run the attack that takes the key out
of the public helper data.

## Real-World Usage

- **SRAM PUF key generation.** The power-up pattern of an uninitialised SRAM block is a per-chip
  fingerprint. Guajardo, Kumar, Schrijen and Tuyls (CHES 2007) proposed deriving a device key from
  it with helper data, and the approach is shipped commercially. Published constructions for this
  setting typically concatenate a repetition code with a BCH code, so a cheap inner stage cleans up
  the bulk of the noise and the BCH stage handles the rest.
- **Biometric template protection.** Juels and Wattenberg's original motivation. Feature extraction
  — turning a scan into a bit string whose Hamming distance means something — is its own hard
  problem and is not modelled here.
- **Anti-counterfeiting and key storage without key storage.** A device that can derive its key but
  never holds it at rest changes what an attacker must do; reading the flash gives them the helper
  data, which was public anyway.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-drift-key.git
cd crypto-lab-drift-key
npm install
npm run dev          # http://localhost:5173/crypto-lab-drift-key/
```

```bash
npm test             # 175 unit tests (Vitest)
npm run build        # typecheck + production build
npx playwright install chromium
npm run test:a11y    # the WCAG 2.1 AA gate, desktop and 380px
npm run test:claims  # 21 claims tests, incl. the negative-claim fixture
```

## Related Demos

- [crypto-lab-syndrome-drain](https://systemslibrarian.github.io/crypto-lab-syndrome-drain/) —
  syndrome decoding as a *hardness* assumption. The same syndrome, used for the opposite purpose:
  here it is the thing the helper reveals, there it is the thing that must stay hard.
- [crypto-lab-mceliece-gate](https://systemslibrarian.github.io/crypto-lab-mceliece-gate/) —
  error-correcting codes where knowing the decoder *is* the trapdoor.
- [crypto-lab-kdf-chain](https://systemslibrarian.github.io/crypto-lab-kdf-chain/) — what a
  key-derivation function is doing, step by step.
- [crypto-lab-entropy-collapse](https://systemslibrarian.github.io/crypto-lab-entropy-collapse/) —
  what happens to a system when its entropy source is not what it was believed to be.
- [crypto-lab-quantum-entropy](https://systemslibrarian.github.io/crypto-lab-quantum-entropy/) —
  extracting a key from a physical randomness source.

## Build & Verify

**198 tests, all passing: 175 unit (Vitest), 21 claims and 2 accessibility scans (Playwright).**

Known-answer and exhaustive verification:

| What | Where |
|---|---|
| RFC 5869 HKDF-SHA-256 vectors A.1, A.2, A.3, through the lab's own call path | `src/crypto/kdf.test.ts` |
| BCH `(n, k)` against the published parameter table, 16 codes | `src/crypto/bch.test.ts` |
| BCH(15, 7) over its **whole 2^15 space**: the decoder corrects exactly the words inside a ball of radius `t` and fails on exactly the words outside every ball, judged by a brute-force nearest-codeword oracle that shares no arithmetic with it | `src/crypto/bch.test.ts` |
| Every codeword × every error of weight ≤ 2 (15,488 decodes), and every weight-3 pattern (58,240) confirming a decode past the radius never returns the sent codeword | `src/crypto/bch.test.ts` |
| GF(2^m) table multiplication against carry-less multiply-and-reduce, exhaustively for m = 3…8 | `src/crypto/gf2m.test.ts` |
| `syn(h) = syn(w)`, and that a coset has exactly 2^k members, by enumeration | `src/crypto/sketch.test.ts` |
| Measured reliability within four standard errors of the binomial prediction, seeded | `src/model/trials.test.ts` |
| The attacker module's imports, parsed from its own source (invariant I5) | `src/model/attacker.test.ts` |

**Accessibility.** `npm run build && npm run test:a11y` must pass with **zero** violations, at
1280px and at 380px, and it gates the deploy. The gate is the honest form: it injects nothing into
the page, reveals no panel from script, asserts axe's `incomplete` bucket as well as `violations`,
and adds the three oracles axe has no rule for — arithmetic composite-aware contrast, non-text
contrast ratcheted against an **empty** baseline, and reflow. It found three real defects on its
first runs, each fixed in the source rather than baselined.

**Mutation discipline.** A green suite is not evidence until you have watched it fail. Six
mutations were applied to the source, each confirmed to build cleanly and change the shipped
bundle before its owning test was checked:

| Mutation | Result |
|---|---|
| Delete the negative-claim sentence | the §4.1d fixture fails on assertion 3, naming the missing text |
| Invert the byte-for-byte comparison | the fixture fails on assertion 2: `key-match` reports `fail` |
| Report the *promised* leak instead of the measured one in the reuse counter | `THE COUNTER MOVES` fails: "8 bits, not the 8 the construction promises" |
| `residual = m + (n − k)` instead of `m − (n − k)` | 5 unit tests and 2 claims tests fail |
| Degrade `--control-border` below 3:1 | the a11y gate fails naming every tab at 1.90:1 |
| Degrade `--text-dim` below 4.5:1 | the a11y gate fails with axe violations at every driven state |

One mutation left everything green: removing the decoder's final "is the corrected word really a
codeword?" check. Under §4.1c that is evidence about the *source*, so it was measured rather than
explained away — across the entire 32,768-word space of BCH(15, 7) and 20,000 heavy-error decodes
over all five codes, `DECODE_RESIDUAL_SYNDROME` never fires; the Chien root-count test catches every
inconsistent locator first. The check stays, because it is the last thing standing between
"corrected" and a best guess, but the finding is recorded in `bch.ts`, asserted in `bch.test.ts`,
and stated on the page's own failure-code table rather than letting the lab list a code it cannot
raise.

## Performance

Every trial runs the whole pipeline — enrol with a fresh random codeword, derive a real
HKDF-SHA-256 key, reproduce, compare key bytes — rather than shortcutting to a Hamming-weight test
that would agree with the prediction by construction. In a worker, on a laptop: about 2,700
reproductions in 210 ms on BCH(127, 64), and about 5,400 in 1.5 s on BCH(255, 131). The exhaustive
BCH(15, 7) test suite decodes about 139,000 received words, cross-checking most of them against a
brute-force search over all 128 codewords.

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
