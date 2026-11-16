// "What Privilege did" (rule 25) for this lab: the trace of every gateway call against the shared contract (assertTrace) and the honesty
// rule. Mock: the lab's own gateway computed each check, so they are `checked`. Real: the shared hop captured the exchanges from a fake door
// on a loopback port, and a real gateway reports no per-check detail, so only `inferred` and `observed` are allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { assertTrace } from '../src/gatewayTrace.js';
import { createWorld } from '../src/world.js';
import { runScenario } from '../src/runner.js';
import { SCENARIOS, VERTICALS } from '../src/stories.js';
import { llmSpec, mcpSpec, mcp, call, withServer, seeded } from './helpers.js';
import { startFakeGateway, SESSION_ID } from './fakeGateway.js';

const decisionOf = (t, id) => t.decisions.find((d) => d.id === id);
const outcomes = (t) => t.decisions.map((d) => `${d.id}:${d.outcome}`).join(' ');

// ---- Mock -----------------------------------------------------------------------------------------------------------------------
test('mock: every one of the 21 story calls yields a trace that passes assertTrace, on a non-real host, all decisions `checked`, in the gateway\'s order', () => {
  let calls = 0;
  const statuses = new Set();
  for (const s of SCENARIOS) {
    for (const v of VERTICALS) {
      for (const step of runScenario(s.id, v.id).steps) {
        if (step.op !== 'call') { assert.equal(step.gw, undefined, 'a registry step is not a gateway call: no panel record'); continue; }
        calls += 1;
        statuses.add(step.status);
        assert.deepEqual(assertTrace(step.gw), [], `${s.id} ${v.id} step ${step.index}`);
        assert.equal(step.gw.source, 'mock');
        assert.match(step.gw.request.url, /^https:\/\/gateway\.example\.invalid\//);
        assert.ok(step.gw.decisions.every((d) => d.basis === 'checked'));
        assert.equal(step.gw.response.status, step.status);
        assert.equal(step.gw.decisions[0].id, 'authenticated');
        // nothing after the first refusal was reached
        const firstFail = step.gw.decisions.findIndex((d) => d.outcome === 'fail');
        if (firstFail >= 0) assert.ok(step.gw.decisions.slice(firstFail + 1).every((d) => d.outcome === 'skipped'), outcomes(step.gw));
        else assert.ok(step.gw.decisions.every((d) => d.outcome === 'pass'), outcomes(step.gw));
      }
    }
  }
  assert.equal(calls, 21 * 3, '21 call steps in each of the 3 verticals');
  for (const s of [200, 401, 403, 429]) assert.ok(statuses.has(s), `HTTP ${s} is traced`);
});

test('mock: the decisions follow the gateway order authenticate, state, scope, grant (mcp) and stop at the check that refused', () => {
  const { w, vk } = seeded();
  const ok = call(w, vk, mcp()).gw;
  assert.equal(outcomes(ok), 'authenticated:pass state:pass scope:pass grant:pass');
  assert.equal(ok.response.status, 200);

  assert.equal(outcomes(call(w, 'sk-MOCK-NEVER-ISSUED-KEY-0000', mcp()).gw), 'authenticated:fail state:skipped scope:skipped grant:skipped');
  assert.equal(outcomes(call(w, vk, mcp('other-mcp')).gw), 'authenticated:pass state:pass scope:pass grant:fail');
  assert.equal(outcomes(call(w, vk, { kind: 'a2a', app: 'flights-mcp' }).gw), 'authenticated:pass state:pass scope:fail grant:skipped');

  w.registry.revoke('travel-agent');
  const revoked = call(w, vk, mcp()).gw;
  assert.equal(outcomes(revoked), 'authenticated:pass state:fail scope:skipped grant:skipped');
  assert.match(decisionOf(revoked, 'state').evidence, /revoked/);
  assert.equal(revoked.response.status, 401);
});

test('mock: an llm call adds provider/model and the caps, and a 429 stops at the caps', () => {
  const w = createWorld();
  const { body } = w.registry.create({ name: 'llm-agent', spec: llmSpec({ RPMLimit: 1 }) });
  const vk = body.spec.VirtualKey;
  const route = { kind: 'llm', provider: 'anthropic', model: 'm-small' };
  const first = call(w, vk, route, { tokens: 1 }).gw;
  assert.equal(outcomes(first), 'authenticated:pass state:pass scope:pass target:pass caps:pass');
  const second = call(w, vk, route, { tokens: 1 }).gw;
  assert.equal(outcomes(second), 'authenticated:pass state:pass scope:pass target:pass caps:fail');
  assert.equal(second.response.status, 429);
  assert.equal(outcomes(call(w, vk, { ...route, model: 'm-huge' }).gw), 'authenticated:pass state:pass scope:pass target:fail caps:skipped');
  for (const t of [first, second]) assert.deepEqual(assertTrace(t), []);
});

test('mock: a probe call still shows its decisions; a workload token is shown by its claims, with no key', () => {
  const w = createWorld();
  w.registry.create({ name: 'wl-agent', spec: { Scopes: ['mcp'], Custodian: 'Mark', NotAfter: '2027-10-21T12:00:00.000Z', WorkloadIdentity: { Issuer: 'https://issuer.example.invalid', Audience: 'gw', Subject: 'svc', MaxTokenLifetimeSec: 600 } } });
  w.grants.grant({ keyName: 'wl-agent', app: 'flights-mcp', tools: [] });
  const t = Math.floor(w.clock.now() / 1000);
  const gw = w.gateway.evaluate({ credential: { type: 'workload', claims: { iss: 'https://issuer.example.invalid', aud: 'gw', sub: 'svc', iat: t, exp: t + 300 } }, route: mcp() }).gw;
  assert.equal(outcomes(gw), 'authenticated:pass state:pass scope:pass grant:pass');
  assert.match(gw.request.headers['x-mock-workload-claims'], /issuer\.example\.invalid/);
  assert.deepEqual(assertTrace(gw), []);
});

test('mock: the Authorization header in a trace is masked, never the full mock key; and no accept header is invented', () => {
  const { w, vk } = seeded();
  const gw = call(w, vk, mcp()).gw;
  assert.ok(!JSON.stringify(gw).includes(vk), 'the full mock key is not in the trace');
  assert.match(gw.request.headers.authorization, /^Bearer sk-MOCK-[A-Z0-9-]{4}\.\.\.[A-Z0-9]{4}$/);
  assert.equal(gw.request.headers.accept, undefined, 'the mock gateway sends no accept header');
  assert.match(gw.request.headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
});

test('mock: the existing text trace is unchanged beside the new record; POST /api/gateway/call carries `gw`', async () => {
  const { w, vk } = seeded();
  const r = call(w, vk, mcp());
  assert.match(r.trace.request, /^POST \/flights-mcp\/mcp HTTP\/1\.1/);
  await withServer(async (url) => {
    const post = (path, body) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify(body) });
    const made = await (await post('/api/registry/keys', { name: 'travel-agent', spec: mcpSpec() })).json();
    await post('/api/registry/grants', { keyName: 'travel-agent', app: 'flights-mcp' });
    const res = await (await post('/api/gateway/call', { credential: { type: 'bearer', value: made.response.spec.VirtualKey }, route: mcp() })).json();
    assert.equal(res.status, 200);
    assert.deepEqual(assertTrace(res.gw), []);
    assert.ok(res.trace.request.startsWith('POST /flights-mcp/mcp HTTP/1.1'));
  });
});

