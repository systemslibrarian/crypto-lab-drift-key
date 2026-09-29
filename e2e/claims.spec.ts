import { expect, type Locator, type Page, test } from '@playwright/test';

/**
 * Does the page tell the truth?
 *
 * THE RULE THAT MAKES THESE TESTS WORTH ANYTHING (template §4.1b): compare two
 * values the page itself printed, rather than asserting against a hardcoded
 * string — and where possible recompute the claim from the page's own raw
 * inputs BY A DIFFERENT ROUTE than the source takes. A test that re-derives the
 * same expression the source uses will happily agree with a bug.
 *
 * So this suite is a mix:
 *
 *   INDEPENDENT RE-DERIVATIONS.  The construction's central identity,
 *     h = w XOR c, is recomputed here from the three hex values the page
 *     printed. The binomial prediction in the reliability table is recomputed
 *     by a direct factorial sum, which is a different algorithm from the
 *     log-space one in `stats.ts`. The single-guess chance level is recomputed
 *     from n and t. The attack's win condition is re-derived from the two
 *     numbers beside it — cells wrong, and the code's radius — rather than
 *     read off the verdict.
 *
 *   CROSS-CHECKS.  Two surfaces that must agree: the code label against the
 *     sketch-loss figure, the grid's own set-count caption against the bits it
 *     drew, the step counter against the number of stages rendered.
 *
 *   PARTS-SUM-TO-WHOLE.  Reproduced + decode failures + mis-corrections is the
 *     trial count, on every row. m minus (n − k) is the residual, at every bias.
 *
 * And §4.1d's negative claim: a reachable state in which every check the
 * construction performs reports success and the named property is violated
 * anyway. Reaching it, proving everything is green in it, and proving the
 * limitation is on screen in it are three separate assertions.
 */

const CODE_LABEL = /BCH\((\d+), (\d+)\), t = (\d+)/;

/**
 * Arrive, and switch to Explore.
 *
 * The default experience is the guided path; the six panels these tests drive
 * are Explore mode. `bootGuided` is the arrival state for the tests that are
 * about the guided path itself.
 */
async function boot(page: Page): Promise<void> {
  await bootGuided(page);
  await page.locator('#mode-explore').click();
  await expect(page.locator('#explore')).toBeVisible();
  await expect(page.locator('#panel-source [data-verdict="hash-fails"]')).toBeVisible();
}

async function bootGuided(page: Page): Promise<void> {
  page.setDefaultTimeout(20_000);
  await page.goto('.');
  await expect(page.locator('#guided-read')).toBeVisible();
  await expect(page.locator('[data-claim="scenario-residual"]')).not.toBeEmpty();
}

async function openTab(page: Page, name: string, panelId: string): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click();
  await expect(page.locator(panelId)).toBeVisible();
  await expect(page.locator(panelId)).not.toBeEmpty();
}

/** Is this element inside the viewport right now? */
async function inViewport(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;
  });
}

/**
 * Walk the guided path to the end, returning how many PRIMARY ACTIONS it took.
 *
 * `beforeEach` runs at the top of each scene, before its action, so a test can
 * inspect the scene as a visitor first meets it without duplicating the walk.
 */
async function walkGuided(
  page: Page,
  beforeEach?: (scene: number) => Promise<void>,
): Promise<number> {
  const scenes: { act: () => Promise<void>; settled: string }[] = [
    { act: async () => { await page.locator('#guided-read').click(); }, settled: '[data-verdict="guided-drift"]' },
    { act: async () => { await page.locator('#guided-hash').click(); }, settled: '[data-verdict="guided-hash"]' },
    { act: async () => { for (let i = 0; i < 6; i++) await page.locator('#guided-step-next').click(); }, settled: '[data-verdict="guided-reproduce"]' },
    { act: async () => { await page.locator('#guided-break').click(); }, settled: '[data-verdict="guided-broken"]' },
    { act: async () => { await page.locator('#guided-weak').click(); }, settled: '[data-verdict="guided-verdict"]' },
  ];

  let actions = 0;
  for (const [i, s] of scenes.entries()) {
    await expect(page.locator(`[data-scene="${i + 1}"]`)).toBeVisible();
    await beforeEach?.(i + 1);
    await s.act();
    actions++;
    await expect(page.locator(s.settled)).toBeVisible({ timeout: 90_000 });
    if (i < scenes.length - 1) await page.locator('#scene-next').click();
  }
  return actions;
}

/**
 * Enrol until the reproduction succeeds, and return how many it took.
 *
 * At the shipped defaults -- BCH(127, 64) and a 4% bit-error rate -- about one
 * reading in seventy-seven drifts past the radius of ten and the stepper
 * renders its FAILURE branch instead of the key comparison. That is the page
 * being right, not wrong: the reliability panel predicts exactly 1.3% there.
 * But a test that steps through and then asserts on the key comparison is a
 * test that goes red one run in seventy-seven, so the branch is pinned here
 * rather than hoped for. The failure branch is driven deliberately elsewhere,
 * by pushing the bit-error rate past the radius.
 */
async function enrolUntilReproduced(page: Page, attempts = 40): Promise<number> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await page.locator('[data-verdict="reproduce"]').getAttribute('data-result');
    if (result === 'pass') return attempt;
    await page.locator('#enrol-again').click();
    await expect(page.locator('[data-verdict="reproduce"]')).toBeVisible();
  }
  throw new Error(`no reproduction succeeded in ${attempts} enrolments`);
}

/** The full value behind an elided readout: the `title`, or the text if short. */
async function fullValue(locator: Locator): Promise<string> {
  const title = await locator.getAttribute('title');
  if (title) return title;
  const text = (await locator.textContent()) ?? '';
  return text.trim();
}

