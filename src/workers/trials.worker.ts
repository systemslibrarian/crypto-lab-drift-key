/**
 * The measurement worker.
 *
 * Both sweeps run the whole pipeline per trial — enrol, derive, reproduce,
 * compare key bytes — several thousand times, and each one calls WebCrypto.
 * Off the main thread so the page stays responsive and the progress readout is
 * a real progress readout rather than a number that appears once at the end.
 */

import {
  type AttackParams,
  type AttackPoint,
  attackSweep,
  type ReliabilityParams,
  type ReliabilityPoint,
  reliabilitySweep,
} from '../model/trials';

export type TrialsRequest =
  | ({ kind: 'reliability'; requestId: number } & ReliabilityParams)
  | ({ kind: 'attack'; requestId: number } & AttackParams);

export type TrialsResponse =
  | { kind: 'progress'; requestId: number; done: number; total: number }
  | { kind: 'reliability-done'; requestId: number; points: ReliabilityPoint[] }
  | { kind: 'attack-done'; requestId: number; points: AttackPoint[] }
  | { kind: 'error'; requestId: number; message: string };

const post = (message: TrialsResponse): void => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
};

self.addEventListener('message', (event: MessageEvent<TrialsRequest>) => {
  const request = event.data;
  const onProgress = (done: number, total: number): void =>
    post({ kind: 'progress', requestId: request.requestId, done, total });

  void (async () => {
    try {
      if (request.kind === 'reliability') {
        const points = await reliabilitySweep(request, onProgress);
        post({ kind: 'reliability-done', requestId: request.requestId, points });
      } else {
        const points = await attackSweep(request, onProgress);
        post({ kind: 'attack-done', requestId: request.requestId, points });
      }
    } catch (error) {
      post({
        kind: 'error',
        requestId: request.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});
