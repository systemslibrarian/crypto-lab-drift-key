/** A displayed sweep owns its parameters, progress, result and cancellation. */
export class Measurement<T> {
  private context = '';
  private controller: AbortController | null = null;
  points: T[] | null = null;
  progress = '';
  error = '';

  get running(): boolean { return this.controller !== null; }

  sync(context: string): void {
    if (this.context === context) return;
    const old = this.controller;
    this.controller = null;
    old?.abort();
    this.context = context;
    this.points = null;
    this.progress = '';
    this.error = '';
  }

  async run(
    context: string,
    operation: (signal: AbortSignal, progress: (done: number, total: number) => void) => Promise<T[]>,
    render: () => void,
  ): Promise<void> {
    this.sync(context);
    if (this.running) return;
    const controller = new AbortController();
    this.controller = controller;
    this.points = null;
    this.error = '';
    this.progress = 'Starting…';
    render();
    try {
      const points = await operation(controller.signal, (done, total) => {
        if (this.controller !== controller) return;
        this.progress = `${done} of ${total} trials run`;
        render();
      });
      if (this.controller === controller) this.points = points;
    } catch (error) {
      if (this.controller === controller) this.error = String(error);
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        this.progress = '';
        render();
      }
    }
  }
}

export function validProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validCount(value: number, total: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= total;
}