function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/** Direct factorial binomial tail — a different algorithm from `stats.ts`. */
function binomialAtMostDirect(n: number, p: number, t: number): number {
  let total = 0;
  for (let j = 0; j <= t; j++) {
    let choose = 1;
    for (let i = 0; i < j; i++) choose = (choose * (n - i)) / (i + 1);
    total += choose * p ** j * (1 - p) ** (n - j);
  }
  return total;
}

async function readVerdict(page: Page, id: string): Promise<{ text: string; result: string; check: string }> {
  const node = page.locator(`[data-verdict="${id}"]`);
  await expect(node, `the page no longer renders the ${id} verdict`).toBeVisible();
  return {
    text: (await node.textContent()) ?? '',
    result: (await node.getAttribute('data-result')) ?? '',
    check: (await node.getAttribute('data-check')) ?? '',
  };
}

async function readClaim(page: Page, id: string): Promise<string> {
  const node = page.locator(`[data-claim="${id}"]`);
  await expect(node, `the page no longer renders the ${id} claim`).toBeVisible();
  return ((await node.textContent()) ?? '').trim();
}

/**
 * A verdict's words, its machine-readable result and its tone are ONE claim.
 * Asserting only the text passes a mutation that flips `data-result` alone —
 * a page whose sentence contradicts its own marker.
 */
async function expectVerdict(
  page: Page,
  id: string,
  expected: { result: string; contains: string; check?: string },
): Promise<void> {
  const actual = await readVerdict(page, id);
  expect(actual.result, `${id} data-result`).toBe(expected.result);
  expect(actual.text, `${id} wording`).toContain(expected.contains);
  await expect(page.locator(`[data-verdict="${id}"]`)).toHaveClass(
    new RegExp(`verdict-${expected.result}\\b`),
  );
  if (expected.check) expect(actual.check, `${id} data-check`).toBe(expected.check);
}

test.describe('the construction', () => {
  test('h = w XOR c, recomputed from the three values the page printed', async ({ page }) => {
    await boot(page);
    await openTab(page, 'Enrol & Reproduce', '#panel-enroll');

    const w = await fullValue(page.locator('[data-claim="col-w"]'));
    const c = await fullValue(page.locator('[data-claim="col-c"]'));
    const helper = await fullValue(page.locator('[data-claim="col-h"]'));

    // Shape first: a truncated or missing value would make the XOR below agree
    // with itself for the wrong reason.
    for (const [name, value] of [['w', w], ['c', c], ['h', helper]] as const) {
      expect(value, `${name} is not rendered as full hex`).toMatch(/^[0-9a-f]{32}$/);
    }

    const wb = hexToBytes(w);
    const cb = hexToBytes(c);
    const hb = hexToBytes(helper);
    // The independent re-derivation: the page never prints this XOR, and the
    // source computes it through a bit-vector path, not a byte path.
    expect(wb.map((byte, i) => byte ^ cb[i])).toEqual(hb);

    // And it is not vacuous: the codeword is not zero, so h really differs from w.
    expect(cb.some((byte) => byte !== 0)).toBe(true);
    expect(helper).not.toBe(w);
  });

  test('the stepper ends with the same key, and both sides are printed in full', async ({ page }) => {
    await boot(page);
    await openTab(page, 'Enrol & Reproduce', '#panel-enroll');
    await enrolUntilReproduced(page);
    expect(await readClaim(page, 'enroll-step')).toBe('Step 0 / 6');

    for (let i = 1; i <= 6; i++) {
      await page.locator('#step-next').click();
      expect(await readClaim(page, 'enroll-step')).toBe(`Step ${i} / 6`);
    }
    // Cross-check: the counter against the stages actually rendered.
    await expect(page.locator('#panel-enroll .stage')).toHaveCount(7);

    const now = await fullValue(page.locator('[data-claim="key-match-left"]'));
    const atEnrolment = await fullValue(page.locator('[data-claim="key-match-right"]'));
    expect(now, 'the key is not printed as a full 32-byte hex string').toMatch(/^[0-9a-f]{64}$/);
    expect(now).toBe(atEnrolment);
    await expectVerdict(page, 'key-match', { result: 'pass', contains: 'THE SAME KEY', check: 'construction' });

    // The recovered reading equals the enrolled one, and the codeword matches.
    await expectVerdict(page, 'word-match', { result: 'pass', contains: 'Identical', check: 'construction' });
    await expectVerdict(page, 'codeword-match', { result: 'pass', contains: 'Same codeword', check: 'construction' });

    // The decoder's error positions are the cells that actually flipped.
    const found = await readClaim(page, 'error-positions');
    const actual = await readClaim(page, 'actual-flips');
    expect(found).toBe(actual);
  });

  test('the helper carries exactly the syndrome, and a codeword carries none', async ({ page }) => {
    await boot(page);
    await openTab(page, 'Enrol & Reproduce', '#panel-enroll');
    await page.locator('#panel-enroll details.disclose > summary').first().click();

    const ofHelper = await readClaim(page, 'syndrome-equivalence-left');
    const ofSource = await readClaim(page, 'syndrome-equivalence-right');
    const ofCodeword = await readClaim(page, 'codeword-syndrome');

    const label = (await readClaim(page, 'code-params')).match(CODE_LABEL);
    expect(label, 'the code label no longer parses').toBeTruthy();
    const n = Number(label![1]);
    const k = Number(label![2]);

    // Cross-check: the syndrome is n - k bits wide, which is the whole of the
    // sketch loss claimed two panels later.
    expect(ofHelper).toMatch(/^[01]+$/);
    expect(ofHelper.length).toBe(n - k);
    expect(ofHelper).toBe(ofSource);
    expect(ofCodeword).toBe('0'.repeat(n - k));
    await expectVerdict(page, 'syndrome-equivalence', { result: 'pass', contains: 'Identical', check: 'construction' });
  });
});

