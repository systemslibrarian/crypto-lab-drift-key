/**
 * Act 7: enrolling one source twice — what the XOR of two helpers shows, and
 * what it does not.
 *
 * The exhibit is deliberately narrow, because the interesting claim is a
 * negative one and negative claims are easy to overstate. Two helpers for the
 * same reading XOR to a codeword; two helpers for a noisy re-read XOR to a
 * codeword plus the noise, so decoding names WHICH CELLS FLIPPED. Neither tells
 * you anything about what those cells hold.
 *
 * The counter that says so is counted, not asserted: every candidate source
 * word is enumerated and tested. The broken variant beside it — a codeword
 * drawn from half the code — exists so that counter can be seen to MOVE.
 */

import { allCodewords, codeById, SMALL_CODE_ID } from '../../crypto/bch';
import { bitsToHex, toBitString } from '../../crypto/bits';
import {
  enumerateCandidates,
  reuseSyndromeView,
  subcodeCodewords,
} from '../../crypto/reuse';
import { enroll, randomMessageBits, randomSalt } from '../../crypto/sketch';
import { makePrng, randomSeed } from '../../model/prng';
import { makeDevice, powerUpReading } from '../../model/source';
import { bitGrid } from '../bitgrid';
import {
  button,
  callout,
  claim,
  clear,
  disclosure,
  field,
  h,
  liveRegion,
  panelIntro,
  short,
  verdict,
} from '../dom';
import { type Store } from '../state';

type Mode = 'exact' | 'noisy';
type Construction = 'correct' | 'broken';

let mode: Mode = 'exact';
let construction: Construction = 'correct';
let seed = 0x0d71f7;

export function renderReusePanel(root: HTMLElement, store: Store): void {
  clear(root);

  root.append(
    panelIntro(
      'Enrolling the same device twice',
      'A device is enrolled at the factory, and again after a firmware update, and again when it ' +
        'joins a new fleet. Each enrolment publishes its own helper data. If the same reading is ' +
        'behind all of them, does publishing several help an attacker?',
      'For this construction, and for the XOR of two helpers specifically, the answer is no — and ' +
        'the counter below counts it rather than claiming it. The reason is short: the first ' +
        'helper already pinned down the reading’s coset, which is every bit the syndrome can ' +
        'carry, so the second has nothing left to add.',
    ),
    h(
      'div',
      { class: 'control-row' },
      h(
        'div',
        { class: 'seg', role: 'group', 'aria-label': 'Second reading' },
        segButton('The identical reading', mode === 'exact', () => {
          mode = 'exact';
          renderReusePanel(root, store);
        }, 'mode-exact'),
        segButton('A noisy re-read', mode === 'noisy', () => {
          mode = 'noisy';
          renderReusePanel(root, store);
        }, 'mode-noisy'),
      ),
      h(
        'div',
        { class: 'seg', role: 'group', 'aria-label': 'Construction' },
        segButton('Codeword from the whole code', construction === 'correct', () => {
          construction = 'correct';
          renderReusePanel(root, store);
        }, 'con-correct'),
        segButton('Codeword from half the code (broken)', construction === 'broken', () => {
          construction = 'broken';
          renderReusePanel(root, store);
        }, 'con-broken'),
      ),
      button('New source word', () => {
        seed = randomSeed();
        renderReusePanel(root, store);
      }, { id: 'reuse-reseed' }),
    ),
    liveRegion('reuse-out'),
  );

  const out = root.querySelector<HTMLElement>('#reuse-out');
  if (!out) return;
  void renderBody(out, store);
}

function segButton(label: string, pressed: boolean, onClick: () => void, id: string): HTMLElement {
  return h(
    'button',
    {
      type: 'button',
      class: 'seg-btn',
      id,
      'aria-pressed': pressed ? 'true' : 'false',
      onclick: onClick,
    },
    label,
  );
}

