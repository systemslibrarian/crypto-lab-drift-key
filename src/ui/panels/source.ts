/**
 * Act 1 and Act 2: the reading is never the same twice, and hashing it does not
 * help.
 */

import { differingPositions, toHex, weight, xor } from '../../crypto/bits';
import { sha256OfWord } from '../../crypto/kdf';
import { minEntropyBits } from '../../model/stats';
import { bitGrid } from '../bitgrid';
import { button, callout, claim, clear, disclosure, h, liveRegion, panelIntro, short, verdict } from '../dom';
import { type Store } from '../state';

export function renderSourcePanel(root: HTMLElement, store: Store): void {
  clear(root);
  const s = store.state;

  root.append(
    panelIntro(
      'A reading that is never the same twice',
      'Some things a chip can measure about itself are almost, but not quite, repeatable. ' +
        'When an SRAM chip powers up, each of its cells settles to 0 or 1 according to tiny ' +
        'manufacturing differences — a fingerprint nobody chose and nobody wrote down. Read it ' +
        'again the next day and most cells settle the same way, but some do not.',
      'That is the raw material a device key can be made from: it is different on every chip, and ' +
        'it never has to be stored anywhere. The problem is the word "most".',
      'Two parameters govern the model below, and they are independent here on purpose. The cell ' +
        'skew decides what the fingerprint IS, and therefore how much entropy it carries. The ' +
        'bit-error rate decides how reliably the device reads that fingerprint back. Both have ' +
        'their own slider, and each panel that follows leans on one of them.',
    ),
    callout(
      'scope',
      h('strong', {}, 'What you are looking at. '),
      'There is no physical device in this page. The cells below come from a stated model whose ' +
        'parameters are on screen: each cell leans toward a value with a probability you can set, ' +
        'and each later reading flips cells at a rate you can set. Everything downstream of the ' +
        'readings — the error-correcting code, the helper data, the key derivation — is real.',
    ),
    h(
      'div',
      { class: 'control-row' },
      button('Power the device up twice', () => void store.sampleAgain(), { variant: 'primary', id: 'sample-again' }),
    ),
    liveRegion('source-out'),
  );

  const out = root.querySelector<HTMLElement>('#source-out');
  if (!out) return;

  if (s.sampleReadings.length < 2) {
    out.append(callout('info', 'Press the button to power the modelled device up twice.'));
    return;
  }

  const [first, second] = s.sampleReadings;
  const diff = differingPositions(first, second);

  out.append(
    h(
      'div',
      { class: 'grid-pair' },
      bitGrid(first, { title: 'Reading 1', tone: 'secret', id: 'reading-1' }),
      bitGrid(second, {
        title: 'Reading 2, same device',
        tone: 'secret',
        marks: diff,
        markLabel: 'differ from reading 1',
        id: 'reading-2',
      }),
    ),
    verdict(
      'readings-differ',
      diff.length === 0 ? 'info' : 'warn',
      diff.length === 0
        ? 'The two readings happened to be identical'
        : `${diff.length} of ${first.length} cells came up differently`,
      { detail: 'the same device, two power-ups' },
    ),
    h(
      'div',
      { class: 'claim-row' },
      claim('cells-differing', 'Cells differing', String(diff.length), `of ${first.length}`),
      claim('source-min-entropy-act1', 'Source min-entropy', `${minEntropyBits(s.device.pMax).toFixed(1)} bits`, 'from the stated model'),
      claim('bit-error-rate', 'Bit-error rate of the re-read', `${(s.ber * 100).toFixed(1)}%`, 'set on the next panel'),
      claim('device-seed', 'Device seed', `0x${s.deviceSeed.toString(16).padStart(8, '0')}`, 'reproducible'),
    ),
  );

  const hashRow = h('div', { class: 'hash-row' });
  out.append(
    h('h3', {}, 'So hash it and use that as the key?'),
    h(
      'p',
      {},
      'A hash is the obvious move: it turns any input into a fixed-size secret-looking string. ' +
        'It is also the wrong move here, and for exactly the reason that makes it a good hash. ' +
        'One flipped cell changes every output bit.',
    ),
    hashRow,
  );

  void (async () => {
    const [d1, d2] = await Promise.all([sha256OfWord(first), sha256OfWord(second)]);
    // toHex, not bitsToHex: a digest is already bytes. bitsToHex treats its
    // argument as one bit per element and packs it, which turned a 32-byte
    // digest into eight hex characters.
    const h1 = toHex(d1);
    const h2 = toHex(d2);
    const same = h1 === h2;
    hashRow.append(
      h(
        'div',
        { class: 'compare' },
        h(
          'div',
          { class: 'compare-row' },
          h('span', { class: 'compare-label' }, 'SHA-256 of reading 1'),
          h('code', { class: 'compare-value', 'data-claim': 'sha-reading-1' }, short(h1)),
        ),
        h(
          'div',
          { class: 'compare-row' },
          h('span', { class: 'compare-label' }, 'SHA-256 of reading 2'),
          h('code', { class: 'compare-value', 'data-claim': 'sha-reading-2' }, short(h2)),
        ),
        verdict(
          'hash-fails',
          same ? 'pass' : 'fail',
          same
            ? 'Identical digests — but only because the two readings happened to match'
            : 'Different digests — the second reading gives a different key',
          {
            detail: same
              ? 'raise the cell count or re-read to see the usual case'
              : `${diff.length} flipped cell${diff.length === 1 ? '' : 's'} was enough`,
            check: 'construction',
          },
        ),
      ),
      disclosure(
        'Why not just round the reading off, or take a majority vote?',
        h(
          'p',
          {},
          'Both are real techniques and both cost entropy. Majority voting over many power-ups ' +
            'reduces the error rate but needs the device to be read many times, and it throws ' +
            'away the cells that vote inconsistently — which are the cells carrying the most ' +
            'entropy. Discarding unstable cells does the same thing more directly. The fuzzy ' +
            'extractor takes the other route: keep every cell, publish enough information to ' +
            'correct the differences, and account honestly for what publishing it costs.',
        ),
      ),
    );
  })();

  out.append(
    h(
      'div',
      { class: 'claim-row' },
      claim(
        'flip-fraction',
        'Fraction of cells that differed',
        `${((diff.length / first.length) * 100).toFixed(1)}%`,
        `${weight(xor(first, second))} cells`,
      ),
    ),
  );
}
