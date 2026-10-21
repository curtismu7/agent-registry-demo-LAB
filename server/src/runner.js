// Runs a story against a fresh mock world and records every step as a trace. Time is virtual: "wait" moves the clock, nothing sleeps.
import { randomBytes } from 'node:crypto';
import { createWorld, rotateSafely } from './world.js';
import { rawRequest, rawResponse, newTraceparent, envelope } from './trace.js';
import { SCENARIOS, VERTICALS, getScenario, getVertical, renderScenario } from './stories.js';

const REGISTRY_HOST = 'registry.example.invalid';
const UNITS = { m: 60, h: 3600, d: 86400, y: 365 * 86400 };

// "+1y", "+30d", "+1h" relative to the virtual clock; anything else passes through.
function resolveTimes(spec, now) {
  if (spec && typeof spec.NotAfter === 'string') {
    const m = /^\+(\d+)([mhdy])$/.exec(spec.NotAfter);
    if (m) return { ...spec, NotAfter: new Date(now + Number(m[1]) * UNITS[m[2]] * 1000).toISOString() };
  }
  return spec;
}

const EXPECTED_VERDICT = { completes: 'completed', refused: 'refused', blocked: 'blocked', trap: 'trap-shown' };

// definition: run an ad-hoc scenario object instead of a stored one (tests use it to prove a wrong expectation is caught).
export function runScenario(scenarioId, verticalId, { definition } = {}) {
  const base = definition || getScenario(scenarioId);
  const vertical = getVertical(verticalId);
  if (!base) throw new Error(`unknown scenario ${scenarioId}`);
  if (!vertical) throw new Error(`unknown vertical ${verticalId}`);
  const scenario = renderScenario(base, vertical);
  const world = createWorld();
  const { registry, grants, gateway, clock } = world;
  const handles = {}; // handle -> { name, vk }
  const traceId = randomBytes(16).toString('hex');
  const steps = [];
  let seenEvents = 0;

  const bind = (handle, view) => { if (handle) handles[handle] = { name: view.name, vk: view.spec.VirtualKey }; };
  const registryTrace = ({ method, path, body }, out) => {
    const traceparent = `00-${traceId}-${randomBytes(8).toString('hex')}-01`;
    const request = rawRequest({ method, host: REGISTRY_HOST, path, headers: { traceparent, 'content-type': 'application/json' }, body });
    const response = rawResponse({ status: out.status, headers: { 'content-type': 'application/json' }, body: out.body });
    return envelope({ traceparent, request, response, notes: out.notes || [] });
  };

  scenario.steps.forEach((s, i) => {
    let out; let trace; let extra = {};
    const h = handles[s.key];
    switch (s.op) {
      case 'register': {
        const payload = { name: s.name || vertical.cast.agent, spec: resolveTimes(s.spec, clock.now()) };
        out = registry.create(payload);
        if (out.status === 201) bind(s.as, out.body);
        trace = registryTrace({ method: 'POST', path: '/v1/agentaccesskeys', body: payload }, out);
        break;
      }
      case 'get':
        out = registry.get(h.name); trace = registryTrace({ method: 'GET', path: `/v1/agentaccesskeys/default/${h.name}` }, out); break;
      case 'grant': {
        const body = { keyName: h.name, app: s.app, tools: s.tools || [] };
        out = grants.grant(body); trace = registryTrace({ method: 'POST', path: '/v1/pacpolicys', body }, out); break;
      }
      case 'put': {
        const body = { name: h.name, spec: resolveTimes(s.spec, clock.now()) };
        const before = registry.get(h.name).body.spec.VirtualKey;
        out = registry.update(h.name, body);
        trace = registryTrace({ method: 'PUT', path: `/v1/agentaccesskeys/default/${h.name}`, body }, out);
        extra.virtualKeyUnchanged = out.status === 200 && out.body.spec.VirtualKey === before;
        break;
      }
      case 'revoke': out = registry.revoke(h.name); trace = registryTrace({ method: 'PUT', path: `/v1/agentaccesskeys/default/${h.name}`, body: { spec: { Revoked: true } } }, out); break;
      case 'delete': out = registry.del(h.name, { heldRealKey: s.heldRealKey }); trace = registryTrace({ method: 'DELETE', path: `/v1/agentaccesskeys/default/${h.name}` }, out); break;
      case 'rotate': {
        out = rotateSafely(world, h.name, { successorName: s.successor, realKey: s.realKey });
        if (out.status === 200) bind(s.as, out.body.successor);
        trace = registryTrace({ method: 'POST', path: `/demo/rotate-by-replacement/${h.name}`, body: { successorName: s.successor } }, out);
        break;
      }
      case 'warnings': {
        const w = grants.warnings();
        out = { status: 200, body: { warnings: w }, notes: [] };
        trace = registryTrace({ method: 'GET', path: '/demo/grant-warnings' }, out);
        extra.types = w.map((x) => x.type);
        break;
      }
      case 'wait': clock.advance(s.seconds); out = { status: 200, body: { advanced: s.seconds }, notes: [`virtual clock +${s.seconds}s`] }; trace = null; break;
      case 'call': {
        const t = Math.floor(clock.now() / 1000);
        const credential = s.credential === 'workload'
          ? { type: 'workload', claims: { iss: s.claims.iss, aud: s.claims.aud, sub: s.claims.sub, iat: t, exp: t + s.claims.lifetime } }
          : { type: 'bearer', value: h.vk };
        const r = gateway.evaluate({ credential, route: s.route, traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-01`, tokens: s.tokens, costUsd: s.costUsd });
        out = { status: r.status, body: r.body, notes: r.trace.notes };
        trace = r.trace;
        break;
      }
      default: throw new Error(`unknown op ${s.op}`);
    }
    const ev = registry.events().slice(seenEvents);
    seenEvents = registry.events().length ? registry.events()[registry.events().length - 1].seq : 0;
    const exp = s.expect || {};
    const failures = [];
    if (exp.status !== undefined && out.status !== exp.status) failures.push(`expected status ${exp.status}, got ${out.status}`);
    if (exp.bodyIncludes && !JSON.stringify(out.body, null, 2).includes(exp.bodyIncludes)) failures.push(`body does not include ${JSON.stringify(exp.bodyIncludes)}`);
    if (exp.virtualKeyUnchanged && !extra.virtualKeyUnchanged) failures.push('VirtualKey changed');
    if (exp.noStaticSecret && out.body.spec?.VirtualKey !== '') failures.push('a static VirtualKey was minted');
    if (exp.types && !exp.types.every((t) => (extra.types || []).includes(t))) failures.push(`expected warning types ${exp.types.join(',')}, got ${(extra.types || []).join(',') || 'none'}`);
    steps.push({
      index: i + 1, op: s.op, say: s.say, status: out.status, ok: failures.length === 0, failures,
      body: out.body, notes: out.notes || [], trace, events: ev, at: new Date(clock.now()).toISOString(),
    });
  });

  const allOk = steps.every((s) => s.ok);
  const verdict = allOk ? EXPECTED_VERDICT[scenario.outcome] : 'unexpected';
  return {
    id: scenario.id, slug: scenario.slug, title: scenario.title, kind: scenario.kind, takeaway: scenario.takeaway, rules: scenario.rules,
    vertical: vertical.id, expectedOutcome: scenario.outcome, verdict, pass: allOk, traceId, steps,
    events: registry.events(), warnings: grants.warnings(),
  };
}

export function runAll(verticalId) {
  return SCENARIOS.map((s) => {
    const r = runScenario(s.id, verticalId);
    return { id: r.id, slug: r.slug, title: r.title, kind: r.kind, expectedOutcome: r.expectedOutcome, verdict: r.verdict, pass: r.pass, steps: r.steps.length, failures: r.steps.flatMap((x) => x.failures.map((f) => `step ${x.index}: ${f}`)) };
  });
}
export { VERTICALS };