test.describe('every failure path, and the page naming the cause', () => {
  test('past the radius the decoder fails and prints its own failure code', async ({ page }) => {
    await boot(page);
    await openTab(page, 'Enrol & Reproduce', '#panel-enroll');
    await page.locator('#ber-slider').fill('0.3');

    const reproduce = await readVerdict(page, 'reproduce');
    expect(['fail', 'alarm']).toContain(reproduce.result);

    if (reproduce.result === 'fail') {
      for (let i = 0; i < 6; i++) await page.locator('#step-next').click();
      const code = await readClaim(page, 'decode-failure-code');
      // The named cause, not a paraphrase, and it is one of the codes the
      // construction actually exports.
      expect(['DECODE_BEYOND_RADIUS', 'DECODE_RESIDUAL_SYNDROME']).toContain(code);
      expect(reproduce.text).toContain(code);
      await expectVerdict(page, 'decode', { result: 'fail', contains: 'Decoding failed', check: 'construction' });
      await expectVerdict(page, 'recover-word', { result: 'fail', contains: 'No source word', check: 'construction' });
      await expectVerdict(page, 'recover-key', { result: 'fail', contains: 'No key derived', check: 'construction' });
    } else {
      expect(reproduce.text).toContain('MISCORRECTED');
    }

    // The flip count is past the radius, which is WHY it failed. Re-derived
    // from the two figures beside the verdict rather than from the verdict.
    const flips = Number(await readClaim(page, 'flips-this-read'));
    const label = (await readClaim(page, 'code-params')).match(CODE_LABEL);
    expect(flips).toBeGreaterThan(Number(label![3]));
  });

  test('mis-correction is reachable, and reads as its own outcome', async ({ page }) => {
    await boot(page);
    await openTab(page, 'Enrol & Reproduce', '#panel-enroll');
    await page.locator('#code-select').selectOption('bch-15-7');
    await page.locator('#ber-slider').fill('0.25');

    // Mis-correction is probabilistic even at this bias, so re-enrol until it
    // happens. The bound keeps a broken page from spinning here for ever.
    let sawMiscorrection = false;
    for (let attempt = 0; attempt < 60 && !sawMiscorrection; attempt++) {
      await page.locator('#enrol-again').click();
      const v = await readVerdict(page, 'reproduce');
      if (v.result === 'alarm') {
        expect(v.text).toContain('WRONG KEY RETURNED');
        expect(v.text).toContain('MISCORRECTED');
        sawMiscorrection = true;
      }
    }
    expect(sawMiscorrection, 'BCH(15,7) at BER 0.25 never mis-corrected in 60 enrolments').toBe(true);

    // The decoder reported success; the key is simply wrong. Both at once.
    for (let i = 0; i < 6; i++) await page.locator('#step-next').click();
    await expectVerdict(page, 'codeword-match', { result: 'fail', contains: 'DIFFERENT codeword', check: 'construction' });
    await expectVerdict(page, 'key-match', { result: 'fail', contains: 'DIFFERENT KEY', check: 'construction' });
  });

  test('BER zero reproduces with nothing corrected, and the page says it is trivial', async ({ page }) => {
    await boot(page);
    await openTab(page, 'Enrol & Reproduce', '#panel-enroll');
    await page.locator('#ber-slider').fill('0');
    expect(await readClaim(page, 'flips-this-read')).toBe('0');
    expect(await readClaim(page, 'predicted-failure')).toBe('0%');
    await expectVerdict(page, 'reproduce', { result: 'pass', contains: 'KEY REPRODUCED', check: 'construction' });
  });
});

