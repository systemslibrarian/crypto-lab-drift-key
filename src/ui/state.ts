/**
 * The lab's shared state, and the one place an enrolment is created.
 *
 * Everything the panels draw comes from here, so the entropy bar, the
 * reliability curve and the attack are all reading the same device rather than
 * three independent experiments drawn side by side.
 */

import { type BchCode, CODE_CHOICES, codeById, SMALL_CODE_ID } from '../crypto/bch';
import { type BitVec } from '../crypto/bits';
import {
  type Enrollment,
  enroll,
  judge,
  type ReproduceAttempt,
  randomMessageBits,
  randomSalt,
  reproduce,
  type Verdict,
} from '../crypto/sketch';
import { type AttackResult, guessKey } from '../model/attacker';
import { bytesEqual } from '../crypto/kdf';
import { distance } from '../crypto/bits';
import { makePrng, type Prng, randomSeed } from '../model/prng';
import { type DeviceModel, laterReading, makeDevice, powerUpReading } from '../model/source';
import { DEFAULT_SCENARIO, identifyScenario, type Scenario, type ScenarioId } from './scenario';

export const DEFAULT_CODE_ID = 'bch-127-64';
export const DEFAULT_SKEW = DEFAULT_SCENARIO.skew;
export const DEFAULT_BER = DEFAULT_SCENARIO.ber;

export interface AttackOutcome {
  readonly result: AttackResult;
  /** Decided HERE, outside the attacker module, because the attacker cannot know. */
  readonly keyMatched: boolean;
  /** Hamming distance between the guess and the enrolled reading. */
  readonly distanceToTruth: number;
  /** How many enrolments the attacker watched before winning. 1 unless retried. */
  readonly enrolmentsWatched: number;
}

export interface Reproduction {
  readonly reading: BitVec;
  readonly flips: BitVec;
  readonly attempt: ReproduceAttempt;
  readonly verdict: Verdict;
}

export interface LabState {
  codeId: string;
  code: BchCode;
  deviceSeed: number;
  skew: number;
  ber: number;
  device: DeviceModel;
  /** The first two power-up readings, for the "it is never the same twice" exhibit. */
  sampleReadings: BitVec[];
  enrollment: Enrollment | null;
  reproduction: Reproduction | null;
  attack: AttackOutcome | null;
  /** Which named scenario the current settings are, or 'custom'. */
  scenarioId: ScenarioId;
  /** True while the last enrolment came from the weak-source scenario. */
  weakFixture: boolean;
}

type Listener = () => void;

export class Store {
  state: LabState;
  private listeners: Listener[] = [];
  private rng: Prng;

  constructor() {
    const code = codeById(DEFAULT_CODE_ID);
    const deviceSeed = randomSeed();
    this.rng = makePrng(randomSeed());
    this.state = {
      codeId: DEFAULT_CODE_ID,
      code,
      deviceSeed,
      skew: DEFAULT_SKEW,
      ber: DEFAULT_BER,
      device: makeDevice(code.n, deviceSeed, DEFAULT_SKEW),
      sampleReadings: [],
      enrollment: null,
      reproduction: null,
      attack: null,
      scenarioId: DEFAULT_SCENARIO.id,
      weakFixture: false,
    };
  }

