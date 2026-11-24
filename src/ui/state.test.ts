import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from './state';

/** Delay a real HKDF operation, without substituting any cryptographic output. */
function holdNextDerivation(): { started: Promise<void>; release: () => void } {
  let release!: () => void;
  let began!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { began = resolve; });
  const original = crypto.subtle.deriveBits.bind(crypto.subtle);
  let first = true;
  vi.spyOn(crypto.subtle, 'deriveBits').mockImplementation(async (...args) => {
    const hold = first;
    first = false;
    const result = await original(...args);
    if (hold) { began(); await gate; }
    return result;
  });
  return { started, release };
}

afterEach(() => vi.restoreAllMocks());

describe('results belong to the scenario that produced them', () => {
  it('a slower old enrolment cannot replace the newer code and its valid key', async () => {
    const store = new Store();
    await store.enrolNow();
    const hold = holdNextDerivation();
    const old = store.setCode('bch-15-7');
    await hold.started;
    expect(store.state.enrollment).toBeNull();
    expect(store.state.reproduction).toBeNull();
    await store.setCode('bch-255-131');
    const latest = store.state.enrollment;
    hold.release(); await old;
    expect(store.state.enrollment).toBe(latest);
    expect(store.state.enrollment?.secret.sourceWord.length).toBe(255);
    expect(store.state.reproduction?.attempt.failureCode).not.toBe('HELPER_LENGTH_MISMATCH');
  });

  it('a delayed clean re-read cannot overwrite the result for a changed error rate', async () => {
    const store = new Store(); await store.enrolNow();
    const hold = holdNextDerivation();
    const old = store.setBer(0);
    await hold.started;
    expect(store.state.reproduction).toBeNull();
    expect(store.state.sampleReadings).toHaveLength(0);
    await store.setBer(0.3);
    const latest = store.state.reproduction;
    hold.release(); await old;
    expect(store.state.reproduction).toBe(latest);
    expect(store.state.ber).toBe(0.3);
  });

  it('reset interrupts the weak-source loop instead of restoring a later old attack', async () => {
    const store = new Store(); await store.enrolNow();
    const hold = holdNextDerivation();
    const old = store.weakSourceFixture();
    await hold.started;
    await store.resetAll();
    const latest = store.state.enrollment;
    hold.release(); expect(await old).toBe(false);
    expect(store.state.scenarioId).toBe('healthy');
    expect(store.state.enrollment).toBe(latest);
    expect(store.state.attack).toBeNull();
    expect(store.state.weakFixture).toBe(false);
  });

  it('an attack against an old enrolment cannot reappear after reset', async () => {
    const store = new Store(); await store.weakSourceFixture();
    const hold = holdNextDerivation();
    const old = store.runAttack();
    await hold.started;
    await store.resetAll();
    hold.release(); await old;
    expect(store.state.attack).toBeNull();
    expect(store.state.scenarioId).toBe('healthy');
  });
});