test.describe('the measured sweeps agree with the predictions', () => {
  test('every reliability row sums to its trial count and matches a direct binomial', async ({ page }) => {
    await boot(page);
    await openTab(page, 'Measured Reliability', '#panel-reliability');
    await page.locator('#trials-select').selectOption('400');
    await page.locator('#run-reliability').click();
    await expect(page.locator('[data-table="reliability"]')).toBeVisible({ timeout: 180_000 });

    const label = (await page.locator('[data-table="reliability"] caption').textContent())?.match(CODE_LABEL);
    expect(label, 'the reliability table caption no longer names the code').toBeTruthy();
    const n = Number(label![1]);
    const t = Number(label![3]);

    const rows = await page.locator('[data-table="reliability"] tbody tr').all();
    expect(rows.length).toBeGreaterThan(5);

    for (const row of rows) {
      const cells = await row.locator('th, td').allTextContents();
      const [berText, trialsText, reproduced, decodeFailures, misCorrections, measured, , predicted] = cells.map((c) =>
        c.trim(),
      );
      const trials = Number(trialsText);

      // Parts sum to whole: every trial ended in exactly one of three outcomes.
      expect(Number(reproduced) + Number(decodeFailures) + Number(misCorrections)).toBe(trials);

      // The measured rate is the failures over the trials, both on screen.
      const failures = trials - Number(reproduced);
      const measuredValue = Number(measured.replace('%', '').replace('< 0.01', '0'));
      expect(Math.abs(measuredValue / 100 - failures / trials)).toBeLessThan(0.0006);

      // Independent re-derivation: a direct factorial binomial, which is not
      // the log-space algorithm the source uses.
      const ber = Number(berText.replace('%', '')) / 100;
      const expected = 1 - binomialAtMostDirect(n, ber, t);
      const shown = predicted.startsWith('<') ? 0 : Number(predicted.replace('%', '')) / 100;
      expect(Math.abs(shown - expected)).toBeLessThan(0.002);
    }

    // The headline verdict is keyed on standard errors, not on whether every
    // 95% interval happened to bracket the prediction -- across ten points a
    // correct page misses one about half the time. Both figures are asserted:
    // the verdict's own criterion, and the interval count as a figure.
    await expectVerdict(page, 'reliability-agreement', {
      result: 'pass',
      contains: 'agrees with the prediction',
    });
    const worstZ = Number(await readClaim(page, 'reliability-worst-z'));
    expect(worstZ).toBeLessThanOrEqual(4);
    expect(await readClaim(page, 'reliability-intervals')).toMatch(/^\d+ \/ \d+$/);
  });

  test('switching the code RETIRES the sweep, and re-selecting the same one does not', async ({ page }) => {
    await boot(page);
    await openTab(page, 'Measured Reliability', '#panel-reliability');
    await page.locator('#trials-select').selectOption('200');
    await page.locator('#run-reliability').click();
    await expect(page.locator('[data-table="reliability"]')).toBeVisible({ timeout: 180_000 });

    // The no-op guard first: re-selecting the SAME code must not discard a
    // fresh result. Playwright dispatches change even when the value is
    // unchanged, so this really exercises the handler.
    await openTab(page, 'Enrol & Reproduce', '#panel-enroll');
    await page.locator('#code-select').selectOption('bch-127-64');
    await openTab(page, 'Measured Reliability', '#panel-reliability');
    await expect(page.locator('[data-table="reliability"]')).toBeVisible();

    // Now a real change. The stale sweep must be gone, not left beside a code
    // it was never run against.
    await openTab(page, 'Enrol & Reproduce', '#panel-enroll');
    await page.locator('#code-select').selectOption('bch-31-16');
    await openTab(page, 'Measured Reliability', '#panel-reliability');
    await expect(page.locator('[data-table="reliability"]')).toHaveCount(0);
    await expect(page.locator('#panel-reliability .callout-info')).toContainText('Press Run the sweep');
    await expect(page.locator('[data-chart="reliability-prediction"]')).toBeVisible();
  });
});

test.describe('the entropy accounting', () => {
  async function readAccounting(page: Page): Promise<{ m: number; loss: number; residual: number }> {
    return {
      m: parseFloat(await readClaim(page, 'min-entropy')),
      loss: parseFloat(await readClaim(page, 'sketch-loss')),
      residual: parseFloat(await readClaim(page, 'residual')),
    };
  }

  test('residual = m - (n - k) at every bias, and the loss never moves', async ({ page }) => {
    await boot(page);
    await openTab(page, 'What the Helper Costs', '#panel-cost');

    const seen: number[] = [];
    let previousM = Infinity;
    for (const skew of ['0.5', '0.7', '0.85', '0.99']) {
      await page.locator('#skew-slider').fill(skew);
      await expect(page.locator('[data-claim="skew-slider-value"]')).toHaveText(Number(skew).toFixed(2));
      const a = await readAccounting(page);

      // Parts sum to whole, on every setting.
      expect(Math.abs(a.residual - (a.m - a.loss))).toBeLessThan(0.11);
      // The loss is a property of the CODE, so raising the bias must not move it.
      seen.push(a.loss);
      // And the bias must genuinely be lowering m, or the exhibit shows nothing.
      expect(a.m).toBeLessThan(previousM);
      previousM = a.m;

      // The bar repeats the same three numbers; the two surfaces must agree.
      expect(parseFloat(await readClaim(page, 'bar-m'))).toBeCloseTo(a.m, 1);
      expect(parseFloat(await readClaim(page, 'bar-loss'))).toBeCloseTo(a.loss, 1);
      expect(parseFloat(await readClaim(page, 'bar-residual'))).toBeCloseTo(a.residual, 1);
    }
    expect(new Set(seen).size, 'the sketch loss moved when the bias did').toBe(1);
  });

  test('a fair-coin source has m = n exactly, and the loss is n - k', async ({ page }) => {
    await boot(page);
    await openTab(page, 'What the Helper Costs', '#panel-cost');
    await page.locator('#skew-slider').fill('0.5');

    await openTab(page, 'Enrol & Reproduce', '#panel-enroll');
    const label = (await readClaim(page, 'code-params')).match(CODE_LABEL);
    const n = Number(label![1]);
    const k = Number(label![2]);

    await openTab(page, 'What the Helper Costs', '#panel-cost');
    const a = await readAccounting(page);
    // Independent re-derivation: n fair coins have exactly n bits of
    // min-entropy, and the syndrome of an [n, k] code is n - k bits wide.
    expect(a.m).toBeCloseTo(n, 1);
    expect(a.loss).toBe(n - k);
    expect(a.residual).toBeCloseTo(n - (n - k), 1);
    await expectVerdict(page, 'residual-state', { result: 'pass', contains: 'Guaranteed at least' });
  });

  test('a negative residual is drawn below zero, never as a small positive', async ({ page }) => {
    await boot(page);
    await openTab(page, 'What the Helper Costs', '#panel-cost');
    await page.locator('#skew-slider').fill('0.99');

    const residual = parseFloat(await readClaim(page, 'residual'));
    expect(residual).toBeLessThan(0);
    // The DEFICIT bar, not the positive residual bar. Which element exists is
    // the picture's own claim about the sign.
    await expect(page.locator('#panel-cost .bar-deficit')).toHaveCount(1);
    await expect(page.locator('#panel-cost .bar-residual')).toHaveCount(0);
    await expect(page.locator('#panel-cost .bar-note')).toContainText('below zero');
    await expectVerdict(page, 'residual-state', { result: 'alarm', contains: 'NO ENTROPY GUARANTEE LEFT' });
    // And it says the right thing about WHY, which Revision 2 of the brief
    // exists to correct: the helper does not leak more, the source had less.
    await expect(page.locator('[data-verdict="residual-state"]')).toContainText('it does not say the helper leaks more');
  });
});

