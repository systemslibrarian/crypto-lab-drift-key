/** Thin promise wrapper over the measurement worker. */

import type { TrialsRequest, TrialsResponse } from '../workers/trials.worker';
import type { AttackParams, AttackPoint, ReliabilityParams, ReliabilityPoint } from '../model/trials';

let worker: Worker | null = null;
let nextId = 1;

function get(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/trials.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

function run<T>(
  request: Omit<TrialsRequest, 'requestId'>,
  doneKind: TrialsResponse['kind'],
  onProgress: (done: number, total: number) => void,
): Promise<T> {
  const requestId = nextId++;
  const w = get();
  return new Promise<T>((resolve, reject) => {
    const listener = (event: MessageEvent<TrialsResponse>): void => {
      const message = event.data;
      if (message.requestId !== requestId) return;
      if (message.kind === 'progress') {
        onProgress(message.done, message.total);
        return;
      }
      w.removeEventListener('message', listener);
      if (message.kind === 'error') {
        reject(new Error(message.message));
      } else if (message.kind === doneKind) {
        resolve((message as unknown as { points: T }).points);
      } else {
        reject(new Error(`unexpected worker reply: ${message.kind}`));
      }
    };
    w.addEventListener('message', listener);
    w.postMessage({ ...request, requestId } as TrialsRequest);
  });
}

export function runReliability(
  params: ReliabilityParams,
  onProgress: (done: number, total: number) => void,
): Promise<ReliabilityPoint[]> {
  return run<ReliabilityPoint[]>({ kind: 'reliability', ...params }, 'reliability-done', onProgress);
}

export function runAttack(
  params: AttackParams,
  onProgress: (done: number, total: number) => void,
): Promise<AttackPoint[]> {
  return run<AttackPoint[]>({ kind: 'attack', ...params }, 'attack-done', onProgress);
}
