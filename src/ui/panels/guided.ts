/**
 * The guided path: five scenes, one primary action each.
 *
 * WHY THIS EXISTS. The lab's six panels are peers, equally weighted, and the
 * material is not a set of peers — it is an argument with an order. Measured on
 * the version before this: at 390px the first thing a visitor could DO sat 2.23
 * viewports down the page, and the strongest result in the lab rendered 1003px
 * below the button that produced it inside a 900px viewport, with the scroll
 * position unchanged. A visitor could press the marquee control and see nothing
 * happen.
 *
 * So the default experience is a single directed line with one button on screen
 * at a time, and every scene puts its own result directly beneath its own
 * action. The six panels survive untouched as Explore mode.
 *
 * Each scene has the same shape, which is the point:
 *
 *   a question  ->  one action  ->  the real result  ->  one line of meaning
 *                                                        (+ an optional Why?)
 *
 * Nothing here recomputes anything. Every scene drives the same store the
 * panels drive and renders the same components, so the guided path cannot drift
 * away from what the lab actually does.
 */

import { bitsToHex, differingPositions, toHex, xor } from '../../crypto/bits';
import { sha256OfWord } from '../../crypto/kdf';
import { minEntropyBits, residualBoundBits, sketchLossBits } from '../../model/stats';
import { bitGrid, comparison } from '../bitgrid';
import { button, callout, claim, clear, disclosure, h, short, verdict } from '../dom';
import { SCENARIOS } from '../scenario';
import { type Store } from '../state';

export const SCENE_COUNT = 5;

interface SceneState {
  /** How far along the path the visitor has got. */
  reached: number;
  /** Which scene is on screen. */
  current: number;
  /** Per-scene "the action has been run" flags, so a scene can show its result. */
  done: Set<number>;
  /** Scene 3's own step, 0..6. */
  pipelineStep: number;
  digests: { a: string; b: string } | null;
}

const scene: SceneState = { reached: 1, current: 1, done: new Set(), pipelineStep: 0, digests: null };

export function resetGuided(): void {
  scene.reached = 1;
  scene.current = 1;
  scene.done.clear();
  scene.pipelineStep = 0;
  scene.digests = null;
}

const TITLES = [
  'Same device, different reading',
  'So hash it?',
  'The key comes back',
  'Reliability has a boundary',
  'Correct is not secret',
] as const;

export function renderGuided(root: HTMLElement, store: Store): void {
  clear(root);
  root.append(rail(root, store), sceneCard(root, store));
}

/** The five-step progress rail. A visitor can go back to anything reached. */
function rail(root: HTMLElement, store: Store): HTMLElement {
  return h(
    'ol',
    { class: 'rail', role: 'list', 'aria-label': 'Guided path' },
    ...TITLES.map((title, i) => {
      const n = i + 1;
      const state = scene.current === n ? 'current' : scene.reached >= n ? 'reached' : 'locked';
      return h(
        'li',
        { class: `rail-step rail-${state}`, role: 'listitem' },
        h(
          'button',
          {
            type: 'button',
            class: 'rail-btn',
            id: `rail-${n}`,
            'aria-current': scene.current === n ? 'step' : undefined,
            disabled: scene.reached < n,
            onclick: () => {
              scene.current = n;
              renderGuided(root, store);
            },
          },
          h('span', { class: 'rail-num', 'aria-hidden': 'true' }, String(n)),
          h('span', { class: 'rail-title' }, title),
        ),
      );
    }),
  );
}

/**
 * Hand the visitor's attention to a result.
 *
 * Focus rather than a bare scroll: moving focus scrolls the element into view
 * AND tells a screen reader where the answer is, which a scroll alone does not.
 * The target carries tabindex="-1" so it is programmatically focusable without
 * entering the tab order.
 */