test.describe('the measured attack', () => {
  test('the win condition is the guess landing inside the radius, re-derived', async ({ page }) => {
    await boot(page);
    await openTab(page, 'What the Helper Costs', '#panel-cost');

    for (const skew of ['0.5', '0.99']) {
      await page.locator('#skew-slider').fill(skew);
      await page.locator('#run-attack').click();
      await expect(page.locator('[data-verdict="attack"]')).toBeVisible();

      const wrong = Number(await readClaim(page, 'attack-distance'));
      const radius = Number((await readClaim(page, 'attack-radius')).replace(/[^0-9]/g, ''));
      const verdict = await readVerdict(page, 'attack');

      // The independent re-derivation: whether the attacker won follows from
      // two numbers printed beside the verdict, not from the verdict.
      const shouldWin = wrong <= radius;
      expect(verdict.result).toBe(shouldWin ? 'alarm' : 'pass');
      expect(verdict.text).toContain(shouldWin ? 'THE ATTACKER HAS THE KEY' : 'did not get the key');
    }
  });

  test('against a fair-coin source the attack is at a chance level far below any decimal', async ({ page }) => {
    await boot(page);
    await openTab(page, 'What the Helper Costs', '#panel-cost');
    await page.locator('#skew-slider').fill('0.5');

    const chance = await readClaim(page, 'attack-chance');
    const exponent = Number(chance.replace('2^', ''));
    expect(exponent).toBeLessThan(-40);

    await openTab(page, 'Enrol & Reproduce', '#panel-enroll');
    const label = (await readClaim(page, 'code-params')).match(CODE_LABEL);
    const n = Number(label![1]);
    const t = Number(label![3]);

    // Independent re-derivation of |B_t| / 2^n from n and t alone.
    let ball = 0;
    for (let j = 0; j <= t; j++) {
      let choose = 1;
      for (let i = 0; i < j; i++) choose = (choose * (n - i)) / (i + 1);
      ball += choose;
    }
    expect(Math.abs(exponent - (Math.log2(ball) - n))).toBeLessThan(0.1);
  });

  test('the bias sweep table is internally consistent and matches the exact probability', async ({ page }) => {
    await boot(page);
    await openTab(page, 'What the Helper Costs', '#panel-cost');
    await page.locator('#run-attack-sweep').click();
    await expect(page.locator('[data-table="attack"]')).toBeVisible({ timeout: 180_000 });

    const rows = await page.locator('[data-table="attack"] tbody tr').all();
    expect(rows.length).toBeGreaterThan(5);
    let sawZero = false;
    let sawWinning = false;

    for (const row of rows) {
      const cells = (await row.locator('th, td').allTextContents()).map((c) => c.trim());
      const [, mText, lossText, residualText, trialsText, wonText, measuredText] = cells;
      const trials = Number(trialsText);
      const won = Number(wonText);

      // Parts sum to whole, again: residual is m minus the loss, per row.
      expect(Math.abs(Number(residualText) - (Number(mText) - Number(lossText)))).toBeLessThan(0.11);
      // The measured column is the count over the trials, both on screen.
      const measured = measuredText.startsWith('<') ? 0 : Number(measuredText.replace('%', '')) / 100;
      expect(Math.abs(measured - won / trials)).toBeLessThan(0.006);

      if (won === 0) sawZero = true;
      if (won / trials > 0.2) sawWinning = true;
    }
    // Both ends of the exhibit must be populated, or the sweep showed one thing.
    expect(sawZero, 'the sweep never reached a bias where the attack loses').toBe(true);
    expect(sawWinning, 'the sweep never reached a bias where the attack wins').toBe(true);
  });
});

test.describe('enrolling twice', () => {
  test('the bits-learned counter is a ratio of two counts the page printed', async ({ page }) => {
    await boot(page);
    await openTab(page, 'Enrolling Twice', '#panel-reuse');

    const before = Number(await readClaim(page, 'candidates-before'));
    const after = Number(await readClaim(page, 'candidates-after'));
    const bits = Number(await readClaim(page, 'bits-learned'));

    // Derived, not hard-coded: the counter is log2 of the two counts beside it.
    expect(bits).toBeCloseTo(Math.log2(before / after), 6);
    expect(bits).toBe(0);
    expect(before).toBe(128);
    await expectVerdict(page, 'reuse-bits-learned', { result: 'pass', contains: 'added nothing', check: 'construction' });
    await expectVerdict(page, 'reuse-xor', { result: 'pass', contains: 'is a codeword', check: 'construction' });
    expect(await readClaim(page, 'reuse-syn1')).toBe(await readClaim(page, 'reuse-syn2'));
  });

  test('a noisy re-read exposes the flips and still adds no bits of the reading', async ({ page }) => {
    await boot(page);
    await openTab(page, 'Enrolling Twice', '#panel-reuse');
    await page.locator('#mode-noisy').click();

    expect(await readClaim(page, 'reuse-syn1')).not.toBe(await readClaim(page, 'reuse-syn2'));
    const exposed = Number(await readClaim(page, 'reuse-exposed'));
    expect(exposed).toBeGreaterThan(0);
    // What was exposed is the noise. The counter for the READING stays zero,
    // and it is still a ratio of two printed counts rather than a constant.
    const before = Number(await readClaim(page, 'candidates-before'));
    const after = Number(await readClaim(page, 'candidates-after'));
    expect(Number(await readClaim(page, 'bits-learned'))).toBeCloseTo(Math.log2(before / after), 6);
    expect(Number(await readClaim(page, 'bits-learned'))).toBe(0);
  });

  test('THE COUNTER MOVES: a codeword from half the code narrows the reading further', async ({ page }) => {
    await boot(page);
    await openTab(page, 'Enrolling Twice', '#panel-reuse');
    const correctBefore = Number(await readClaim(page, 'candidates-before'));

    await page.locator('#con-broken').click();
    await expect(page.locator('#con-broken')).toHaveAttribute('aria-pressed', 'true');

    const brokenBefore = Number(await readClaim(page, 'candidates-before'));
    // The measurement that makes the zero above a result rather than a
    // decoration: the same instrument reads differently on a broken construction.
    expect(brokenBefore).toBeLessThan(correctBefore);
    expect(brokenBefore).toBe(16);
    await expectVerdict(page, 'broken-construction', { result: 'alarm', contains: 'The FIRST helper cost' });
    await expect(page.locator('[data-verdict="broken-construction"]')).toContainText('11 bits');

    // And the SECOND helper still adds nothing, which is the narrow claim.
    expect(Number(await readClaim(page, 'bits-learned'))).toBe(0);
  });
});

