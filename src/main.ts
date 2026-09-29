import './style.css';
import { renderContextPanel } from './ui/panels/context';
import { renderCostPanel } from './ui/panels/cost';
import { renderEnrollPanel, resetEnrollStep } from './ui/panels/enroll';
import { renderReliabilityPanel } from './ui/panels/reliability';
import { renderReusePanel } from './ui/panels/reuse';
import { renderSourcePanel } from './ui/panels/source';
import { Store } from './ui/state';

/**
 * Panels render lazily, on first activation, and re-render afterwards whenever
 * the shared state changes. A tab that has never been opened has an empty
 * panel — which is what the accessibility gate asserts, so an empty panel later
 * means a renderer threw rather than "nothing to show yet".
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

store.subscribe(() => {
  for (const name of rendered) render(name);
});

wireTabs();
resetEnrollStep();
render('source');
rendered.add('source');
void store.enrolNow();
store.sampleAgain();