async function renderBody(out: HTMLElement, store: Store): Promise<void> {
  // The exhaustive count runs on the smallest code so all 2^k codewords can be
  // listed. BCH(127, 64) has 2^64 of them, which is not a browser operation and
  // is not an argument either -- the syndrome view below covers the code the
  // rest of the lab is using.
  const code = codeById(SMALL_CODE_ID);
  const rng = makePrng(seed);
  const device = makeDevice(code.n, seed, 0.5);
  const w = powerUpReading(device, rng);
  const wSecond = mode === 'exact' ? w : flipOne(w, [2, 11], rng.int(2));

  const dim = construction === 'broken' ? 4 : code.k;
  const codewords = construction === 'broken' ? subcodeCodewords(code, dim) : allCodewords(code);

  const messageFor = (): Uint8Array => {
    if (construction === 'correct') return randomMessageBits(code.k);
    const msg = new Uint8Array(code.k);
    const bits = randomMessageBits(dim);
    msg.set(bits.subarray(0, dim), 0);
    return msg;
  };

  const first = await enroll(code, w, messageFor(), randomSalt());
  const second = await enroll(code, wSecond, messageFor(), randomSalt());

  const view = reuseSyndromeView(code, first.pub.helper, second.pub.helper);
  const count = enumerateCandidates(code, first.pub.helper, second.pub.helper, codewords);
  const bigView = bigCodeView(store);

  out.append(
    h('h3', {}, `Two helpers, ${code.label}`),
    h(
      'div',
      { class: 'grid-pair' },
      bitGrid(first.pub.helper, { title: 'Helper 1 — published', tone: 'public', id: 'reuse-h1' }),
      bitGrid(second.pub.helper, { title: 'Helper 2 — published', tone: 'public', id: 'reuse-h2' }),
    ),
    bitGrid(view.xorWord, {
      title: 'Helper 1 XOR Helper 2',
      tone: 'derived',
      marks: view.exposedFlipPositions,
      markLabel: 'cells the decoder says flipped between the two readings',
      id: 'reuse-xor',
    }),
    verdict(
      'reuse-xor',
      view.xorIsCodeword ? 'pass' : 'info',
      view.xorIsCodeword
        ? 'The XOR is a codeword — the reading cancelled out completely'
        : `The XOR is a codeword plus noise — the decoder names ${view.exposedFlipPositions.length} flipped cell${view.exposedFlipPositions.length === 1 ? '' : 's'}`,
      {
        detail: view.xorIsCodeword
          ? 'h1 XOR h2 = (w XOR c1) XOR (w XOR c2) = c1 XOR c2'
          : "h1 XOR h2 = c1 XOR c2 XOR e, and decoding returns e",
        check: 'construction',
      },
    ),
    h(
      'div',
      { class: 'claim-row' },
      claim('reuse-syn1', 'syn(h1)', toBitString(view.syndrome1)),
      claim('reuse-syn2', 'syn(h2)', toBitString(view.syndrome2)),
      claim(
        'reuse-exposed',
        'Cells exposed as flipped',
        String(view.exposedFlipPositions.length),
        'a fact about the noise',
      ),
    ),
    h('h3', {}, 'How much of the reading did the second helper give away?'),
    h(
      'p',
      {},
      `Counted rather than argued: every one of the ${count.codewordsConsidered} codewords is ` +
        'walked to build the set of readings consistent with the first helper, and each of those ' +
        'is tested against every reading consistent with the second, keeping the ones that could ' +
        'be a within-radius re-read of each other.',
    ),
    h(
      'div',
      { class: 'claim-row' },
      claim('candidates-before', 'Candidate readings after helper 1', String(count.candidatesFromFirst), `of 2^${code.n}`),
      claim('candidates-after', 'Still standing after helper 2', String(count.candidatesAfterSecond), 'enumerated'),
      claim(
        'bits-learned',
        'Bits of the reading the second helper added',
        Number.isNaN(count.bitsLearnedFromSecond) ? '—' : count.bitsLearnedFromSecond.toFixed(0),
        'log2 of the ratio',
      ),
    ),
    verdict(
      'reuse-bits-learned',
      !count.consistent ? 'warn' : count.bitsLearnedFromSecond === 0 ? 'pass' : 'alarm',
      !count.consistent
        ? 'These two helpers are not consistent with a within-radius re-read'
        : count.bitsLearnedFromSecond === 0
          ? 'The second helper added nothing about the reading — 0 bits'
          : `The second helper narrowed the reading by ${count.bitsLearnedFromSecond.toFixed(0)} bits`,
      {
        detail: !count.consistent
          ? 'the re-read drifted past the radius, which is a fact about the noise'
          : `${count.candidatesFromFirst} candidates before, ${count.candidatesAfterSecond} after`,
        check: 'construction',
      },
    ),
  );

  if (construction === 'broken') {
    out.append(
      verdict(
        'broken-construction',
        'alarm',
        `The FIRST helper cost ${count.bitsLostToFirst.toFixed(0)} bits, not the ${code.n - code.k} the construction promises`,
        {
          detail: `the codeword was drawn from a subcode of dimension ${dim}, so only ${count.candidatesFromFirst} readings remain`,
        },
      ),
      callout(
        'danger',
        h('strong', {}, 'Nothing went wrong that the device could notice. '),
        'The subcode is still inside the code, so decoding still works and the key still ' +
          'reproduces. The only thing that changed is that an attacker has fewer candidates to ' +
          'try — and the n − k bound does not apply any more, because its hypothesis was that the ' +
          'codeword is uniform over the WHOLE code. "Uniformly random codeword" is not decoration ' +
          'in that sentence.',
      ),
    );
  }

  out.append(
    h('h3', {}, `The same question on ${store.state.code.label}`),
    bigView,
    disclosure(
      'What this does not show: reusable fuzzy extractors',
      h(
        'p',
        {},
        'Boyen (CCS 2004) showed that ordinary fuzzy-extractor security can fail under repeated ' +
          'enrolment in models stronger than the one this page is in — including an attacker who ' +
          'gets to influence the perturbations between readings, rather than merely observing ' +
          'independent noise. That is why reusable fuzzy extractors are a separate definition ' +
          'with separate constructions.',
      ),
      h(
        'p',
        {},
        'None of that is demonstrated here, and the XOR above is not evidence for or against it. ' +
          'What is shown is one specific thing: for independent noise and independent uniform ' +
          'codewords, the XOR of two helpers reveals the noise pattern and nothing about the ' +
          'reading. A page that implied otherwise would be claiming a result it has not run.',
      ),
    ),
  );
}