test.describe('the page tells the truth about itself', () => {
  test('the simulated-source banner is present and cannot be dismissed (I7)', async ({ page }) => {
    await boot(page);
    const banner = page.locator('.model-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('No physical device here');
    await expect(banner).toContainText('Not production crypto');
    // A `<summary>` opens detail; it cannot remove the banner. The check names
    // the shapes that COULD dismiss it rather than counting every element.
    await expect(
      banner.locator('button, a, input, [role="button"], [aria-label*="ismiss"], [aria-label*="lose"], [aria-label*="ide"]'),
    ).toHaveCount(0);
    // The headline sentence sits OUTSIDE the disclosure, so closing it changes
    // nothing about whether the claim is on screen.
    await expect(banner.locator('> .model-banner-body > p')).toContainText('No physical device here');

    // Still there after driving the lab, not only at first paint.
    await openTab(page, 'What the Helper Costs', '#panel-cost');
    await expect(banner).toBeVisible();
  });

  test('nothing is hidden by a class rule while the code believes it is hidden', async ({ page }) => {
    await boot(page);
    // The §4.1 [hidden] cascade probe: a class rule setting `display` outranks
    // the UA `[hidden]` rule, so an element can paint while its attribute says
    // otherwise. Ask the browser what it painted.
    const painting = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[hidden]'))
        .filter((el) => (el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true }))
        .map((el) => `${el.tagName.toLowerCase()}#${el.id}`),
    );
    expect(painting).toEqual([]);
    await expect(page.locator('.panel[hidden]')).toHaveCount(5);
  });

  test('the bit grids say in words what they draw', async ({ page }) => {
    await boot(page);
    const grid = page.locator('[data-grid="reading-2"]');
    const label = (await grid.getAttribute('aria-label')) ?? '';
    const caption = await readClaim(page, 'reading-2-stat');

    // Cross-check: the accessible label and the visible caption count the same
    // cells, so a reader who cannot see the grid is not told something else.
    const set = Number(label.match(/(\d+) reading 1 and/)?.[1]);
    const ringed = Number(label.match(/(\d+) cells? ringed/)?.[1] ?? 0);
    expect(caption).toContain(`${set}/`);
    if (ringed > 0) expect(caption).toContain(`${ringed} ringed`);
    // And the label really counts the squares the grid drew.
    await expect(grid.locator('.cell')).toHaveCount(Number(label.match(/(\d+) cells,/)?.[1]));
    await expect(grid.locator('.cell-on')).toHaveCount(set);
    await expect(grid.locator('.cell-marked')).toHaveCount(ringed);
  });
});

/**
 * §4.1d — the negative claim and its evidence fixture.
 *
 * The claim: reproducing the key correctly is not evidence that any secrecy is
 * left, because this construction raises no failure code for a source that
 * never had enough min-entropy.
 *
 * The fixture is a reachable state in which EVERY CHECK THE CONSTRUCTION
 * PERFORMS reports success and the key has already been recovered from public
 * data. The three assertions below are the three §4.1d requires, and each has
 * been watched to fail: deleting the negative-claim block fails the third,
 * breaking any construction check fails the second, and a fixture that cannot
 * reach the state fails the first.
 */