function handOff(root: HTMLElement): void {
  // Synchronous on purpose. Every render in this lab rebuilds its DOM
  // synchronously -- `renderGuided` before this is called, and the store's
  // `notify()` before the promise it was awaited on resolves -- so the target
  // already exists and waiting a frame only makes the moment the page moves
  // depend on timing nobody controls. Focus rather than a bare scroll, because
  // focus also tells a screen reader where the answer went.
  const target = root.querySelector<HTMLElement>('[data-result-anchor]');
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'center', behavior: 'auto' });
}

function advance(root: HTMLElement, store: Store, n: number): void {
  scene.done.add(n);
  scene.reached = Math.max(scene.reached, n);
  renderGuided(root, store);
  handOff(root);
}

function sceneCard(root: HTMLElement, store: Store): HTMLElement {
  const n = scene.current;
  const card = h('section', { class: 'scene', 'data-scene': String(n), 'aria-labelledby': `scene-title-${n}` });
  card.append(
    h('p', { class: 'scene-count' }, `Step ${n} of ${SCENE_COUNT}`),
    h('h2', { class: 'scene-title', id: `scene-title-${n}` }, TITLES[n - 1]),
  );
  const body = h('div', { class: 'scene-body' });
  card.append(body);

  switch (n) {
    case 1:
      sceneOne(body, root, store);
      break;
    case 2:
      sceneTwo(body, root, store);
      break;
    case 3:
      sceneThree(body, root, store);
      break;
    case 4:
      sceneFour(body, root, store);
      break;
    default:
      sceneFive(body, root, store);
      break;
  }

  if (scene.done.has(n) && n < SCENE_COUNT) {
    card.append(
      h(
        'div',
        { class: 'scene-next' },
        button(`Next: ${TITLES[n]} ›`, () => {
          scene.current = n + 1;
          scene.reached = Math.max(scene.reached, n + 1);
          renderGuided(root, store);
        }, { variant: 'primary', id: 'scene-next' }),
      ),
    );
  }
  return card;
}

/** The one-line interpretation every scene ends on. */
function meaning(text: string): HTMLElement {
  return h('p', { class: 'scene-meaning' }, text);
}

/** The result region: focus target, live region, and where the answer lands. */
function resultRegion(): HTMLElement {
  return h('div', {
    class: 'scene-result',
    'data-result-anchor': '',
    tabindex: '-1',
    role: 'status',
    'aria-live': 'polite',
  });
}

// ── 1 ────────────────────────────────────────────────────────────────────────
function sceneOne(body: HTMLElement, root: HTMLElement, store: Store): void {
  const s = store.state;
  body.append(
    h('p', { class: 'scene-q' }, 'Can a key come from something that reads differently every time?'),
    h(
      'div',
      { class: 'scene-action' },
      button('Read the device twice', () => {
        store.sampleAgain();
        advance(root, store, 1);
      }, { variant: 'primary', id: 'guided-read' }),
    ),
  );
  const out = resultRegion();
  body.append(out);
  if (!scene.done.has(1) || s.sampleReadings.length < 2) {
    out.append(h('p', { class: 'scene-hint' }, 'Two power-ups of the same modelled device.'));
    return;
  }
  const [first, second] = s.sampleReadings;
  const diff = differingPositions(first, second);
  out.append(
    h(
      'div',
      { class: 'grid-pair' },
      bitGrid(first, { title: 'Reading 1', tone: 'secret', id: 'g1-reading-1' }),
      bitGrid(second, {
        title: 'Reading 2',
        tone: 'secret',
        marks: diff,
        markLabel: 'differ from reading 1',
        id: 'g1-reading-2',
      }),
    ),
    verdict('guided-drift', 'warn', `${diff.length} of ${first.length} cells changed`, {
      detail: 'same device, two power-ups',
    }),
    meaning('Close enough for error correction. Nowhere near close enough for a hash.'),
  );
}

