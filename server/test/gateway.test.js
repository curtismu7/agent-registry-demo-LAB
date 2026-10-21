import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world.js';
import { TRACEPARENT } from '../src/trace.js';
import { mcpSpec, llmSpec, seeded, call, mcp, FAKE_REAL } from './helpers.js';

const llm = (model = 'm-small', provider = 'anthropic') => ({ kind: 'llm', provider, model });
const llmWorld = (over = {}) => { const w = createWorld(); const vk = w.registry.create({ name: 'l-agent', spec: llmSpec(over) }).body.spec.VirtualKey; return { w, vk }; };

test('200 for an active, scoped, granted key', () => {
  const { w, vk } = seeded();
  const r = call(w, vk, mcp());
  assert.equal(r.status, 200); assert.equal(r.verdict, 'allow');
});

test('401: unknown, revoked and expired keys are indistinguishable on the wire, but the log says which', () => {
  const { w, vk } = seeded();
  const unknown = call(w, 'sk-MOCK-NOPE', mcp());
  w.registry.revoke('travel-agent');
  const revoked = call(w, vk, mcp());
  const w2 = createWorld();
  const vk2 = w2.registry.create({ name: 'e-agent', spec: mcpSpec({ NotAfter: new Date(w2.clock.now() + 1000).toISOString() }) }).body.spec.VirtualKey;
  w2.grants.grant({ keyName: 'e-agent', app: 'flights-mcp' });
  w2.clock.advance(5);
  const expired = call(w2, vk2, mcp());
  for (const r of [unknown, revoked, expired]) { assert.equal(r.status, 401); assert.equal(r.body, 'Bearer token required'); assert.match(r.headers['www-authenticate'], /^Bearer resource_metadata="https:\/\/gateway\.example\.invalid\//); }
  assert.match(unknown.trace.gatewayLog.join(), /unknown key/);
  assert.match(revoked.trace.gatewayLog.join(), /is revoked/);
  assert.match(expired.trace.gatewayLog.join(), /is expired/);
  assert.ok(!JSON.stringify(unknown.body).includes('revoked'));
});

test('401 shape per route: llm says invalid virtual key; a2a says unauthorized', () => {
  const { w } = llmWorld();
  assert.deepEqual(call(w, 'sk-MOCK-NOPE', llm()).body, { error: { type: 'invalid_request_error', message: 'invalid virtual key' } });
  assert.deepEqual(call(w, 'sk-MOCK-NOPE', { kind: 'a2a', app: 'x-app' }).body, { error: 'unauthorized' });
  assert.equal(call(w, '', mcp()).status, 401);
});

test('403 scope: the only self-describing refusal', () => {
  const { w, vk } = seeded();
  const r = call(w, vk, { kind: 'a2a', app: 'flights-mcp' });
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, { error: 'key not scoped for a2a access' });
});

test('403 bare: no grant, or tool not granted, says only Forbidden; the log explains', () => {
  const { w, vk } = seeded({ tools: ['search'] });
  const other = call(w, vk, mcp('loyalty-mcp', 'search'));
  assert.equal(other.status, 403); assert.equal(other.body, 'Forbidden');
  assert.match(other.trace.gatewayLog.join(), /policy denied key=travel-agent app=loyalty-mcp/);
  assert.match(call(w, vk, mcp('flights-mcp', 'book')).trace.gatewayLog.join(), /tool_not_granted/);
});

test('403 model and provider on llm routes', () => {
  const { w, vk } = llmWorld();
  assert.equal(call(w, vk, llm('m-small')).status, 200);
  const m = call(w, vk, llm('m-large'));
  assert.equal(m.status, 403); assert.match(JSON.stringify(m.body), /model \\"m-large\\" not allowed for this key/);
  const p = call(w, vk, llm('m-small', 'other'));
  assert.equal(p.status, 403); assert.equal(p.body.error.type, 'wrong_provider');
});

test('rule native-caps-429: RPM cap, then 429 with retry-after, then the window clears on the virtual clock', () => {
  const { w, vk } = llmWorld({ RPMLimit: 3 });
  for (let i = 0; i < 3; i++) assert.equal(call(w, vk, llm()).status, 200, `call ${i + 1}`);
  const over = call(w, vk, llm());
  assert.equal(over.status, 429);
  assert.equal(over.body.error.type, 'tokens_rate_limit_exceeded');
  assert.ok(Number(over.headers['retry-after']) >= 1 && Number(over.headers['retry-after']) <= 60);
  w.clock.advance(30);
  assert.equal(call(w, vk, llm()).status, 429, 'still inside the window');
  w.clock.advance(31);
  assert.equal(call(w, vk, llm()).status, 200, 'window passed');
});

test('rule native-caps-429: 0 means unlimited; a refused call is not counted', () => {
  const { w, vk } = llmWorld({ RPMLimit: 0 });
  for (let i = 0; i < 100; i++) assert.equal(call(w, vk, llm()).status, 200);
  const b = llmWorld({ RPMLimit: 2 });
  call(b.w, b.vk, llm()); call(b.w, b.vk, llm());
  for (let i = 0; i < 5; i++) assert.equal(call(b.w, b.vk, llm()).status, 429);
  b.w.clock.advance(61);
  assert.equal(call(b.w, b.vk, llm()).status, 200); assert.equal(call(b.w, b.vk, llm()).status, 200);
  assert.equal(call(b.w, b.vk, llm()).status, 429, 'refused calls did not inflate the window');
});

test('rule native-caps-429: TPM and budget caps', () => {
  const t = llmWorld({ TPMLimit: 100 });
  assert.equal(call(t.w, t.vk, llm(), { tokens: 60 }).status, 200);
  assert.equal(call(t.w, t.vk, llm(), { tokens: 60 }).status, 429);
  assert.equal(call(t.w, t.vk, llm(), { tokens: 40 }).status, 200);
  const b = llmWorld({ BudgetUSD: 1 });
  assert.equal(call(b.w, b.vk, llm(), { costUsd: 0.6 }).status, 200);
  const over = call(b.w, b.vk, llm(), { costUsd: 0.6 });
  assert.equal(over.status, 429);
  b.w.clock.advance(3600);
  assert.equal(call(b.w, b.vk, llm(), { costUsd: 0.6 }).status, 429, 'a budget does not reset with the minute window');
});

test('rule caps-on-mcp-a2a (UNVERIFIED): caps are not applied to mcp calls', () => {
  const { w, vk } = seeded({ spec: mcpSpec({ RPMLimit: 1 }) });
  for (let i = 0; i < 5; i++) assert.equal(call(w, vk, mcp()).status, 200);
});

test('caps are per key: one agent over its cap does not affect another', () => {
  const a = llmWorld({ RPMLimit: 1 });
  const vk2 = a.w.registry.create({ name: 'm-agent', spec: llmSpec({ RPMLimit: 1 }) }).body.spec.VirtualKey;
  call(a.w, a.vk, llm());
  assert.equal(call(a.w, a.vk, llm()).status, 429);
  assert.equal(call(a.w, vk2, llm()).status, 200);
});

test('a recreated same-name llm key starts with fresh usage (counters follow the key, not the name)', () => {
  const { w, vk } = llmWorld({ RPMLimit: 1 });
  call(w, vk, llm());
  w.registry.revoke('l-agent');
  w.registry.del('l-agent', { heldRealKey: FAKE_REAL });
  const vk2 = w.registry.create({ name: 'l-agent', spec: llmSpec({ RPMLimit: 1 }) }).body.spec.VirtualKey;
  assert.equal(call(w, vk2, llm()).status, 200);
});

test('trace envelope: W3C traceparent, caller trace id kept, raw messages, no unmasked key', () => {
  const { w, vk } = seeded();
  const tid = 'a'.repeat(32);
  const r = call(w, vk, mcp(), { traceparent: `00-${tid}-${'b'.repeat(16)}-01` });
  assert.match(r.trace.traceparent, TRACEPARENT);
  assert.equal(r.trace.traceId, tid);
  assert.notEqual(r.trace.traceparent.split('-')[2], 'b'.repeat(16), 'a new span');
  assert.match(r.trace.request, /^POST \/flights-mcp\/mcp HTTP\/1\.1\nHost: gateway\.example\.invalid/);
  assert.match(r.trace.request, /authorization: Bearer sk-MOCK-[A-Z2-7]{4}\.\.\.[A-Z2-7]{4}/);
  assert.ok(!r.trace.request.includes(vk));
  assert.match(r.trace.response, /^HTTP\/1\.1 200 OK/);
  const bad = call(w, vk, mcp(), { traceparent: 'garbage' });
  assert.match(bad.trace.traceparent, TRACEPARENT);
});

test('bad route kind is a 400, not a crash; route text is inert and capped', () => {
  const { w, vk } = seeded();
  assert.equal(call(w, vk, { kind: 'ftp' }).status, 400);
  assert.equal(call(w, vk, undefined).status, 400);
  const r = call(w, vk, { kind: 'mcp', app: `<script>${'a'.repeat(300)}`, tool: 'x\n\ry' });
  assert.equal(r.status, 403);
  assert.ok(!/[\n\r]Host: evil/.test(r.trace.request));
});

const WID = { Issuer: 'https://issuer.example.invalid', Audience: 'https://gateway.example.invalid/flights-mcp/mcp', Subject: 'spiffe://x.example.invalid/a', MaxTokenLifetimeSec: 300 };
function wl() {
  const w = createWorld();
  w.registry.create({ name: 'w-agent', spec: { Scopes: ['mcp'], WorkloadIdentity: WID } });
  w.grants.grant({ keyName: 'w-agent', app: 'flights-mcp' });
  const t = () => Math.floor(w.clock.now() / 1000);
  const tok = (over = {}) => ({ type: 'workload', claims: { iss: WID.Issuer, aud: WID.Audience, sub: WID.Subject, iat: t(), exp: t() + 120, ...over } });
  return { w, tok };
}

test('workload identity: matching issuer, audience, subject and lifetime is accepted, with the UNVERIFIED note', () => {
  const { w, tok } = wl();
  const r = w.gateway.evaluate({ credential: tok(), route: mcp() });
  assert.equal(r.status, 200);
  assert.match(r.trace.gatewayLog.join(), /workload token accepted for key w-agent/);
  assert.match(r.trace.notes.join(), /UNVERIFIED/);
});

test('workload identity: wrong issuer, audience or subject, expired token, over-long lifetime and missing exp are all 401', () => {
  const { w, tok } = wl();
  const t = Math.floor(w.clock.now() / 1000);
  for (const over of [{ iss: 'https://evil.example.invalid' }, { aud: 'https://other.example.invalid/mcp' }, { sub: 'spiffe://x.example.invalid/other' }, { exp: t - 1, iat: t - 100 }, { exp: t + 3600 }, { exp: undefined }, { iat: undefined }]) {
    assert.equal(w.gateway.evaluate({ credential: tok(over), route: mcp() }).status, 401, JSON.stringify(over));
  }
});

test('workload identity: the lifetime cap is exclusive of the limit (300 ok, 301 refused); a revoked workload key is refused; grants still apply', () => {
  const { w, tok } = wl();
  const t = Math.floor(w.clock.now() / 1000);
  assert.equal(w.gateway.evaluate({ credential: tok({ exp: t + 300 }), route: mcp() }).status, 200);
  assert.equal(w.gateway.evaluate({ credential: tok({ exp: t + 301 }), route: mcp() }).status, 401);
  assert.equal(w.gateway.evaluate({ credential: tok(), route: mcp('other-mcp') }).status, 403);
  w.registry.revoke('w-agent');
  assert.equal(w.gateway.evaluate({ credential: tok(), route: mcp() }).status, 401);
});

test('workload identity: a static bearer string cannot impersonate a workload key', () => {
  const { w } = wl();
  assert.equal(call(w, '', mcp()).status, 401);
  assert.equal(call(w, 'mock-workload-token', mcp()).status, 401);
});