test.describe('§4.1d the negative claim', () => {
  test('reproduced AND recovered, with every construction check green', async ({ page }) => {
    await boot(page);
    await openTab(page, 'What the Helper Costs', '#panel-cost');

    // 1. REACH THE FIXTURE, through the UI.
    await page.locator('#weak-fixture').click();
    await expect(page.locator('[data-verdict="weak-source-headline"]')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#cost-out')).toHaveAttribute('data-fixture', 'weak-source');

    // The state really is the weak one: the bound guarantees nothing.
    const residual = parseFloat(await readClaim(page, 'residual'));
    expect(residual).toBeLessThan(0);

    // 2. EVERYTHING THE CONSTRUCTION CHECKS IS GREEN, asserted against the
    //    RENDERED verdicts rather than a flag this test set. Every panel that
    //    performs a check is visited in this same state.
    await expectVerdict(page, 'weak-source-headline', {
      result: 'alarm',
      contains: 'The device succeeded. The attacker did too.',
    });
    await expectVerdict(page, 'attack', { result: 'alarm', contains: 'THE ATTACKER HAS THE KEY' });

    await openTab(page, 'Enrol & Reproduce', '#panel-enroll');
    await expectVerdict(page, 'reproduce', { result: 'pass', contains: 'KEY REPRODUCED', check: 'construction' });
    for (let i = 0; i < 6; i++) await page.locator('#step-next').click();
    await expectVerdict(page, 'codeword-match', { result: 'pass', contains: 'Same codeword', check: 'construction' });
    await expectVerdict(page, 'word-match', { result: 'pass', contains: 'Identical', check: 'construction' });
    await expectVerdict(page, 'key-match', { result: 'pass', contains: 'THE SAME KEY', check: 'construction' });
    await page.locator('#panel-enroll details.disclose > summary').first().click();
    await expectVerdict(page, 'syndrome-equivalence', { result: 'pass', contains: 'Identical', check: 'construction' });

    // Swept, not sampled: not one construction check on the page dissents.
    const constructionResults = await page
      .locator('#app [data-check="construction"]')
      .evaluateAll((nodes) =>
        nodes
          .filter((n) => (n as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true }))
          .map((n) => `${n.getAttribute('data-verdict')}=${n.getAttribute('data-result')}`),
      );
    expect(constructionResults.length).toBeGreaterThan(4);
    expect(constructionResults.filter((r) => !r.endsWith('=pass'))).toEqual([]);

    // 3. THE LIMITATION IS ON SCREEN IN THAT STATE — visible, not in the README
    //    and not behind a disclosure the reader has to open.
    await openTab(page, 'What the Helper Costs', '#panel-cost');
    const claimBlock = page.locator('[data-negative-claim="weak-source-invisible"]');
    await expect(claimBlock).toBeVisible();
    await expect(claimBlock).not.toHaveAttribute('hidden', /.*/);
    expect(await claimBlock.evaluate((el) => el.closest('details') === null)).toBe(true);
    await expect(claimBlock).toContainText(
      'Reproducing the key correctly is not evidence that any secrecy is left',
    );
    await expect(claimBlock).toContainText(
      'This construction raises no failure code for a source that never had enough min-entropy',
    );

    // The absence of a code IS the exhibit, so the table says so in the same
    // state rather than leaving the reader to notice nothing is there.
    expect(await readClaim(page, 'weak-source-code')).toBe('NO_CODE_FOR_WEAK_SOURCE');
    await expect(claimBlock.locator('.row-absent')).toContainText('there is none');
  });
});

/**
 * The experience itself, asserted.
 *
 * Correctness tests cannot see the defect these cover. Before the guided path
 * existed, every claim in this file passed while the most important control in
 * the lab rendered its result 1003px below itself in a 900px viewport with the
 * scroll position unchanged — a visitor could press it and watch nothing
 * happen, and no test in the suite objected. So the reachability of a result is
 * now a claim like any other, with the measurements recorded in the assertions.
 */
