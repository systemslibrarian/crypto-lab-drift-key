/**
 * Named scenarios, and the bar that says which one is running.
 *
 * The lab has one device and one set of parameters, shared by every exhibit.
 * Before this existed, pressing the weak-source button on the cost panel
 * silently re-tuned the device for the reliability curve and the enrolment
 * stepper too, and a visitor who moved between panels afterwards was reading a
 * different experiment without being told. That is not a presentation problem;
 * it is a page quietly changing what its own numbers are about.
 *
 * So the scenario is named, shown wherever it applies, and resettable.
 */

import { codeById } from '../crypto/bch';
import { minEntropyBits, residualBoundBits, sketchLossBits } from '../model/stats';
import { type DeviceModel } from '../model/source';
import { h } from './dom';

export type ScenarioId = 'healthy' | 'noisy' | 'weak' | 'custom';

export interface Scenario {
  readonly id: ScenarioId;
  readonly label: string;
  readonly skew: number;
  readonly ber: number;
  /** One line on what this scenario is for. */
  readonly blurb: string;
}

export const SCENARIOS: ReadonlyArray<Scenario> = Object.freeze([
  {
    id: 'healthy',
    label: 'Healthy source',
    skew: 0.5,
    ber: 0.04,
    blurb: 'An unbiased source read back with a little noise. The case the construction is for.',
  },
  {
    id: 'noisy',
    label: 'Too noisy',
    skew: 0.5,
    ber: 0.22,
    blurb: 'The same source, re-read far past what the code can repair. Reproduction fails.',
  },
  {
    id: 'weak',
    label: 'Weak source',
    skew: 0.99,
    ber: 0.02,
    blurb: 'A strongly biased source, read back cleanly. Reproduction succeeds and secrecy does not.',
  },
]);

export const DEFAULT_SCENARIO = SCENARIOS[0];

export function scenarioById(id: ScenarioId): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/** Which named scenario these settings are, or 'custom'. */
export function identifyScenario(skew: number, ber: number): ScenarioId {
  const match = SCENARIOS.find(
    (s) => Math.abs(s.skew - skew) < 0.005 && Math.abs(s.ber - ber) < 0.0025,
  );
  return match?.id ?? 'custom';
}

export interface ScenarioBarInput {
  readonly scenarioId: ScenarioId;
  readonly codeId: string;
  readonly skew: number;
  readonly ber: number;
  readonly device: DeviceModel;
  readonly onReset: () => void;
}

/**
 * The persistent scenario bar. Renders the settings every panel is reading,
 * so shared state cannot follow a visitor between exhibits unannounced.
 */
export function scenarioBar(input: ScenarioBarInput): HTMLElement {
  const code = codeById(input.codeId);
  const loss = sketchLossBits(code.n, code.k);
  const residual = residualBoundBits(minEntropyBits(input.device.pMax), loss);
  const scenario = scenarioById(input.scenarioId);
  const weak = residual <= 0;

  const cell = (label: string, value: string, claim: string): HTMLElement =>
    h(
      'span',
      { class: 'scenario-cell' },
      h('span', { class: 'scenario-label' }, label),
      h('span', { class: 'scenario-value', 'data-claim': claim }, value),
    );

  return h(
    'div',
    {
      class: `scenario-bar${weak ? ' scenario-bar-weak' : ''}`,
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Current scenario',
      'data-scenario': input.scenarioId,
    },
    h(
      'span',
      { class: `scenario-name${weak ? ' scenario-name-weak' : ''}`, 'data-claim': 'scenario-name' },
      scenario ? scenario.label : 'Custom settings',
    ),
    cell('Code', code.label, 'scenario-code'),
    cell('Re-read noise', `${(input.ber * 100).toFixed(1)}%`, 'scenario-ber'),
    cell('Residual bound', `${residual.toFixed(1)} bits`, 'scenario-residual'),
    weak
      ? h('span', { class: 'scenario-flag', 'data-claim': 'scenario-flag' }, 'NO ENTROPY GUARANTEE')
      : null,
    h(
      'button',
      { type: 'button', class: 'btn btn-ghost scenario-reset', id: 'scenario-reset', onclick: input.onReset },
      'Reset',
    ),
  );
}
