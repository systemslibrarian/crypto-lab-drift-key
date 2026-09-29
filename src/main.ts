import './style.css';
import { renderContextPanel } from './ui/panels/context';
import { renderCostPanel } from './ui/panels/cost';
import { renderEnrollPanel, resetEnrollStep } from './ui/panels/enroll';
import { renderGuided, resetGuided } from './ui/panels/guided';
import { renderReliabilityPanel } from './ui/panels/reliability';
import { renderReusePanel } from './ui/panels/reuse';
import { renderSourcePanel } from './ui/panels/source';
import { scenarioBar } from './ui/scenario';
import { Store } from './ui/state';

/**
 * Two ways to read this lab.
 *
 * GUIDED is the default: five scenes, one button on screen at a time, each
 * scene's result directly beneath its own action. EXPLORE is the six-panel lab,
 * unchanged, for a visitor who wants to drive it themselves.
 *
 * Explore's panels render lazily, on first activation, and re-render afterwards
 * whenever the shared state changes. A tab that has never been opened has an
 * empty panel — which is what the accessibility gate asserts, so an empty panel
 * later means a renderer threw rather than "nothing to show yet".
 */
const PANELS: Record<string, (root: HTMLElement, store: Store) => void> = {
  source: renderSourcePanel,
  enroll: renderEnrollPanel,
  reliability: renderReliabilityPanel,
  cost: renderCostPanel,
  reuse: renderReusePanel,
  context: renderContextPanel,
};

const store = new Store();
const rendered = new Set<string>();
let mode: 'guided' | 'explore' = 'guided';
let activePanel = 'source';

function panelRoot(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#panel-${name}`);
}

function render(name: string): void {
  const root = panelRoot(name);
  if (!root) return;
  PANELS[name](root, store);
  rendered.add(name);
}

function activate(name: string): void {
  activePanel = name;
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab-btn')) {
    const active = tab.dataset.panel === name;
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.tabIndex = active ? 0 : -1;
  }
  for (const panel of document.querySelectorAll<HTMLElement>('.panel')) {
    panel.hidden = panel.id !== `panel-${name}`;
  }
  if (!rendered.has(name)) render(name);
}

/** The scenario bar is the one surface that must never be stale. */
function renderScenario(): void {
  const slot = document.querySelector<HTMLElement>('#scenario-slot');
  if (!slot) return;
  const s = store.state;
  slot.replaceChildren(
    scenarioBar({
      scenarioId: s.scenarioId,
      codeId: s.codeId,
      skew: s.skew,
      ber: s.ber,
      device: s.device,
      onReset: () => {
        resetGuided();
        resetEnrollStep();
        void store.resetAll();
      },
    }),
  );
}

function renderGuidedRoot(): void {
  const root = document.querySelector<HTMLElement>('#guided');
  if (root) renderGuided(root, store);
}

function setMode(next: 'guided' | 'explore'): void {
  mode = next;
  const guided = document.querySelector<HTMLElement>('#guided');
  const explore = document.querySelector<HTMLElement>('#explore');
  const note = document.querySelector<HTMLElement>('#mode-note');
  if (guided) guided.hidden = next !== 'guided';
  if (explore) explore.hidden = next !== 'explore';
  for (const id of ['guided', 'explore'] as const) {
    const btn = document.querySelector<HTMLButtonElement>(`#mode-${id}`);
    btn?.setAttribute('aria-pressed', id === next ? 'true' : 'false');
  }
  if (note) {
    note.textContent =
      next === 'guided'
        ? 'Five steps, about ninety seconds. One thing to press at a time.'
        : 'Every exhibit, every control. The guided tour is still there if you want the short version.';
  }
  if (next === 'guided') renderGuidedRoot();
  else if (!rendered.has(activePanel)) render(activePanel);
}

function wireTabs(): void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab-btn')];
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab.dataset.panel ?? 'source'));
    tab.addEventListener('keydown', (event: KeyboardEvent) => {
      const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (delta === 0) return;
      event.preventDefault();
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      next.focus();
      activate(next.dataset.panel ?? 'source');
    });
  });
}

document.querySelector('#mode-guided')?.addEventListener('click', () => setMode('guided'));
document.querySelector('#mode-explore')?.addEventListener('click', () => setMode('explore'));

store.subscribe(() => {
  renderScenario();
  if (mode === 'guided') renderGuidedRoot();
  for (const name of rendered) render(name);
});

wireTabs();
resetEnrollStep();
resetGuided();
renderScenario();
renderGuidedRoot();
void store.enrolNow();
store.sampleAgain();