// ── 2 ────────────────────────────────────────────────────────────────────────
function sceneTwo(body: HTMLElement, root: HTMLElement, store: Store): void {
  const s = store.state;
  body.append(
    h('p', { class: 'scene-q' }, 'A hash turns anything into a fixed-size secret. Why not just hash the reading?'),
    h(
      'div',
      { class: 'scene-action' },
      button('Hash both readings', () => {
        void (async () => {
          const [a, b] = s.sampleReadings;
          if (!a || !b) return;
          const [da, db] = await Promise.all([sha256OfWord(a), sha256OfWord(b)]);
          scene.digests = { a: toHex(da), b: toHex(db) };
          advance(root, store, 2);
        })();
      }, { variant: 'primary', id: 'guided-hash' }),
    ),
  );
  const out = resultRegion();
  body.append(out);
  if (!scene.done.has(2) || !scene.digests) {
    out.append(h('p', { class: 'scene-hint' }, 'Real SHA-256, over the two readings above.'));
    return;
  }
  out.append(
    comparison({
      id: 'guided-hash',
      leftLabel: 'SHA-256 of reading 1',
      leftValue: short(scene.digests.a),
      leftFull: scene.digests.a,
      rightLabel: 'SHA-256 of reading 2',
      rightValue: short(scene.digests.b),
      rightFull: scene.digests.b,
      passText: 'Identical — the two readings happened to match',
      failText: 'Two completely different keys',
    }),
    meaning('A good hash amplifies one changed bit into a wholly different output. That is the problem.'),
  );
}

// ── 3 ────────────────────────────────────────────────────────────────────────
const PIPELINE_STEPS = 6;

/**
 * Scene 3 is the headline mechanism, on ONE stage that changes rather than a
 * column of cards that grows. The lanes stay put — secret on the left of the
 * caption, public and derived named on the chip — so a visitor watches the same
 * 127 cells move through the construction instead of comparing seven pictures.
 */