// ---- Real, against a fake door --------------------------------------------------------------------------------------------------
async function withRealDoor(fn, { behaviour = 'ok' } = {}) {
  const key = `fake-key-${randomBytes(12).toString('hex')}`;
  const gw = await startFakeGateway({ key, behaviour });
  const saved = { ...process.env };
  Object.assign(process.env, { STANDALONE_ENV: '/nonexistent/none.env', ARG_GW_URL: gw.origin, ARG_GW_APPS: 'flights-mcp', ARG_GW_KEY_TESTER: key });
  try { await withServer(async (url) => fn(url, { gw, key })); } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); await gw.close(); }
}
const check = (url) => fetch(`${url}/api/gateway-check`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: '{}' }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('real, 200 then 403: tools/list and the refusal probe each get a trace; decisions are inferred or observed, never checked; no key, no full session id', async () => {
  await withRealDoor(async (url, { gw, key }) => {
    const { status, body } = await check(url);
    assert.equal(status, 200);
    assert.deepEqual(body.traces.map((e) => e.title), ['Gateway check: tools/list', 'Refusal probe: tools/call']);
    assert.deepEqual(body.traces.map((e) => e.step), [1, 2]);
    assert.deepEqual(body.traces.map((e) => e.status), [200, 403]);
    for (const ex of body.traces) {
      assert.deepEqual(assertTrace(ex.trace), [], ex.title);
      assert.equal(ex.trace.source, 'real');
      assert.ok(ex.trace.decisions.every((d) => d.basis === 'inferred' || d.basis === 'observed'), 'a real gateway reports no per-check detail: never `checked`');
      const text = JSON.stringify(ex.trace);
      assert.ok(!text.includes(key), `${ex.title}: the agent key is in the trace`);
      assert.ok(!text.includes(SESSION_ID), `${ex.title}: the full session id is in the trace`);
      assert.match(ex.trace.request.headers.Authorization, /^Bearer <agent key, \d+ characters, kept on the server>$/);
    }
    const [list, probe] = body.traces.map((e) => e.trace);
    assert.equal(list.request.body.method, 'tools/list');
    assert.deepEqual(list.setup.map((s) => s.label), ['initialize', 'notifications/initialized', 'session close']);
    assert.deepEqual([decisionOf(list, 'authenticated').outcome, decisionOf(list, 'authenticated').basis], ['pass', 'inferred']);
    assert.match(decisionOf(list, 'grant').evidence, /search_flights/);
    assert.equal(probe.request.body.params.name, 'agent_registry_refusal_probe_tool');
    assert.deepEqual([decisionOf(probe, 'grant').outcome, decisionOf(probe, 'grant').basis], ['fail', 'inferred']);
    // what the fake door received is what the trace says was sent
    const sent = gw.seen.filter((s) => s.rpc?.method === 'tools/call').at(-1);
    assert.deepEqual(probe.request.body, sent.rpc);
    // the card still reads its own summary fields, and the wire capture is not sent twice
    assert.equal(body.listing.ok, true);
    assert.equal(body.listing.wire, undefined);
    assert.equal(body.refusal.refusal.layer, 'policy');
  });
});

test('real, 401 on the first call: one trace, authentication refused (inferred), the grant not reached, no probe', async () => {
  await withRealDoor(async (url, { key }) => {
    const { body } = await check(url);
    assert.equal(body.traces.length, 1);
    const t = body.traces[0].trace;
    assert.deepEqual(assertTrace(t), []);
    assert.equal(body.traces[0].status, 401);
    assert.deepEqual([decisionOf(t, 'authenticated').outcome, decisionOf(t, 'authenticated').basis], ['fail', 'inferred']);
    assert.equal(decisionOf(t, 'grant').outcome, 'skipped');
    assert.ok(!JSON.stringify(body).includes(key));
  }, { behaviour: 'bad-key' });
});
