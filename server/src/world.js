// One self-contained mock world: a virtual clock, a registry, its grants and the gateway in front of them.
export const EPOCH = Date.UTC(2026, 9, 21, 12, 0, 0); // fixed start so a story is repeatable

import { createRegistry } from './registry.js';
import { createGrants } from './grants.js';
import { createGateway } from './gateway.js';

export function createClock(start = EPOCH) {
  let t = start;
  return { now: () => t, advance: (s) => { t += s * 1000; return t; } };
}

export function createWorld({ start = EPOCH, rand } = {}) {
  const clock = createClock(start);
  const registry = createRegistry({ now: clock.now, rand });
  const grants = createGrants({ registry, now: clock.now });
  const gateway = createGateway({ registry, grants, now: clock.now });
  return { clock, registry, grants, gateway };
}

// Rotate by replacement with grants copied and the successor verified by a real call through the mock gateway.
export function rotateSafely(world, name, { successorName, realKey } = {}) {
  const { registry, grants, gateway } = world;
  const verify = (succ) => {
    const spec = succ.spec;
    const entry = registry.entry(succ.name);
    const scope = spec.Scopes[0];
    const granted = grants.listFor(succ.name)[0];
    const route = scope === 'llm' ? { kind: 'llm', provider: spec.Provider, model: spec.AllowedModels[0] || '' } : { kind: scope, app: granted?.app || 'probe', tool: granted?.tools[0] || '' };
    if (scope !== 'llm' && !granted) return { ok: entry && registry.stateOfEntry(entry) === 'active', detail: 'successor is active (no grants to probe a call with)' };
    const credential = spec.WorkloadIdentity ? null : { type: 'bearer', value: spec.VirtualKey };
    if (!credential) return { ok: true, detail: 'workload-identity successor: no static secret to probe with; verify with a token call' };
    const r = gateway.evaluate({ credential, route, probe: true });
    // the probe goes through the real order, so a missing grant or a bad key shows up as non-200
    return { ok: r.status === 200, detail: `probe call to ${route.kind === 'llm' ? 'llm' : route.app} returned ${r.status}` };
  };
  return registry.rotateByReplacement(name, { successorName, realKey, onSuccessor: (from, to) => grants.copy(from, to), verify });
}