function sceneThree(body: HTMLElement, root: HTMLElement, store: Store): void {
  const s = store.state;
  body.append(
    h('p', { class: 'scene-q' }, 'Publish one thing, and the same key comes back from a different reading. Watch it happen.'),
  );

  const enrollment = s.enrollment;
  const reproduction = s.reproduction;
  if (!enrollment || !reproduction) {
    body.append(h('p', { class: 'scene-hint' }, 'Enrolling…'));
    return;
  }

  const w = enrollment.secret.sourceWord;
  const helper = enrollment.pub.helper;
  const wPrime = reproduction.reading;
  const flips = differingPositions(w, wPrime);
  const offset = xor(helper, wPrime);
  const attempt = reproduction.attempt;
  const decoded = attempt.recoveredWord ? xor(helper, attempt.recoveredWord) : null;

  const step = scene.pipelineStep;
  const stage = h('div', { class: 'stage-single', 'data-claim': 'guided-stage' });

  const frames: { caption: string; op: string; node: () => HTMLElement }[] = [
    {
      caption: 'The device reads itself. This reading is the secret, and it is never stored.',
      op: 'w',
      node: () => bitGrid(w, { title: 'Enrolled reading w', tone: 'secret', id: 'g3-w' }),
    },
    {
      caption: `A codeword is drawn uniformly from all 2^${s.code.k} codewords, and the difference is published. A uniform codeword masks the reading completely.`,
      op: 'h = w XOR c',
      node: () => bitGrid(helper, { title: 'Helper data h — published', tone: 'public', id: 'g3-h' }),
    },
    {
      caption: `Some time later, the same device reads itself again. ${flips.length} cell${flips.length === 1 ? '' : 's'} came up differently, and the device has no way to know which.`,
      op: "w'",
      node: () =>
        bitGrid(wPrime, {
          title: "Later reading w'",
          tone: 'secret',
          marks: flips,
          markLabel: 'differ from the enrolled reading',
          id: 'g3-wprime',
        }),
    },
    {
      caption: 'Subtract the helper data and the reading cancels itself out, leaving the codeword with exactly those cells flipped. The decoder never sees a reading.',
      op: "h XOR w' = c XOR e",
      node: () =>
        bitGrid(offset, {
          title: 'The codeword, damaged',
          tone: 'derived',
          marks: flips,
          markLabel: 'the flipped cells, now errors on a codeword',
          id: 'g3-offset',
        }),
    },
    {
      caption:
        attempt.decodeStatus === 'failure'
          ? `The damage is past what ${s.code.label} can repair. The decoder does not guess — it reports a failure code and stops.`
          : `The decoder located ${attempt.errorPositions.length} error position${attempt.errorPositions.length === 1 ? '' : 's'} from the syndromes alone and flipped them back.`,
      op: 'decode',
      node: () =>
        decoded
          ? bitGrid(decoded, {
              title: 'Repaired codeword',
              tone: 'derived',
              marks: attempt.errorPositions,
              markLabel: 'positions the decoder corrected',
              id: 'g3-decoded',
            })
          : verdict('guided-decode', 'fail', 'Decoding failed', {
              detail: String(attempt.failureCode),
              check: 'construction',
            }),
    },
    {
      caption: 'Subtract the helper data once more and the whole enrolled reading is back — including the cells that came up differently this time.',
      op: 'w = h XOR c',
      node: () =>
        attempt.recoveredWord
          ? bitGrid(attempt.recoveredWord, { title: 'Recovered reading', tone: 'secret', id: 'g3-recovered' })
          : verdict('guided-recover', 'fail', 'No reading to recover', { check: 'construction' }),
    },
    {
      caption: 'HKDF-SHA-256 over the recovered reading. Same input, same key — the property that made the hash useless two steps ago and useful now.',
      op: 'key = HKDF(w)',
      node: () =>
        comparison({
          id: 'guided-key',
          leftLabel: 'Key derived now',
          leftValue: attempt.recoveredKey ? toHex(attempt.recoveredKey) : '—',
          rightLabel: 'Key derived at enrolment',
          rightValue: toHex(enrollment.secret.key),
          passText: 'THE SAME KEY — 32 bytes, byte for byte',
          failText: 'A DIFFERENT KEY',
        }),
    },
  ];

  const frame = frames[step];
  stage.append(
    h(
      'div',
      { class: 'stage-head' },
      h('span', { class: 'stage-op', 'data-claim': 'guided-op' }, frame.op),
      h('span', { class: 'stage-progress', 'data-claim': 'guided-pipeline-step' }, `${step} / ${PIPELINE_STEPS}`),
    ),
    h('p', { class: 'stage-caption' }, frame.caption),
    frame.node(),
  );

  // Set `disabled` on the element itself. Querying for it afterwards finds
  // nothing: the card is built before it is appended to the guided root.
  const backBtn = button('‹ Back', () => {
    if (scene.pipelineStep > 0) {
      scene.pipelineStep--;
      renderGuided(root, store);
    }
  }, { id: 'guided-step-back' });
  backBtn.disabled = step === 0;

  body.append(
    h(
      'div',
      { class: 'scene-action' },
      backBtn,
      button(step >= PIPELINE_STEPS ? 'Done' : 'Next step ›', () => {
        if (scene.pipelineStep < PIPELINE_STEPS) {
          scene.pipelineStep++;
          renderGuided(root, store);
          if (scene.pipelineStep >= PIPELINE_STEPS) advance(root, store, 3);
          return;
        }
        advance(root, store, 3);
      }, { variant: 'primary', id: 'guided-step-next' }),
    ),
    stage,
  );

  const out = resultRegion();
  body.append(out);
  if (step >= PIPELINE_STEPS) {
    const outcome = reproduction.verdict.outcome;
    out.append(
      verdict(
        'guided-reproduce',
        outcome === 'reproduced' ? 'pass' : outcome === 'miscorrected' ? 'alarm' : 'fail',
        outcome === 'reproduced'
          ? 'Same key, byte for byte'
          : outcome === 'miscorrected'
            ? 'A wrong key came back — the decoder mis-corrected'
            : 'The key did not come back',
        {
          detail: `${flips.length} flipped cell${flips.length === 1 ? '' : 's'}, radius ${s.code.t}`,
          check: 'construction',
        },
      ),
      meaning('Public helper data turned a reading that is never the same twice into one stable key.'),
    );
  }
}

