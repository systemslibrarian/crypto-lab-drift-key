import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Copied from `crypto-lab-schnorr-forge`, which as of 2026-08-14 was the only
 * lab in this fleet verified clean on every known oracle defect, and then
 * rewritten for what THIS lab paints. Five rules govern it, each correcting a
 * failure mode the retired template gate had:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. Pushing
 *     `animation:none!important; transition:none!important` through
 *     `addStyleTag` BYPASSES the lab's own
 *     `@media (prefers-reduced-motion: reduce)` block instead of exercising it,
 *     so the rendering a reduced-motion reader actually gets is never the one
 *     scanned. This gate sets the preference through `emulateMedia`, asserts
 *     from inside the page that it took effect (`test.use({ reducedMotion })`
 *     is a measured no-op on Playwright 1.61.x), and injects nothing.
 *
 *  2. NO PANEL IS FORCED VISIBLE FROM SCRIPT. Stripping `[hidden]` puts all six
 *     tabpanels on screen at once — a rendering no reader can reach — and
 *     script-opening every `<details>` means the SHUT state, which is what every
 *     reader arrives at, is never scanned. This gate switches tabs by clicking
 *     them and opens each disclosure through its `<summary>`, and scans before
 *     and after.
 *
 *  3. THE DRIVE NAMES EVERY CONTROL IT TOUCHES. No regex button-clicking, no
 *     swallowed failures, no fixed timeouts: every wait is on a real DOM
 *     completion signal — a verdict appearing, a step counter advancing,
 *     `aria-selected`, a worker sweep's table landing — and a scan happens after
 *     every step. A click that silently did nothing fails here rather than
 *     looking identical to one that worked.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. The surfaces carrying
 *     this lab's meaning are all `color-mix()` fills that axe files under
 *     `incomplete` rather than judging: every `.verdict-*` tone, the four
 *     `.callout-*` kinds, the `.negative-claim` block, the `.model-banner`, the
 *     hero aside and the shared top bar's ink. So is an `aria-label` on a
 *     role-less element — and this page leans on getting that right, because
 *     every bit grid is a `role="img"` whose label is the only route to what
 *     the picture says.
 *
 *  5. REFLOW, NON-TEXT CONTRAST AND GENERATED CONTENT HAVE NO axe RULE AT ALL.
 *     `nontext.ts` measures every control's boundary against what surrounds it
 *     at every driven state; `expectNoHorizontalOverflow` adds WCAG 1.4.10,
 *     which matters here because this page paints wide data tables and a 640-unit
 *     SVG chart at 380px.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Two rAFs are not enough. A transition sampled mid-flight has a colour that
 * exists in no state of the page, and axe will happily report it: elsewhere in
 * this fleet that produced a phantom 2.00:1 failure on a button whose settled
 * ratio is 9:1. Transitions also drain in waves rather than in one batch, so a
 * poll for "nothing running right now" can exit through a gap between waves —
 * hence six consecutive quiet frames rather than one.
 *
 * Bounded three ways, because a gate that can hang is a gate nobody runs:
 * animations that never finish (`iterations: Infinity`) are excluded from the
 * quiescence test rather than waited on, a wall-clock budget inside the page
 * gives up and proceeds, and Playwright's own timeout is the backstop.
 *
 * Under the reduced motion this gate asserts, `style.css`'s reduced-motion
 * block cancels `.panel` / `.reveal` animations and every transition, so
 * `getAnimations()` is normally empty and this returns on the sixth frame. It
 * stays because the shared top bar's `.cl-btn` transitions are declared
 * OUTSIDE the lab's `@media` block — `* { transition: none !important }` wins
 * today, but that is a property of the current stylesheet, not of the page.
 */
