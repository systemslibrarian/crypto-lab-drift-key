/**
 * Known WCAG 1.4.11 / generated-content findings in this lab, captured through
 * the gate's own path so the baseline and the check cannot disagree.
 *
 * THIS FILE IS A TO-DO LIST, NOT A SET OF EXEMPTIONS. The gate ratchets on it:
 *   - a finding NOT listed here fails the run, so a regression cannot land;
 *   - a listed finding whose ratio gets WORSE fails, so the list cannot rot;
 *   - a listed finding that no longer appears ALSO fails, so a fixed entry must
 *     be deleted and the file can only shrink toward empty.
 * The last rule is what stops an allowlist becoming a permanent exemption.
 *
 * `unverified: true` marks an absolutely-positioned pseudo-element. It can paint
 * outside its host and the oracle measures it against the host's backdrop, so
 * that ratio is NOT trustworthy — hand-measure before acting on it.
 *
 * IT IS EMPTY, AND THAT IS THE POINT — this is the terminal state of the
 * ratchet, not an unrun check. The palette was chosen against the arithmetic
 * before any CSS was written: `--control-border` is #7b9a80, which clears 3:1
 * against all three surfaces it lands on (5.74:1 on `--surface`, 5.14:1 on
 * `--surface-2`, 6.32:1 on `--bg`) and against every 12% verdict tint
 * (4.40–4.78:1); `--accent` at #a3e635 clears 11.79:1 as a fill; and the shared
 * top bar's `.cl-btn` draws its edge from `--cl-ink` rather than from the page
 * accent, which is the fix that removes the two entries most of this fleet
 * carries. The `.cell` squares of every bit grid take `--control-border` for
 * the same reason.
 *
 * A run with `NT_BASELINE_CAPTURE=1` set prints every finding through this
 * same path and asserts nothing, which is how this file is regenerated.
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {};
