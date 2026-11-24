# Student-accuracy mutation checks — 24 November 2026

Each mutation below was applied to source in isolation, compiled successfully, and changed the
emitted production bundle before its owning regression was run. The regression failed on its
intended assertion. Source was restored in a `finally` block; rebuilding then reproduced the
original emitted-asset SHA-256 exactly. These four checks supplement the six historical
mutations documented in README; the historical six were not repeated in this review.

| Deliberate fault | Owning regression | Outcome |
| --- | --- | --- |
| old-enrolment-replaces-new | slower old enrolment | Build passed; changed bundle; intended test failed |
| tiny-tail-cdf-subtraction | preserves the exact rational | Build passed; changed bundle; intended test failed |
| empty-attack-success | an empty attack sweep | Build passed; changed bundle; intended test failed |
| zero-noise-false-agreement | even one observed failure | Build passed; changed bundle; intended test failed |

The tests verify observable failures: a 15-bit enrolment replacing a newer 255-bit enrolment;
a small positive binomial tail being lost to CDF subtraction; empty attack measurements
supporting a conclusion; and one impossible zero-noise failure receiving an agreement verdict.
No test gate, timeout, accessibility baseline or cryptographic reference vector was weakened.

Independent review also enumerated all 32,768 small-code received words and all source words in
four biased 15-cell distributions, checked five code dimensions with a binary parity-check-rank
calculation, reproduced 100 HKDF/code-offset cases with Python HMAC, and checked 55 binomial tails
using exact rational arithmetic. The three HKDF known answers were read from RFC 5869 itself.