export async function settle(page: Page, budgetMs = 4000): Promise<void> {
  await page.waitForFunction(
    (budget: number) => {
      const w = window as unknown as { __quietFrames?: number; __settleStart?: number };
      if (w.__settleStart === undefined) w.__settleStart = performance.now();
      const done = (): boolean => {
        w.__quietFrames = 0;
        w.__settleStart = undefined;
        return true;
      };
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        const timing = a.effect?.getComputedTiming?.();
        // An infinite decorative animation never drains; waiting on it hangs.
        return timing?.iterations !== Infinity;
      });
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      if (w.__quietFrames >= 6) return done();
      if (performance.now() - (w.__settleStart ?? 0) > budget) return done();
      return false;
    },
    budgetMs,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab
 * declares no keyframes at all today and reveals every stepper stage by
 * APPENDING it to the DOM rather than by animating it, so there is nothing for
 * the reduced-motion block to cancel wrongly. The assertion runs anyway, at
 * every driven state, so that stays a measurement rather than a reading of the
 * stylesheet — the day someone reaches for a fade-in on `.stage`, this is what
 * catches the version of it that leaves the stage invisible.
 *
 * `aria-hidden` subtrees are excluded; what this lab hides is the decorative
 * glyph at the head of each verdict, which sits beside its own words.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created. Every panel here renders synchronously at first activation, so a
 * renderer that throws leaves that tabpanel EMPTY — and an empty region is
 * exactly what a scan reports as perfectly accessible. Attach before `boot`,
 * assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark.
 *
 * The shared `.cl-topbar` carries an explicit `role="banner"`. This lab's own
 * hero is a `<div class="cl-hero">`, not a `<header>`, so nothing here implies
 * a second banner today — but the shared bar's `dedupeBanner()` exists because
 * other labs in this fleet DID ship one, and the hero markup is the part of
 * this page most likely to be re-templated from a lab that uses `<header>`.
 * Asserting the OUTCOME rather than the markup is what catches that edit.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * List semantics survive their styling.
 *
 * Several lists here are styled `list-style: none` — the chart legend, the
 * honesty list, the references, the related demos — which is exactly the
 * declaration that makes Safari and VoiceOver DROP a list's implicit role. Each
 * carries the documented compensation: an explicit `role="list"` with
 * `role="listitem"` on every child. What is asserted is therefore the SHAPE of
 * that fix: any explicit role on a `ul`/`ol` must be `list` (any other value
 * orphans every `<li>` under it), and a `role="list"` must never sit on an
 * empty element, because axe applies `aria-required-children` to the explicit
 * role and fails it the day a list renders with no children — which the chart
 * legend would do if a sweep ever returned no series. Roles are assigned in an
 * element-creation helper, so ask the DOM rather than grepping the source.
 */
