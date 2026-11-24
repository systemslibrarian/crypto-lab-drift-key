/** Thin promise wrapper over the measurement worker. */

import type { TrialsRequest, TrialsResponse } from '../workers/trials.worker';
import type { AttackParams, AttackPoint, ReliabilityParams, ReliabilityPoint } from '../model/trials';

let nextId = 1;

function run<T>(
  request: Omit<TrialsRequest, 'requestId'>,
  doneKind: TrialsResponse['kind'],
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  const requestId = nextId++;
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Scenario changed', 'AbortError')); return; }
    // Each sweep owns its worker so changing its scenario can stop the actual
    // computation without cancelling a different panel's independent sweep.
    const w = new Worker(new URL('../workers/trials.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = (): void => {
      signal?.removeEventListener('abort', abort);
      w.terminate();
    };
    const fail = (error: Error): void => { cleanup(); reject(error); };
    const abort = (): void => fail(new DOMException('Scenario changed', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    w.addEventListener('error', (event) => fail(new Error(event.message || 'Measurement worker failed')));
    w.addEventListener('messageerror', () => fail(new Error('Measurement worker returned an unreadable result')));
    const listener = (event: MessageEvent<TrialsResponse>): void => {
      const message = event.data;
      if (message.requestId !== requestId) return;
      if (message.kind === 'progress') {
        onProgress(message.done, message.total);
        return;
      }
      cleanup();
      if (message.kind === 'error') {
        reject(new Error(message.message));
      } else if (message.kind === doneKind) {
        resolve((message as unknown as { points: T }).points);
      } else {
        reject(new Error(`unexpected worker reply: ${message.kind}`));
      }
    };
    w.addEventListener('message', listener);
    try { w.postMessage({ ...request, requestId } as TrialsRequest); }
    catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  });
}

export function runReliability(
  params: ReliabilityParams,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ReliabilityPoint[]> {
  return run<ReliabilityPoint[]>({ kind: 'reliability', ...params }, 'reliability-done', onProgress, signal);
}

export function runAttack(
  params: AttackParams,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<AttackPoint[]> {
  return run<AttackPoint[]>({ kind: 'attack', ...params }, 'attack-done', onProgress, signal);
}
