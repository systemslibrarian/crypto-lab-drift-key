import { expect, test } from '@playwright/test';
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches: the arrival state, where the
 * Noisy Source panel has already powered the modelled device up twice and
 * hashed both readings and the other five tabpanels are hidden and UNRENDERED;
 * the shared skip link focused; a fresh pair of readings; the majority-vote
 * disclosure opened through its summary; the enrolment stepper at step 0 and
 * stepped all six ways to the key comparison; the syndrome-equivalence
 * derivation and the failure-code table opened; the bit-error rate pushed past
 * the code's radius so the decoder's failure verdict and its three failure
 * stages render; the smallest code selected, where mis-correction is reachable
 * at all; the reliability sweep run to completion so the chart, the legend and
 * the wide data table exist, and that table focused as a scroll region; the
 * entropy accounting on a fair-coin source and then on the weak-source fixture,
 * where the reproduce verdict reads pass and the attack verdict reads alarm in
 * the same rendering; the bias sweep and its second chart; the reuse panel on
 * an exact re-enrolment, on a noisy re-read, and on the deliberately broken
 * construction; the references; three hover states; and three focus rings.
 * Every one of those states is scanned, at desktop and phone width.
 *
 * See `gate.ts` for why nothing is injected into the page, why no panel is
 * revealed from script, why the lab's defaults are asserted rather than
 * assumed, and why `violations` is not the whole oracle.
 */

const THEME = 'dark' as const;

test(`no WCAG A/AA violations in ${THEME} theme`, async ({ page }) => {
  test.setTimeout(1_800_000);
  const errors = watchPageErrors(page);
  await boot(page, THEME);
  await driveAllStates(page, THEME);
  expect(errors, errors.join('\n')).toEqual([]);
  expectBaselineNotStale();
  reportCollected();
});

test(`no WCAG A/AA violations in ${THEME} theme at 380px`, async ({ page }) => {
  test.setTimeout(1_800_000);
  const errors = watchPageErrors(page);
  await page.setViewportSize(NARROW);
  await boot(page, THEME);
  await driveAllStates(page, `${THEME} @380px`);
  expect(errors, errors.join('\n')).toEqual([]);
  expectBaselineNotStale();
  reportCollected();
});