export async function assertListSemantics(page: Page): Promise<void> {
  const broken = await page.$$eval('ul[role], ol[role]', (els) =>
    els
      .filter((e) => e.getAttribute('role') !== 'list' || e.children.length === 0)
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] with ${e.children.length} children`
      )
  );
  expect(
    broken,
    'an explicit non-list role on a list deletes its semantics; an empty role="list" fails aria-required-children'
  ).toEqual([]);
}

/**
 * Load the page with reduced motion actually in effect, and assert the content
 * every scan relies on is really on the page — including the lab's DEFAULTS,
 * which are never assumed.
 *
 * `test.use({ reducedMotion })` is a measured no-op on Playwright 1.61.x, so
 * the emulation is applied imperatively BEFORE navigation and then ASSERTED
 * from inside the page.
 *
 * The defaults are asserted at length because every panel renders lazily on
 * first activation and the arrival panel builds asynchronously: the store
 * enrols through WebCrypto HKDF before anything appears. A navigation that
 * resolves proves nothing — a renderer that threw would leave the panel empty,
 * and an empty region is exactly what a scan reports as perfectly accessible.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await assertSingleBanner(page);
  await assertListSemantics(page);

  // ── The page really rendered ────────────────────────────────────────────
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('.tab-btn')).toHaveCount(6);
  await expect(page.locator('h1')).toHaveCount(1);

  // The shared skip link points at an id that exists. axe's skip-link rule is
  // best-practice, not WCAG-tagged, so `withTags` never runs it — a skip link
  // aimed at a missing element is exactly the kind of thing a green axe run
  // says nothing about.
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app');
  await expect(page.locator('#app')).toHaveCount(1);

  // Dark is the only theme, so the page must carry no theme control at all.
  // The shared CSS hides any lab toggle with `display:none !important`, which
  // would leave a dead-but-known element; asserting the count at zero catches
  // the day one is added without going through that list.
  await expect(
    page.locator('#theme-toggle, #themeToggle, .theme-toggle, .theme-toggle-btn, [data-theme-toggle]')
  ).toHaveCount(0);
  await expect(page.locator('#cl-theme-toggle')).toHaveCount(0);

  // ── Invariant I7: the simulated-source banner, and no way to dismiss it ──
  // The page claims the source is a model. §4.1d says a claim with nothing
  // checking it is a claim that drifts, so the claim's own visibility is
  // asserted here at every boot, and the absence of any control inside it is
  // asserted too — a dismissible banner is a banner that is not there.
  const banner = page.locator('.model-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('There is no physical device in this page');
  await expect(banner.locator('button, a, input, [role="button"]')).toHaveCount(0);

  // ── The arrival state: Noisy Source active, five panels unrendered ───────
  await expect(page.locator('#panel-source')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Noisy Source' })).toHaveAttribute('aria-selected', 'true');
  for (const id of ['enroll', 'reliability', 'cost', 'reuse', 'context']) {
    await expect(page.locator(`#panel-${id}`)).toBeHidden();
    await expect(page.locator(`#panel-${id}`)).toBeEmpty();
  }

  // The arrival panel finishes asynchronously — two power-up readings and two
  // SHA-256 digests. Wait on the real content, never on a timeout.
  await expect(page.locator('#panel-source [data-grid="reading-1"]')).toBeVisible();
  await expect(page.locator('#panel-source [data-grid="reading-2"]')).toBeVisible();
  await expect(page.locator('#panel-source [data-verdict="hash-fails"]')).toBeVisible();
  await expect(page.locator('#panel-source [data-claim="sha-reading-1"]')).not.toBeEmpty();

  // ── Disclosures ship shut ───────────────────────────────────────────────
  await expect(page.locator('#app details[open]')).toHaveCount(0);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all. This lab's long
 * values are 64-byte hex runs — every `.field-value` and `.eq-derivation`
 * relies on `overflow-wrap: anywhere` instead of a scroll region, and the
 * `.sig-pair` grid collapses to one column at 640px — so the shapes at risk
 * are a new unwrapped `<code>` run or a grid item whose automatic minimum size
 * is the min-content of a 128-char line. At 380px that is precisely what this
 * check exists to catch.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This lab currently avoids scrollers on purpose — long hex wraps via
 * `overflow-wrap: anywhere` — so the assertion is usually vacuous here. It
 * runs at every state anyway, because the requirement MATERIALISES the moment
 * someone reaches for `overflow-x: auto` on a wide value or table (the
 * stylesheet already carries an unused `.table-wrap` rule inviting exactly
 * that), and a scroller born without a keyboard route is invisible to axe.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Nothing may be focusable while it paints nothing (WCAG 2.4.3 / 2.4.7).
 *
 * `opacity: 0` with `pointer-events: none` is NOT hiding: the element keeps
 * `tabIndex: 0`, so a keyboard reader tabs to a control that is not on screen
 * and the focus ring lands nowhere. `display: none` and `visibility: hidden`
 * DO remove an element from the tab order, so those are skipped rather than
 * flagged — the failure is specifically the invisible-but-tabbable pair. The
 * `hidden` tabpanels here take the `display: none` route, which is why five
 * panels' worth of buttons are legitimately absent from the tab order.
 *
 * Off-screen-but-focusable is the WCAG-sanctioned skip-link idiom and is
 * deliberately not flagged: the shared skip link parks at `top:-3rem` with
 * full opacity and slides in on focus. The drive scans it focused.
 */