test.describe('the experience', () => {
  test('the first action is reachable without hunting for it', async ({ page }) => {
    // Desktop: visible with no scrolling at all.
    await page.setViewportSize({ width: 1280, height: 900 });
    await bootGuided(page);
    expect(await inViewport(page, '#guided-read')).toBe(true);

    // Phone: within 1.25 viewports. The fleet-standard hero is ~400px here and
    // the simulated-source banner is not optional, so this is the budget that
    // remains once those are paid for.
    await page.setViewportSize({ width: 390, height: 844 });
    await bootGuided(page);
    const box = await page.locator('#guided-read').boundingBox();
    expect(box, 'the first action is not on the page at all').toBeTruthy();
    expect(box!.y / 844).toBeLessThan(1.25);
  });

  test('guided mode never offers more than one primary action at a time', async ({ page }) => {
    await bootGuided(page);
    const seen: number[] = [];
    await walkGuided(page, async (scene) => {
      // As a visitor first meets each scene: exactly one thing to press.
      // The Back control on the pipeline scene is a ghost button, not a primary,
      // so it does not compete for attention with the step that moves forward.
      const primaries = await page.locator('#guided .btn-primary').count();
      seen.push(primaries);
      expect(primaries, `scene ${scene} offers ${primaries} primary buttons`).toBe(1);
    });
    expect(seen).toEqual([1, 1, 1, 1, 1]);
  });

  test('every guided action leaves its result in the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await bootGuided(page);

    const checkpoints: { after: string; run: () => Promise<void> }[] = [
      { after: 'read the device twice', run: async () => { await page.locator('#guided-read').click(); await expect(page.locator('[data-verdict="guided-drift"]')).toBeVisible(); } },
      { after: 'hash both readings', run: async () => { await page.locator('#guided-hash').click(); await expect(page.locator('[data-verdict="guided-hash"]')).toBeVisible(); } },
      { after: 'run the pipeline', run: async () => { for (let i = 0; i < 6; i++) await page.locator('#guided-step-next').click(); await expect(page.locator('[data-verdict="guided-reproduce"]')).toBeVisible(); } },
      { after: 'push past the radius', run: async () => { await page.locator('#guided-break').click(); await expect(page.locator('[data-verdict="guided-broken"]')).toBeVisible({ timeout: 60_000 }); } },
      { after: 'break secrecy', run: async () => { await page.locator('#guided-weak').click(); await expect(page.locator('[data-verdict="guided-verdict"]')).toBeVisible({ timeout: 90_000 }); } },
    ];

    for (const [i, cp] of checkpoints.entries()) {
      await cp.run();
      expect(
        await inViewport(page, '#guided [data-result-anchor]'),
        `the result of "${cp.after}" is off screen`,
      ).toBe(true);
      if (i < checkpoints.length - 1) await page.locator('#scene-next').click();
    }
  });

  test('the punchline lands in five primary actions, and says both things at once', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await bootGuided(page);
    const actions = await walkGuided(page);
    expect(actions, 'the guided path should reach its result in five primary actions').toBe(5);

    await expectVerdict(page, 'guided-verdict', {
      result: 'alarm',
      contains: 'The device succeeded. The attacker did too.',
    });
    // Both halves, rendered as separate verdicts in the same state: the
    // construction's own check passes and the attacker's does not.
    await expectVerdict(page, 'guided-device', { result: 'pass', contains: 'key reproduced', check: 'construction' });
    await expectVerdict(page, 'guided-attacker', { result: 'alarm', contains: 'same key, from public data' });
    expect(await inViewport(page, '[data-verdict="guided-verdict"]')).toBe(true);

    // And the arithmetic behind it is on the same screen, not asserted at it.
    const m = parseFloat(await readClaim(page, 'guided-m'));
    const loss = parseFloat(await readClaim(page, 'guided-loss'));
    const residual = parseFloat(await readClaim(page, 'guided-residual'));
    expect(Math.abs(residual - (m - loss))).toBeLessThan(0.11);
    expect(residual).toBeLessThan(0);
  });

  test('colour tracks system integrity, not the raw return value', async ({ page }) => {
    // Template §1: a forged-but-accepted result reads as ALARM, not as green
    // success. Two keys matching is the whole point when the DEVICE reproduces
    // its own key, and it is the breach when the second key belongs to an
    // attacker holding nothing but public data. The same comparison component
    // renders both, so this asserts it does not paint them the same way.
    await page.setViewportSize({ width: 1280, height: 900 });
    await bootGuided(page);
    await walkGuided(page);

    // Each scene replaces the card, so the two comparisons are never on screen
    // together; the rail is how a visitor gets back to an earlier one.
    const stolenKeys = await readVerdict(page, 'guided-steal');
    await page.locator('#rail-3').click();
    await expect(page.locator('[data-scene="3"]')).toBeVisible();
    const deviceKeys = await readVerdict(page, 'guided-key');
    expect(deviceKeys.text, 'the device did reproduce its key').toContain('THE SAME KEY');
    expect(stolenKeys.text, 'the attacker did get the same key').toContain('THE SAME KEY');

    // Identical words, opposite meaning, and therefore opposite tone.
    expect(deviceKeys.result).toBe('pass');
    expect(stolenKeys.result).toBe('alarm');
    await expect(page.locator('[data-verdict="guided-key"]')).toHaveClass(/verdict-pass\b/);
    await page.locator('#rail-5').click();
    await expect(page.locator('[data-verdict="guided-steal"]')).toHaveClass(/verdict-alarm\b/);
    await expect(page.locator('[data-verdict="guided-steal"]')).not.toHaveClass(/verdict-pass\b/);

    // And a breach comparison is not a check the construction performs, so it
    // must not be swept up by the negative claim's "everything green" pass.
    expect(stolenKeys.check).toBe('measurement');
    expect(deviceKeys.check).toBe('construction');
  });

  test('the scenario bar names the shared state, and Reset restores it', async ({ page }) => {
    await bootGuided(page);
    expect(await readClaim(page, 'scenario-name')).toBe('Healthy source');
    await expect(page.locator('[data-claim="scenario-flag"]')).toHaveCount(0);
    const healthyResidual = parseFloat(await readClaim(page, 'scenario-residual'));
    expect(healthyResidual).toBeGreaterThan(0);

    await walkGuided(page);

    // The weak scenario is named, flagged, and its residual is on the bar --
    // so a visitor who now wanders into another exhibit is told what device
    // they are reading. That state used to follow them silently.
    expect(await readClaim(page, 'scenario-name')).toBe('Weak source');
    await expect(page.locator('[data-claim="scenario-flag"]')).toBeVisible();
    expect(parseFloat(await readClaim(page, 'scenario-residual'))).toBeLessThan(0);

    // It follows them into Explore, still named.
    await page.locator('#mode-explore').click();
    await openTab(page, 'What the Helper Costs', '#panel-cost');
    expect(await readClaim(page, 'scenario-name')).toBe('Weak source');
    expect(parseFloat(await readClaim(page, 'residual'))).toBeLessThan(0);

    await page.locator('#scenario-reset').click();
    await expect(page.locator('[data-claim="scenario-name"]')).toHaveText('Healthy source');
    await expect(page.locator('[data-claim="scenario-flag"]')).toHaveCount(0);
    expect(parseFloat(await readClaim(page, 'scenario-residual'))).toBeGreaterThan(0);
    expect(parseFloat(await readClaim(page, 'residual'))).toBeGreaterThan(0);
  });

  test('the weak-source control says what it does, not what the test suite calls it', async ({ page }) => {
    await boot(page);
    await openTab(page, 'What the Helper Costs', '#panel-cost');
    const label = (await page.locator('#weak-fixture').textContent()) ?? '';
    expect(label).toBe('Break secrecy without breaking reproduction');
    expect(label.toLowerCase()).not.toContain('fixture');

    // And its result arrives in the viewport rather than a thousand pixels down.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#weak-fixture').click();
    await expect(page.locator('[data-verdict="weak-source-headline"]')).toBeVisible({ timeout: 90_000 });
    expect(
      await inViewport(page, '[data-verdict="weak-source-headline"]'),
      'the weak-source result is off screen after its own button was pressed',
    ).toBe(true);
  });
});