// ── 4 ────────────────────────────────────────────────────────────────────────
function sceneFour(body: HTMLElement, root: HTMLElement, store: Store): void {
  const s = store.state;
  const noisy = SCENARIOS.find((x) => x.id === 'noisy');
  body.append(
    h('p', { class: 'scene-q' }, 'How much drift can it take before the key stops coming back?'),
    h(
      'div',
      { class: 'scene-action' },
      button('Push the re-read past the correction radius', () => {
        void (async () => {
          if (noisy) await store.applyScenario(noisy);
          advance(root, store, 4);
        })();
      }, { variant: 'primary', id: 'guided-break' }),
    ),
  );
  const out = resultRegion();
  body.append(out);
  if (!scene.done.has(4) || !s.reproduction) {
    out.append(
      h('p', { class: 'scene-hint' }, `This code repairs up to ${s.code.t} flipped cells in ${s.code.n}. The button asks for far more than that.`),
    );
    return;
  }
  const outcome = s.reproduction.verdict.outcome;
  const flips = s.reproduction.flips.reduce((a, b) => a + b, 0);
  out.append(
    verdict(
      'guided-broken',
      outcome === 'reproduced' ? 'pass' : outcome === 'miscorrected' ? 'alarm' : 'fail',
      outcome === 'reproduced'
        ? 'It still came back'
        : outcome === 'miscorrected'
          ? 'A wrong key came back, and nothing reported an error'
          : 'The key did not come back',
      {
        detail:
          outcome === 'decode-failure'
            ? `${flips} cells flipped against a radius of ${s.code.t} · ${s.reproduction.attempt.failureCode}`
            : `${flips} cells flipped against a radius of ${s.code.t}`,
        check: 'construction',
      },
    ),
    meaning(
      outcome === 'miscorrected'
        ? 'Past the radius the decoder can land on a different codeword and report success. The device gets a well-formed key that is simply the wrong one.'
        : 'Error correction fixes drift only inside its operating envelope. Outside it, the decoder refuses rather than guessing.',
    ),
    disclosure(
      'Why the boundary is exactly here, and how often it is crossed',
      h(
        'p',
        {},
        `Reproduction succeeds exactly when at most ${s.code.t} cells flipped, so the failure rate ` +
          `is the tail of a binomial and has no fitted parameter. Explore mode measures it over ` +
          'thousands of full enrol-and-reproduce cycles and lays the measurement over the prediction.',
      ),
    ),
  );
}