export async function expectNoInvisibleFocusTargets(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.tabIndex < 0) continue;
      // display:none / visibility:hidden already remove it from the tab order.
      if (!el.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        effective *= parseFloat(getComputedStyle(n).opacity);
      }
      const r = el.getBoundingClientRect();
      if (effective !== 0 && r.width > 0 && r.height > 0) continue;
      // Confirm it really is reachable rather than inferring it.
      const before = document.activeElement;
      el.focus();
      const took = document.activeElement === el;
      (before as HTMLElement | null)?.focus?.();
      if (took) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
            ` (opacity ${effective}, ${Math.round(r.width)}x${Math.round(r.height)})`
        );
      }
    }
    return Array.from(new Set(out));
  });
  expect(bad, `focusable elements that paint nothing in state: ${label}`).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run.
 * It is a debugging aid only: `A11Y_COLLECT` is never set in CI, and a run
 * with it set prints every finding as it happens and then fails at the end, so
 * a green collection run cannot be mistaken for a green gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function soft(fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    // Generous, not 900: a truncated oracle dump is how a second and third
    // finding in the same state get missed on a collection pass.
    record(String(e).slice(0, 6000));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no
 * text node.
 *
 * IT IS CALLED FROM `scan()`, deliberately and not by accident. Fleet-wide
 * this oracle had been called from inside a soft wrapper AFTER its
 * `if (!COLLECTING) return` guard — so in a strict run, which is every run in
 * CI and every run anyone reads as a pass, the guard returned first and
 * `nontext.ts` never executed at all. Thirteen repos certified themselves
 * clean on an oracle that had never looked. Calling it here means it runs at
 * every driven state, including `:hover`, and this repo's baseline was
 * captured by that live path.
 *
 * A check that merely logs is not a gate, so it ratchets: anything NOT in the
 * baseline fails, anything in the baseline that got WORSE fails, and anything
 * in the baseline that has been FIXED fails until its entry is deleted. That
 * last rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`);
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the
 * point — or the drive stopped reaching the state that shows it, which is a
 * coverage regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Nine assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically — which matters here because the surfaces carrying
 *    this lab's meaning are `color-mix()` fills axe cannot resolve: every
 *    verdict tone, both pill states, the danger/caveat callouts, the
 *    learner-check tint, the hero aside and the shared bar's ink. Everything
 *    else in that bucket is a real result axe simply could not finish —
 *    including `aria-prohibited-attr`, which is where an `aria-label` on a
 *    role-less element hides. This page leans on getting that right: the
 *    `.seg`, `.radio-row`, `.preset-row` and learner-check option groups all
 *    pair their labels with `role="group"`. Drop any of those roles and the
 *    label is silently discarded.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - the same walk over `aria-hidden` content with the exemption lifted —
 *    SC 1.4.3 is about what a reader SEES; see `contrast.ts` for what this
 *    lab hides and why it is measured anyway.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`. This is the only oracle that judges a
 *    control's boundary against the surface OUTSIDE it.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - no focusable element that paints nothing — WCAG 2.4.3/2.4.7.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads
  // exactly like a full A/AA pass. For scale, `withTags(TAGS)` selects 69 of
  // axe-core 4.12's 105 rule definitions; the chained form executes 4.
  //
  // The landmark four are still wanted because they are best-practice rather
  // than WCAG-tagged, so `withTags` alone does not reach them — and this page
  // has the shape they catch: a sticky `<header role="banner">` above a
  // `<div id="app">` holding an `<aside class="cl-hero-why">`, two `<nav>`s
  // (the shared actions and the tablist wrapper), one `<main>` and a footer.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  // The `incomplete` bucket is asserted, not skimmed. `aria-prohibited-attr`
  // and `aria-required-children` appear ONLY here — never in `violations` — so
  // a gate that ignores this bucket cannot see either. Only `color-contrast`
  // is allowed to remain, and only because the arithmetic walk below judges
  // those ratios for real; no other rule is filtered out.
  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  // The aria-hidden walk, exemption lifted — axe skips this text entirely and
  // the default walk honours the same boundary, so this second call is the
  // ONLY thing that ever measures it. See `contrast.ts` for the inventory.
  const hiddenContrast = Array.from(
    new Set(
      formatContrastFailures(
        await auditContrast(page, '[aria-hidden="true"], [aria-hidden="true"] *', true)
      )
    )
  );
  softExpect(hiddenContrast, `measured aria-hidden contrast failures in state: ${label}`, []);

  await soft(() => expectNoNewNonTextFailures(page, label));
  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoInvisibleFocusTargets(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
}

// ── The drive ───────────────────────────────────────────────────────────────

/** Switch to a tab by clicking it, and prove the switch happened. */
async function openTab(page: Page, name: string, panelId: string): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click();
  await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(panelId)).toBeVisible();
  await expect(page.locator(panelId)).not.toBeEmpty();
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Five things shape this drive.
 *
 *  - THE ARRIVAL STATE IS SCANNED FIRST, exactly as a reader gets it: the Noisy
 *    Source panel with two readings and two digests already on screen, five
 *    panels hidden and unrendered, every disclosure shut.
 *
 *  - EVERY PANEL IS RENDERED LAZILY, so a tab that is never clicked is a panel
 *    that is never even in the DOM. Each of the six is activated through its
 *    real tab button and scanned in its own driven states.
 *
 *  - EVERY OUTCOME STATE, INCLUDING THE ONES THAT NEED A DELIBERATE MISTAKE.
 *    The bit-error slider is pushed past the code's radius so the decoder's
 *    failure verdict renders; the smallest code is selected so mis-correction
 *    becomes reachable; the weak-source fixture is driven so the both-at-once
 *    alarm and the negative-claim block are scanned; the broken-construction
 *    toggle is driven so its alarm renders. None of these is reachable without
 *    doing something wrong on purpose, and none would otherwise be scanned.
 *
 *  - THE TWO WORKER SWEEPS ARE RUN TO COMPLETION, because the chart, the legend
 *    and the wide data tables only exist afterwards — and the tables are this
 *    page's only horizontal scrollers, which is a WCAG 2.1.1 case with its own
 *    oracle in `expectScrollersReachable`.
 *
 *  - HOVER IS A STATE, AND IT PERSISTS AFTER A CLICK. `:hover` stays on the
 *    element under the pointer after `page.click()` resolves, so it is the state
 *    a reader occupies the instant after pressing a button — and `.btn:hover`,
 *    `.tab-btn:hover` and `.cl-btn:hover` all repaint. Scanned explicitly.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);

  await scanAt('arrival: Noisy Source with two readings and two digests, five panels unrendered');

  // ── The shared skip link, focused ───────────────────────────────────────
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('the shared skip link focused, slid in from top:-3rem');

  // ── Noisy Source ────────────────────────────────────────────────────────
  await page.locator('#sample-again').click();
  await expect(page.locator('#panel-source [data-verdict="readings-differ"]')).toBeVisible();
  await scanAt('Source: a fresh pair of power-up readings, still hovered');

  await page.locator('#panel-source details.disclose > summary').first().click();
  await expect(page.locator('#panel-source details[open]')).toHaveCount(1);
  await scanAt('Source: the majority-vote disclosure open');
  await page.locator('#panel-source details.disclose > summary').first().click();

  // ── Enrol & Reproduce: the stepper, end to end ──────────────────────────
  await openTab(page, 'Enrol & Reproduce', '#panel-enroll');
  await expect(page.locator('#panel-enroll [data-claim="enroll-step"]')).toHaveText('Step 0 / 6');
  await expect(page.locator('#step-back')).toBeDisabled();
  await expect(page.locator('#panel-enroll [data-verdict="reproduce"]')).toBeVisible();
  await scanAt('Enrol: step 0 — Back disabled, the three-column split, the reproduce verdict');

  for (let i = 1; i <= 6; i++) {
    await page.locator('#step-next').click();
    await expect(page.locator('#panel-enroll [data-claim="enroll-step"]')).toHaveText(`Step ${i} / 6`);
  }
  await expect(page.locator('#panel-enroll .stage')).toHaveCount(7);
  await expect(page.locator('#step-next')).toBeDisabled();
  await expect(page.locator('#panel-enroll [data-verdict="key-match"]')).toBeVisible();
  await scanAt('Enrol: stepped to the end — six stages, the key comparison, Next disabled');

  await page.locator('#panel-enroll details.disclose > summary').first().click();
  await expect(page.locator('#panel-enroll details[open]')).toHaveCount(1);
  await expect(page.locator('#panel-enroll [data-verdict="syndrome-equivalence"]')).toBeVisible();
  await scanAt('Enrol: the syndrome-equivalence disclosure open');

  await page.locator('#panel-enroll details.disclose > summary').last().click();
  await expect(page.locator('#panel-enroll details[open]')).toHaveCount(2);
  await scanAt('Enrol: the failure-code table open');

  // Push the bit-error rate well past the code's radius. This is the only route
  // to the decoder's failure verdict and the three failure stages behind it.
  await page.locator('#ber-slider').fill('0.3');
  await expect(page.locator('#panel-enroll [data-verdict="reproduce"]')).toHaveAttribute(
    'data-result',
    /fail|alarm/
  );
  await scanAt('Enrol: bit-error rate past the radius — the decoder fails and says which code');

  await page.locator('#ber-slider').fill('0.02');
  await expect(page.locator('#panel-enroll [data-verdict="reproduce"]')).toHaveAttribute('data-result', 'pass');

  // The smallest code, where mis-correction is reachable at all.
  await page.locator('#code-select').selectOption('bch-15-7');
  await expect(page.locator('#panel-enroll [data-claim="code-params"]')).toContainText('BCH(15, 7)');
  await scanAt('Enrol: the smallest code selected, re-enrolled');

  await page.locator('#enrol-again').click();
  await expect(page.locator('#panel-enroll [data-verdict="reproduce"]')).toBeVisible();
  await scanAt('Enrol: enrolled again on a fresh reading, button still hovered');

  await page.locator('#code-select').selectOption('bch-127-64');
  await expect(page.locator('#panel-enroll [data-claim="code-params"]')).toContainText('BCH(127, 64)');

  // ── Measured Reliability, including the worker sweep ────────────────────
  await openTab(page, 'Measured Reliability', '#panel-reliability');
  await expect(page.locator('#panel-reliability [data-chart="reliability-prediction"]')).toBeVisible();
  await scanAt('Reliability: the prediction alone, before any measurement');

  await page.locator('#trials-select').selectOption('200');
  await page.locator('#run-reliability').click();
  await expect(page.locator('#panel-reliability [data-table="reliability"]')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#panel-reliability [data-verdict="reliability-agreement"]')).toBeVisible();
  await scanAt('Reliability: the sweep finished — chart, legend, and the wide data table');

  await page.locator('#panel-reliability details.disclose > summary').first().click();
  await expect(page.locator('#panel-reliability details[open]')).toHaveCount(1);
  await scanAt('Reliability: the mis-correction disclosure open');

  // The table is the page's widest element and its only scroll region.
  await page.locator('#panel-reliability .table-wrap').first().focus();
  await scanAt('Reliability: the data table focused as a scroll region');

  // ── What the Helper Costs ───────────────────────────────────────────────
  await openTab(page, 'What the Helper Costs', '#panel-cost');
  await expect(page.locator('#panel-cost [data-claim="entropy-bar"]')).toBeVisible();
  await expect(page.locator('#panel-cost [data-verdict="residual-state"]')).toHaveAttribute('data-result', 'pass');
  await scanAt('Cost: a fair-coin source — the residual bar positive, the guarantee real');

  await page.locator('#run-attack').click();
  await expect(page.locator('#panel-cost [data-verdict="attack"]')).toBeVisible();
  await scanAt('Cost: the attack run against an unbiased source and losing');

  // The weak-source fixture: the negative claim's evidence state. Every check
  // the construction performs passes AND the key is already recovered.
  await page.locator('#weak-fixture').click();
  await expect(page.locator('#panel-cost [data-verdict="weak-source-headline"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#panel-cost [data-verdict="residual-state"]')).toHaveAttribute('data-result', 'alarm');
  await expect(page.locator('#panel-cost [data-negative-claim]')).toBeVisible();
  await scanAt('Cost: the weak-source fixture — reproduced AND recovered, the deficit bar below zero');

  await page.locator('#panel-cost details.disclose > summary').first().click();
  await expect(page.locator('#panel-cost details[open]')).toHaveCount(1);
  await scanAt('Cost: the formulas disclosure open');
  await page.locator('#panel-cost details.disclose > summary').first().click();

  await page.locator('#run-attack-sweep').click();
  await expect(page.locator('#panel-cost [data-table="attack"]')).toBeVisible({ timeout: 120_000 });
  await scanAt('Cost: the bias sweep finished — the second chart and its table');

  await page.locator('#skew-slider').fill('0.75');
  await expect(page.locator('#panel-cost [data-verdict="residual-state"]')).toHaveAttribute('data-result', /warn|pass|alarm/);
  await scanAt('Cost: the skew slider mid-range — a thin residual');

  await page.locator('#skew-slider').fill('0.5');

  // ── Enrolling Twice ─────────────────────────────────────────────────────
  await openTab(page, 'Enrolling Twice', '#panel-reuse');
  await expect(page.locator('#panel-reuse [data-verdict="reuse-bits-learned"]')).toBeVisible();
  await expect(page.locator('#panel-reuse [data-claim="bits-learned"]')).toHaveText('0');
  await scanAt('Reuse: two helpers for the identical reading — the XOR is a codeword');

  await page.locator('#mode-noisy').click();
  await expect(page.locator('#mode-noisy')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#panel-reuse [data-verdict="reuse-xor"]')).toBeVisible();
  await scanAt('Reuse: a noisy re-read — the XOR exposes the flipped cells');

  await page.locator('#con-broken').click();
  await expect(page.locator('#con-broken')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#panel-reuse [data-verdict="broken-construction"]')).toBeVisible();
  await scanAt('Reuse: the broken construction — the alarm and the narrowed candidate count');

  await page.locator('#panel-reuse details.disclose > summary').first().click();
  await expect(page.locator('#panel-reuse details[open]')).toHaveCount(1);
  await scanAt('Reuse: the reusability disclosure open');

  await page.locator('#con-correct').click();
  await page.locator('#mode-exact').click();

  // ── Why It Matters ──────────────────────────────────────────────────────
  await openTab(page, 'Why It Matters', '#panel-context');
  await expect(page.locator('#panel-context .honesty-list li')).toHaveCount(6);
  await scanAt('Context: the honesty list and the related demos');

  await page.locator('#panel-context details.disclose > summary').first().click();
  await expect(page.locator('#panel-context details[open]')).toHaveCount(1);
  await scanAt('Context: the references disclosure open');

  // ── Hover, which persists after a click ─────────────────────────────────
  await page.getByRole('tab', { name: 'Noisy Source', exact: true }).hover();
  await scanAt('an inactive tab hovered — its surface fill repainted');

  await page.locator('.cl-topbar .cl-btn').first().hover();
  await scanAt('a shared top bar control hovered');

  await openTab(page, 'Enrol & Reproduce', '#panel-enroll');
  await page.locator('#enrol-again').hover();
  await scanAt('a primary button hovered');

  // ── Focus rings on the controls that take them ──────────────────────────
  await page.locator('#ber-slider').focus();
  await expect(page.locator('#ber-slider')).toBeFocused();
  await scanAt('the range slider focused, showing its focus-visible outline');

  await page.locator('#code-select').focus();
  await scanAt('the select focused');

  await page.getByRole('tab', { name: 'Enrol & Reproduce', exact: true }).focus();
  await scanAt('the active tab focused');
}
