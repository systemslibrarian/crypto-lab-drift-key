/**
 * Act 8: where this is actually used, what is real on this page, and what none
 * of it proves.
 */

import { callout, clear, disclosure, h, panelIntro } from '../dom';
import { type Store } from '../state';

export function renderContextPanel(root: HTMLElement, store: Store): void {
  clear(root);
  const code = store.state.code;

  root.append(
    panelIntro(
      'Where a key that is never stored is worth the trouble',
      'Every device that has to prove who it is needs a key, and every key has to live somewhere. ' +
        'Written into flash, it can be read out by anyone who can decap the chip or find a debug ' +
        'port. Burned into fuses, it is readable under a microscope. The appeal of deriving it ' +
        'from the chip’s own physical variation is that between power-ups there is nothing to ' +
        'find: the key exists only while the device is running.',
    ),
    h(
      'dl',
      { class: 'use-list' },
      h('dt', {}, 'SRAM PUF device keys'),
      h(
        'dd',
        {},
        'The power-up pattern of an uninitialised SRAM block is a per-chip fingerprint. Guajardo, ' +
          'Kumar, Schrijen and Tuyls (CHES 2007) proposed using it with helper data to derive a ' +
          'device key, and the approach is shipped commercially. The expensive part is the ' +
          'decoder, so hardware designs put a cheap inner code — a repetition code, say — in front ' +
          'of the BCH stage to clean up the bulk of the noise before it runs; Bösch, Guajardo, ' +
          'Sadeghi, Shokrollahi and Tuyls (CHES 2008) is the reference for making helper-data key ' +
          'extraction efficient on an FPGA. This lab implements a single BCH stage and claims no ' +
          'particular published parameter set.',
      ),
      h('dt', {}, 'Biometric template protection'),
      h(
        'dd',
        {},
        'The same problem in a different domain: a fingerprint or an iris scan is never identical ' +
          'twice, and storing a template is storing something that cannot be revoked. Juels and ' +
          'Wattenberg’s 1999 fuzzy commitment was motivated by exactly this. Feature ' +
          'extraction — turning a scan into a bit string whose Hamming distance means something — ' +
          'is its own hard problem and is not modelled here.',
      ),
      h('dt', {}, 'Anti-counterfeiting and key storage without key storage'),
      h(
        'dd',
        {},
        'A device that can derive its key but never holds it at rest changes what an attacker has ' +
          'to do: reading the flash gives them the helper data, which is public anyway.',
      ),
    ),
    h('h3', {}, 'What is real on this page, and what is not'),
    h(
      'ul',
      { class: 'honesty-list', role: 'list' },
      item(
        'The noise source is a model, not a device.',
        'There is no PUF in a browser. The cells come from a stated model with its parameters on ' +
          'screen: a per-cell power-up bias and a per-read bit-error rate. Real SRAM does not ' +
          'separate those two — a strongly biased cell is also a stable one — so a real deployment ' +
          'measures per-cell error rates across temperature, voltage and age. This model holds the ' +
          'two apart, which is what makes the binomial prediction exact.',
      ),
      item(
        'Everything downstream of the reading is real.',
        `The ${code.label} encoder and decoder are implemented here — GF(2^m) arithmetic, the ` +
          'generator polynomial from its cyclotomic cosets, Berlekamp-Massey, Chien search — and ' +
          'verified over the whole space of the smallest code against a brute-force ' +
          'nearest-codeword search. The key derivation is HKDF-SHA-256 from WebCrypto, pinned to ' +
          'the RFC 5869 test vectors through the same call path.',
      ),
      item(
        'Publishing the helper data costs at most n − k bits. That is a guarantee, not an estimate.',
        'It holds for any source, biased or not. What it does not do is promise that enough is ' +
          'left; that depends on the source’s min-entropy, which has to be measured on real ' +
          'hardware. A strongly biased source does not break the bound — it starts with too little ' +
          'for the bound to protect, which is why the guessing attack works.',
      ),
      item(
        'The residual is about the source, not the key.',
        'm − (n − k) bounds the average min-entropy of the READING given the helper data. The key ' +
          'comes from a further extraction step with its own loss. The security proof uses a ' +
          'strong randomness extractor and gives an information-theoretic statement; HKDF is a ' +
          'practical substitute resting on different assumptions. No bit count for the key itself ' +
          'is claimed anywhere on this page.',
      ),
      item(
        'Enrolling twice does not reveal the reading through the XOR of the helpers — and that is a narrow claim.',
        'Boyen (CCS 2004) shows ordinary fuzzy-extractor security can fail under repeated use in ' +
          'stronger models, including attacker-influenced perturbations. Reusable fuzzy extractors ' +
          'are a separate notion for that reason. This page does not demonstrate those attacks and ' +
          'is not evidence about them.',
      ),
      item(
        'This is not production crypto.',
        'It is a teaching demo. The code is written to be read, not to resist a side-channel ' +
          'attack; the model PRNG is not cryptographic; and no part of this has been reviewed for ' +
          'deployment. A real fuzzy extractor also needs debiasing, per-cell characterisation, ' +
          'helper-data manipulation countermeasures, and a decision about what happens when ' +
          'reproduction fails.',
      ),
    ),
    callout(
      'caveat',
      h('strong', {}, 'What this page does NOT prove. '),
      'It does not prove this construction is secure — it demonstrates one bound and one attack ' +
        'against one model. It does not prove a real PUF has any particular min-entropy. It does ' +
        'not prove the derived key is uniform, because HKDF is not the extractor the proof uses. ' +
        'And it does not show what an attacker who can influence the device between readings could ' +
        'do, which is the setting the reusability literature is about.',
    ),
    disclosure(
      'References',
      h(
        'ul',
        { class: 'refs', role: 'list' },
        ref(
          'Juels, A. and Wattenberg, M. (1999). "A Fuzzy Commitment Scheme." ACM CCS 1999.',
          'The code-offset construction, published as fuzzy commitment. The helper data on this page is exactly this.',
        ),
        ref(
          'Dodis, Y., Reyzin, L. and Smith, A. (2004). "Fuzzy Extractors: How to Generate Strong Keys from Biometrics and Other Noisy Data." EUROCRYPT 2004, LNCS 3027.',
          'Names and separates secure sketches from fuzzy extractors, and gives the code-offset sketch its entropy-loss bound.',
        ),
        ref(
          'Dodis, Y., Ostrovsky, R., Reyzin, L. and Smith, A. (2008). "Fuzzy Extractors: How to Generate Strong Keys from Biometrics and Other Noisy Data." SIAM Journal on Computing 38(1), 97–139.',
          'The journal version, and the source of every statement quoted on this page. Construction 2 is the code-offset construction and says outright that over the binary alphabet it IS the Juels–Wattenberg commitment, SS(w) = w XOR C(x). Construction 3 is the syndrome construction, and the text proves the two equivalent. Theorem 5.1 gives the entropy loss: an [n, k, 2t+1] code over F yields an average-case (F^n, m, m − (n − k)f, t) secure sketch — for the binary alphabet, f = 1, so the loss is n − k bits. Lemma 2.2(b) is the general result underneath it. Lemma 4.1 builds the fuzzy extractor from a sketch plus an average-case strong extractor, whose own loss is separate.',
        ),
        ref(
          'Boyen, X. (2004). "Reusable Cryptographic Fuzzy Extractors." ACM CCS 2004.',
          'Why repeated enrolment needs its own definition. Cited for scope, not demonstrated.',
        ),
        ref(
          'Juels, A. and Sudan, M. (2002). "A Fuzzy Vault Scheme." ISIT 2002.',
          'A different scheme for set difference rather than Hamming distance. This lab is not a fuzzy vault, which is why it is not called one.',
        ),
        ref(
          'Guajardo, J., Kumar, S. S., Schrijen, G.-J. and Tuyls, P. (2007). "FPGA Intrinsic PUFs and Their Use for IP Protection." CHES 2007, LNCS 4727.',
          'SRAM power-up state as a PUF, with helper data for key generation. The application this lab models.',
        ),
        ref(
          'Bösch, C., Guajardo, J., Sadeghi, A.-R., Shokrollahi, J. and Tuyls, P. (2008). "Efficient Helper Data Key Extractor on FPGAs." CHES 2008, pp. 181–197.',
          'Making this practical in hardware. Cited for the topic rather than for a parameter set: no concatenated code and no published parameters are claimed on this page, because this lab implements a single BCH stage.',
        ),
        ref(
          'Krawczyk, H. and Eronen, P. (2010). "HMAC-based Extract-and-Expand Key Derivation Function (HKDF)." RFC 5869.',
          'The key-derivation step, and the Appendix A test vectors this lab pins.',
        ),
        ref(
          'Bose, R. C. and Ray-Chaudhuri, D. K. (1960); Hocquenghem, A. (1959).',
          'The codes. Berlekamp (1968) and Massey (1969) for the decoder, Chien (1964) for the root search.',
        ),
      ),
      callout(
        'caveat',
        h('strong', {}, 'Which edition those numbers came from. '),
        'They were read from the ePrint at eprint.iacr.org/2003/235, in the revision dated ' +
          '20 January 2008, which is the journal version — not from the printed SIAM pages. ' +
          'Numbering can differ between a preprint and the copy-edited article, so the statements ' +
          'are given in full above as well: check those rather than the numbers if the two ever ' +
          'disagree.',
      ),
    ),
    h('h3', {}, 'Related demos'),
    h(
      'ul',
      { class: 'related', role: 'list' },
      related('crypto-lab-syndrome-drain', 'Syndrome decoding as a hardness assumption — the same syndrome, used for the opposite purpose.'),
      related('crypto-lab-kdf-chain', 'What a key-derivation function is doing, step by step.'),
      related('crypto-lab-entropy-collapse', 'What happens to a system when its entropy source is not what it was believed to be.'),
      related('crypto-lab-quantum-entropy', 'Extracting a key from a physical randomness source.'),
      related('crypto-lab-mceliece-gate', 'Error-correcting codes where the decoder is the trapdoor.'),
    ),
  );
}

function item(title: string, body: string): HTMLElement {
  return h('li', { role: 'listitem' }, h('strong', {}, title), ' ', body);
}

function ref(citation: string, note: string): HTMLElement {
  return h('li', { role: 'listitem' }, h('span', { class: 'ref-cite' }, citation), ' ', h('span', { class: 'ref-note' }, note));
}

function related(slug: string, note: string): HTMLElement {
  return h(
    'li',
    { role: 'listitem' },
    h('a', { href: `https://systemslibrarian.github.io/${slug}/`, target: '_blank', rel: 'noopener noreferrer' }, slug),
    ' — ',
    note,
  );
}