  subscribe(fn: Listener): void {
    this.listeners.push(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  /**
   * Two power-ups of the SAME device.
   *
   * The second is the first re-read at the current bit-error rate, not a second
   * independent draw from the bias model. The distinction is the whole exhibit:
   * the bias decides what the device's fingerprint IS and therefore how much
   * entropy it carries, and the bit-error rate decides how reliably the device
   * reads that fingerprint back. Drawing twice from the bias would conflate the
   * two and show a fair-coin source disagreeing with itself half the time,
   * which is a picture of a source that carries no fingerprint at all.
   */
  sampleAgain(): void {
    const s = this.state;
    const first = powerUpReading(s.device, this.rng);
    s.sampleReadings = [first, laterReading(first, s.ber, this.rng).reading];
    this.notify();
  }

  private rebuildDevice(): void {
    const s = this.state;
    s.scenarioId = identifyScenario(s.skew, s.ber);
    s.code = codeById(s.codeId);
    s.device = makeDevice(s.code.n, s.deviceSeed, s.skew);
    s.enrollment = null;
    s.reproduction = null;
    s.attack = null;
    s.sampleReadings = [];
    s.weakFixture = false;
  }

  async setCode(codeId: string): Promise<void> {
    if (!CODE_CHOICES.some((c) => c.id === codeId)) throw new Error(`unknown code ${codeId}`);
    this.state.codeId = codeId;
    this.rebuildDevice();
    await this.enrolNow();
  }

  async setSkew(skew: number): Promise<void> {
    this.state.skew = skew;
    this.rebuildDevice();
    await this.enrolNow();
  }

  async newDevice(): Promise<void> {
    this.state.deviceSeed = randomSeed();
    this.rebuildDevice();
    await this.enrolNow();
  }

  /** Enrol: a fresh power-up reading, a uniformly random codeword, a public salt. */
  async enrolNow(weakFixture = false): Promise<void> {
    const s = this.state;
    const word = powerUpReading(s.device, this.rng);
    s.enrollment = await enroll(s.code, word, randomMessageBits(s.code.k), randomSalt());
    s.sampleReadings = [word, laterReading(word, s.ber, this.rng).reading];
    s.weakFixture = weakFixture;
    s.reproduction = null;
    s.attack = null;
    await this.reproduceNow();
  }

  async setBer(ber: number): Promise<void> {
    this.state.ber = ber;
    this.state.scenarioId = identifyScenario(this.state.skew, ber);
    await this.reproduceNow();
  }

  /**
   * Apply a named scenario. Everything a scenario touches is a parameter of the
   * shared device, so this goes through the same path as moving the sliders by
   * hand -- there is no second, hidden way to reach these states.
   */
  async applyScenario(scenario: Scenario): Promise<void> {
    // The weak scenario goes through its own path because it has to reach a
    // COMPOUND state -- reproduction succeeded AND the attack won -- and at this
    // bias one guess wins about four times in five. A single attempt would leave
    // the lab's headline result to a coin flip roughly one visit in five.
    if (scenario.id === 'weak') {
      await this.weakSourceFixture();
      return;
    }
    this.state.skew = scenario.skew;
    this.state.ber = scenario.ber;
    this.rebuildDevice();
    this.state.scenarioId = scenario.id;
    await this.enrolNow(false);
  }

  /** Back to the shipped defaults, device included. */
  async resetAll(): Promise<void> {
    this.state.codeId = DEFAULT_CODE_ID;
    this.state.skew = DEFAULT_SCENARIO.skew;
    this.state.ber = DEFAULT_SCENARIO.ber;
    this.state.deviceSeed = randomSeed();
    this.rebuildDevice();
    this.state.scenarioId = DEFAULT_SCENARIO.id;
    await this.enrolNow();
  }

  /** Take a later reading of the same device and try to reproduce the key. */
  async reproduceNow(): Promise<void> {
    const s = this.state;
    if (!s.enrollment) return;
    const { reading, flips } = laterReading(s.enrollment.secret.sourceWord, s.ber, this.rng);
    const attempt = await reproduce(s.code, s.enrollment.pub, reading);
    s.reproduction = { reading, flips, attempt, verdict: judge(attempt, s.enrollment.secret) };
    this.notify();
  }

  /**
   * Run the guessing attack against the current enrolment, from public data
   * only: the helper, the salt, the code parameters and the bias model.
   *
   * The key comparison happens HERE rather than inside `attacker.ts`, because
   * deciding whether an attack worked needs the enrolled key and a real
   * attacker does not have it.
   */
  private async attackOnce(enrolmentsWatched: number): Promise<AttackOutcome> {
    const s = this.state;
    if (!s.enrollment) throw new Error('nothing enrolled to attack');
    const result = await guessKey(s.code, {
      pub: s.enrollment.pub,
      model: { pMax: s.device.pMax, lean: s.device.lean },
    });
    return {
      result,
      keyMatched: !!result.candidateKey && bytesEqual(result.candidateKey, s.enrollment.secret.key),
      distanceToTruth: distance(result.guess, s.enrollment.secret.sourceWord),
      enrolmentsWatched,
    };
  }

  async runAttack(): Promise<void> {
    if (!this.state.enrollment) return;
    this.state.attack = await this.attackOnce(1);
    this.notify();
  }

  /**
   * The weak-source fixture: the same construction on a source with almost no
   * min-entropy left. Nothing about the code, the helper data or the key
   * derivation changes — only the device.
   *
   * At this bias one guess wins roughly four times in five, so the fixture
   * watches enrolments until the attacker wins and REPORTS HOW MANY IT TOOK,
   * rather than either pretending the first one always works or leaving the
   * exhibit to a coin flip. The count is a measurement like any other on this
   * page. The bound exists so a bug cannot spin here for ever; reaching it
   * leaves the honest losing state on screen.
   */
  async weakSourceFixture(): Promise<void> {
    this.state.skew = 0.99;
    this.state.ber = 0.02;
    this.rebuildDevice();
    this.state.scenarioId = 'weak';
    let watched = 0;
    for (let attempt = 1; attempt <= 40; attempt++) {
      watched = attempt;
      await this.enrolNow(true);
      const outcome = await this.attackOnce(watched);
      this.state.attack = outcome;
      if (outcome.keyMatched && this.state.reproduction?.verdict.outcome === 'reproduced') break;
    }
    this.notify();
  }
}

export { SMALL_CODE_ID };