/** The syndrome argument on whichever code the rest of the lab is using. */
function bigCodeView(store: Store): HTMLElement {
  const s = store.state;
  const enrollment = s.enrollment;
  if (!enrollment) return callout('info', 'Enrol on the Enrol & Reproduce panel to see this.');
  const code = s.code;
  return h(
    'div',
    { class: 'sub-block' },
    h(
      'p',
      {},
      `Enumerating 2^${code.k} codewords is not something a browser does, so the same conclusion ` +
        'is reached the other way. The readings consistent with a helper are exactly the words ' +
        `sharing its syndrome — 2^${code.k} of them — and two helpers for the same reading have the ` +
        'same syndrome, so they describe the same set. Equal sets, nothing narrowed.',
    ),
    field('syn(h) for the current enrolment', toBitString(reuseSyndromeView(code, enrollment.pub.helper, enrollment.pub.helper).syndrome1), {
      id: 'big-syndrome',
    }),
    field('Candidate readings it leaves', `2^${code.k}`, { id: 'big-candidates' }),
    field('Helper data', short(bitsToHex(enrollment.pub.helper)), { id: 'big-helper' }),
  );
}

function flipOne(word: Uint8Array, positions: number[], extra: number): Uint8Array {
  const out = Uint8Array.from(word);
  for (const p of positions) out[p % word.length] ^= 1;
  if (extra) out[(positions[0] + 5) % word.length] ^= 1;
  return out;
}
