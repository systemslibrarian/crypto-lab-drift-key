import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeById } from '../crypto/bch';
import { equal, weight, xor } from '../crypto/bits';
import { bytesEqual } from '../crypto/kdf';
import { enroll, randomMessageBits, randomSalt } from '../crypto/sketch';
import { guessKey, mostLikelyReading } from './attacker';
import { makePrng } from './prng';
import { makeDevice, powerUpReading } from './source';
import { exactAttackSuccess, log2ChanceLevel, wilsonInterval } from './stats';

const ATTACKER_SOURCE = readFileSync(
  fileURLToPath(new URL('./attacker.ts', import.meta.url)),
  'utf8',
);

/**
 * The forbidden-token scan below is about CODE, not prose. `attacker.ts`
 * explains in its own header comment that it never sees the enrolled codeword
 * or the enrolment secret, so a scan over the raw file finds those words and
 * fails the module for documenting the rule it obeys. Comments are stripped
 * first, and `the stripper actually strips` proves the stripping happened
 * rather than quietly returning the file unchanged.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const ATTACKER_CODE = stripComments(ATTACKER_SOURCE);

/**
 * Invariant I5, enforced at the module boundary rather than described in a
 * comment. The attacker may import the public reproduction routine and the
 * public types around it; it may not reach for `enroll`, `judge`, the
 * enrolment secret, or the device model, all of which would hand it something a
 * real attacker does not have.
 */
describe('I5: the attacker module can only see public data', () => {
  const ALLOWED: Record<string, string[]> = {
    '../crypto/bits': ['BitVec'],
    '../crypto/bch': ['BchCode'],
    '../crypto/sketch': ['PublicHelper', 'reproduce'],
  };

  function parseImports(src: string): { module: string; bindings: string[] }[] {
    const out: { module: string; bindings: string[] }[] = [];
    const re = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(src)) !== null) {
      out.push({
        module: match[3],
        bindings: match[2]
          .split(',')
          .map((b) => b.replace(/\btype\b/g, '').trim())
          .filter(Boolean),
      });
    }
    return out;
  }

  it('parses the imports it is about to judge', () => {
    const imports = parseImports(ATTACKER_SOURCE);
    // A parser that silently matched nothing would pass every assertion below.
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.map((i) => i.module).sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it('imports nothing outside the allowlist', () => {
    for (const { module, bindings } of parseImports(ATTACKER_SOURCE)) {
      expect(Object.keys(ALLOWED), `attacker.ts imports from ${module}`).toContain(module);
      for (const binding of bindings) {
        expect(ALLOWED[module], `attacker.ts imports ${binding} from ${module}`).toContain(binding);
      }
    }
  });

  it('the stripper actually strips, so the scan below is over code', () => {
    expect(ATTACKER_SOURCE).toContain('PUBLIC INPUTS ONLY');
    expect(ATTACKER_CODE).not.toContain('PUBLIC INPUTS ONLY');
    expect(ATTACKER_CODE).toContain('export async function guessKey');
    expect(ATTACKER_CODE.length).toBeGreaterThan(400);
  });

  it('never names the enrolment secret, the codeword or the device model', () => {
    for (const forbidden of [
      'EnrollmentSecret',
      'enroll(',
      'judge(',
      'DeviceModel',
      'powerUpReading',
      'secret',
      'codeword',
      './source',
      'makeDevice',
    ]) {
      expect(ATTACKER_CODE, `attacker.ts code mentions ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the forbidden-token check would actually bite', () => {
    // A negative check on a string is worthless if the string is empty or the
    // token could never appear anyway. Both are ruled out here.
    expect(ATTACKER_CODE.length).toBeGreaterThan(400);
    expect(ATTACKER_CODE).toContain('reproduce(');
    expect(`${ATTACKER_CODE}enroll(`).toContain('enroll(');
  });
});

describe('the guessing attack', () => {
  it('guesses each cell its own lean, which is the most likely word', () => {
    const device = makeDevice(63, 2024, 0.9);
    const guess = mostLikelyReading({ pMax: device.pMax, lean: device.lean });
    expect([...guess]).toEqual([...device.lean]);
  });

  it('recovers the real key when the source is heavily skewed', async () => {
    const code = codeById('bch-63-39');
    const device = makeDevice(code.n, 1, 0.99);
    const rng = makePrng(4);
    let wins = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      const w = powerUpReading(device, rng);
      const enrollment = await enroll(code, w, randomMessageBits(code.k), randomSalt());
      const result = await guessKey(code, {
        pub: enrollment.pub,
        model: { pMax: device.pMax, lean: device.lean },
      });
      // The comparison lives HERE, not inside the attacker: deciding whether an
      // attack worked is not something the attacker can do.
      if (result.candidateKey && bytesEqual(result.candidateKey, enrollment.secret.key)) wins++;
    }
    const exact = exactAttackSuccess(device.pMax, code.t);
    const ci = wilsonInterval(wins, trials);
    expect(exact).toBeGreaterThan(0.4);
    expect(ci.lo).toBeLessThanOrEqual(exact);
    expect(ci.hi).toBeGreaterThanOrEqual(exact);
  });

  it('is at chance level against a fair-coin source, and chance level is nil', async () => {
    const code = codeById('bch-127-64');
    const device = makeDevice(code.n, 1, 0.5);
    const rng = makePrng(5);
    let wins = 0;
    for (let i = 0; i < 300; i++) {
      const w = powerUpReading(device, rng);
      const enrollment = await enroll(code, w, randomMessageBits(code.k), randomSalt());
      const result = await guessKey(code, {
        pub: enrollment.pub,
        model: { pMax: device.pMax, lean: device.lean },
      });
      if (result.candidateKey && bytesEqual(result.candidateKey, enrollment.secret.key)) wins++;
    }
    expect(wins).toBe(0);
    expect(log2ChanceLevel(code.n, code.t)).toBeLessThan(-70);
  });

  it('a win means the guess landed inside the decoding ball, nothing cleverer', async () => {
    const code = codeById('bch-31-16');
    const device = makeDevice(code.n, 88, 0.99);
    const rng = makePrng(6);
    let checked = 0;
    for (let i = 0; i < 120; i++) {
      const w = powerUpReading(device, rng);
      const enrollment = await enroll(code, w, randomMessageBits(code.k), randomSalt());
      const result = await guessKey(code, {
        pub: enrollment.pub,
        model: { pMax: device.pMax, lean: device.lean },
      });
      const won = !!result.candidateKey && bytesEqual(result.candidateKey, enrollment.secret.key);
      // Independent re-derivation of the win condition, from the distance alone.
      expect(won).toBe(weight(xor(result.guess, w)) <= code.t);
      if (won) {
        expect(result.candidateWord && equal(result.candidateWord, w)).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('reports a decode failure rather than a key when the guess is too far off', async () => {
    const code = codeById('bch-15-7');
    const device = makeDevice(code.n, 3, 0.5);
    const rng = makePrng(7);
    let failures = 0;
    for (let i = 0; i < 60; i++) {
      const w = powerUpReading(device, rng);
      const enrollment = await enroll(code, w, randomMessageBits(code.k), randomSalt());
      const result = await guessKey(code, {
        pub: enrollment.pub,
        model: { pMax: device.pMax, lean: device.lean },
      });
      if (!result.decoded) {
        expect(result.candidateKey).toBeNull();
        expect(result.failureCode).toBeTruthy();
        failures++;
      }
    }
    expect(failures).toBeGreaterThan(0);
  });
});