// ── 5 ────────────────────────────────────────────────────────────────────────
function sceneFive(body: HTMLElement, root: HTMLElement, store: Store): void {
  const s = store.state;
  const weak = SCENARIOS.find((x) => x.id === 'weak');
  const running = h('p', { class: 'scene-hint', hidden: true, id: 'guided-weak-running' }, 'Enrolling on a weak source and running the attack…');

  body.append(
    h('p', { class: 'scene-q' }, 'The key came back correctly. Does that mean it is still secret?'),
    h(
      'div',
      { class: 'scene-action' },
      button('Break secrecy without breaking reproduction', () => {
        const btn = root.querySelector<HTMLButtonElement>('#guided-weak');
        const note = root.querySelector<HTMLElement>('#guided-weak-running');
        if (btn) btn.disabled = true;
        if (note) note.hidden = false;
        void (async () => {
          if (weak) await store.applyScenario(weak);
          advance(root, store, 5);
        })();
      }, { variant: 'primary', id: 'guided-weak' }),
    ),
    running,
  );

  const out = resultRegion();
  body.append(out);
  if (!scene.done.has(5) || !s.attack) {
    out.append(
      h('p', { class: 'scene-hint' }, 'Same construction, same code, same key derivation. Only the device changes.'),
    );
    return;
  }

  const reproduced = s.reproduction?.verdict.outcome === 'reproduced';
  const m = minEntropyBits(s.device.pMax);
  const loss = sketchLossBits(s.code.n, s.code.k);
  const residual = residualBoundBits(m, loss);
  const both = reproduced && s.attack.keyMatched;

  // The decisive sentence FIRST, before any evidence. It is the thing the whole
  // lab exists to say, and it used to render a thousand pixels below its button.
  out.append(
    verdict(
      'guided-verdict',
      both ? 'alarm' : 'warn',
      both ? 'The device succeeded. The attacker did too.' : 'The scenario did not reach both outcomes at once',
      { detail: both ? 'the key reproduced correctly, and the source had too little entropy to protect it' : undefined },
    ),
  );

  out.append(
    h(
      'div',
      { class: 'claim-row' },
      claim('guided-m', 'Source min-entropy', `${m.toFixed(1)} bits`, 'from the stated model'),
      claim('guided-loss', 'Cost of publishing the helper', `${loss} bits`, 'n − k, fixed by the code'),
      claim('guided-residual', 'What the bound still guarantees', `${residual.toFixed(1)} bits`, residual <= 0 ? 'nothing' : 'a real guarantee'),
      claim(
        'guided-watched',
        'Enrolments the attacker watched',
        String(s.attack.enrolmentsWatched),
        s.attack.enrolmentsWatched === 1 ? 'the first one was enough' : 'one guess wins about four times in five',
      ),
    ),
    h(
      'div',
      { class: 'two-up' },
      verdict('guided-device', reproduced ? 'pass' : 'fail', reproduced ? 'Device: key reproduced' : 'Device: reproduction failed', {
        detail: 'every check the construction performs passed',
        check: 'construction',
      }),
      verdict('guided-attacker', s.attack.keyMatched ? 'alarm' : 'pass', s.attack.keyMatched ? 'Attacker: same key, from public data' : 'Attacker: did not get the key', {
        detail: `guess was ${s.attack.distanceToTruth} cells off, radius ${s.code.t}`,
      }),
    ),
    comparison({
      id: 'guided-steal',
      leftLabel: 'Key the device derived',
      leftValue: s.enrollment ? short(toHex(s.enrollment.secret.key)) : '—',
      leftFull: s.enrollment ? toHex(s.enrollment.secret.key) : '—',
      rightLabel: 'Key the attacker derived',
      rightValue: s.attack.result.candidateKey ? short(toHex(s.attack.result.candidateKey)) : 'none',
      rightFull: s.attack.result.candidateKey ? toHex(s.attack.result.candidateKey) : 'none',
      passText: 'THE SAME KEY — recovered from published data alone',
      failText: 'Different keys — the attacker missed',
      equalityMeans: 'breach',
    }),
    callout(
      'danger',
      h('strong', {}, 'Nothing failed. '),
      'The construction raises no code for this. It corrects errors and derives a key, and how ' +
        'much entropy the source had is a property of the device that no step in the pipeline ' +
        'measures. Reproducing the key correctly is not evidence that any secrecy is left.',
    ),
    meaning('That is the whole lesson: a working key-recovery pipeline can be perfectly correct and completely insecure.'),
    disclosure(
      'Show the arithmetic',
      h(
        'p',
        {},
        `The source has ${m.toFixed(1)} bits of min-entropy. Publishing the helper costs at most ` +
          `${loss} — that part is a theorem, not an estimate, and it holds for biased sources ` +
          `without modification. ${m.toFixed(1)} minus ${loss} is ${residual.toFixed(1)}, so the bound ` +
          'guarantees nothing at all here. Bias did not make the helper leak more; it left less for ' +
          'the helper to spend.',
      ),
      h(
        'p',
        {},
        'Helper data — public, and all the attacker needed: ',
        h('code', {}, s.enrollment ? short(bitsToHex(s.enrollment.pub.helper)) : '—'),
      ),
    ),
    h(
      'div',
      { class: 'scene-next' },
      button('Explore the full lab ›', () => {
        document.querySelector<HTMLButtonElement>('#mode-explore')?.click();
      }, { id: 'guided-to-explore' }),
    ),
  );
}
