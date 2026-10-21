// Stories as data. verticals.json carries the cast; scenarios.json carries the steps. {{tokens}} are filled from the chosen
// vertical, so one story reads right for travel, banking and retail. Packs are data: add a vertical, no code change.
import fs from 'node:fs';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
export const VERTICALS = load('verticals.json');
export const SCENARIOS = load('scenarios.json');

export const getVertical = (id) => VERTICALS.find((v) => v.id === id);
export const getScenario = (idOrSlug) => SCENARIOS.find((s) => s.id === idOrSlug || s.slug === idOrSlug);

export function render(value, tokens) {
  if (typeof value === 'string') {
    const whole = /^\{\{(\w+)\}\}$/.exec(value);
    if (whole && whole[1] in tokens) return tokens[whole[1]];
    return value.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in tokens ? String(tokens[k]) : m));
  }
  if (Array.isArray(value)) return value.map((x) => render(x, tokens));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, render(x, tokens)]));
  return value;
}

export const renderScenario = (scenario, vertical) => render(scenario, vertical.cast);

// Tokens used by a scenario that its vertical does not define (a typo would otherwise render literally).
export function unfilledTokens(scenario, vertical) {
  return [...new Set([...JSON.stringify(renderScenario(scenario, vertical)).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
}

// Every string a pack can put on screen, for the host and key scans.
export function storyCorpus() {
  return [
    ...VERTICALS.map((v) => ({ where: `vertical ${v.id}`, text: JSON.stringify(v) })),
    ...SCENARIOS.map((s) => ({ where: `scenario ${s.id}`, text: JSON.stringify(s) })),
  ];
}
