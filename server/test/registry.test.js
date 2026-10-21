// One test per real-behaviour rule. Each asserts the behaviour AND its opposite, so a mutated rule fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, mintVirtualKey, RULES } from '../src/registry.js';
import { createWorld, rotateSafely } from '../src/world.js';
import { mcpSpec, llmSpec, FAKE_REAL, seeded, call, mcp } from './helpers.js';

const fresh = () => createWorld().registry;

test('keys are obviously fake: sk-MOCK- plus 54 base32 characters, never random-looking real shapes', () => {
  const k = mintVirtualKey();
  assert.match(k, /^sk-MOCK-[A-Z2-7]{54}$/);
  assert.notEqual(mintVirtualKey(), mintVirtualKey());
});

test('rule virtual-key-immutable: PUT with a new VirtualKey returns 200 and the value is ignored', () => {
  const r = fresh();
  const vk = r.create({ name: 'a-agent', spec: mcpSpec() }).body.spec.VirtualKey;
  const out = r.update('a-agent', { spec: { VirtualKey: 'sk-MOCK-ATTEMPT', RPMLimit: 7 } });
  assert.equal(out.status, 200);
  assert.equal(out.body.spec.VirtualKey, vk);
  assert.equal(out.body.spec.RPMLimit, 7, 'other fields in the same PUT still apply');
  assert.match(out.notes.join(' '), /ignored/);
  assert.equal(r.get('a-agent').body.spec.VirtualKey, vk);
});

test('rule virtual-key-immutable: a PUT with the same VirtualKey adds no ignored-note', () => {
  const r = fresh();
  const vk = r.create({ name: 'a-agent', spec: mcpSpec() }).body.spec.VirtualKey;
  assert.deepEqual(r.update('a-agent', { spec: { VirtualKey: vk } }).notes, []);
});

test('a VirtualKey supplied on create is ignored (UNVERIFIED reading) and the server mints its own', () => {
  const r = fresh();
  const out = r.create({ name: 'a-agent', spec: mcpSpec({ VirtualKey: 'sk-MOCK-CHOSEN-BY-CALLER' }) });
  assert.notEqual(out.body.spec.VirtualKey, 'sk-MOCK-CHOSEN-BY-CALLER');
  assert.equal(RULES['caller-virtual-key-on-create'].status, 'unverified');
});

test('rule no-rotate-endpoint: the registry exposes no in-place rotate or regenerate', () => {
  const r = fresh();
  for (const n of ['rotate', 'regenerate', 'rotateKey', 'regenerateKey', 'reissue']) assert.equal(r[n], undefined, n);
  assert.equal(typeof r.rotateByReplacement, 'function');
});

test('rule llm-needs-real-key: llm create without RealKey is 400 with the real message; with it, 201', () => {
  const r = fresh();
  const no = r.create({ name: 'l-agent', spec: llmSpec({ RealKey: undefined }) });
  assert.equal(no.status, 400);
  assert.equal(no.body.message, 'Spec.RealKey is required for llm scope');
  assert.equal(r.get('l-agent').status, 404, 'nothing was created');
  assert.equal(r.create({ name: 'l-agent', spec: llmSpec() }).status, 201);
  assert.equal(r.create({ name: 'm-agent', spec: mcpSpec() }).status, 201, 'mcp-only needs no RealKey');
});

test('rule llm-needs-real-key: adding the llm scope by PUT also needs a RealKey', () => {
  const r = fresh();
  r.create({ name: 'a-agent', spec: mcpSpec() });
  assert.equal(r.update('a-agent', { spec: { Scopes: ['mcp', 'llm'], Provider: 'anthropic' } }).status, 400);
  assert.equal(r.update('a-agent', { spec: { Scopes: ['mcp', 'llm'], Provider: 'anthropic', RealKey: FAKE_REAL } }).status, 200);
});

test('rule real-key-never-returned: reads return an empty RealKey; a PUT without it keeps the stored one', () => {
  const r = fresh();
  const created = r.create({ name: 'l-agent', spec: llmSpec() });
  assert.equal(created.body.spec.RealKey, '');
  assert.equal(r.get('l-agent').body.spec.RealKey, '');
  assert.equal(r.list().body.items[0].spec.RealKey, '');
  assert.ok(!JSON.stringify(r.get('l-agent')).includes(FAKE_REAL));
  assert.equal(r.update('l-agent', { spec: { RPMLimit: 5 } }).status, 200);
  assert.equal(r.hasRealKey('l-agent'), true, 'still held');
  assert.equal(r.del('l-agent', { heldRealKey: FAKE_REAL }).status, 200, 'the kept RealKey is the one that matches');
});

test('rule never-delete-llm-without-real-key: blocked without it, with a wrong one, allowed with the right one (demo guard)', () => {
  const r = fresh();
  r.create({ name: 'l-agent', spec: llmSpec() });
  for (const held of [undefined, '', 'sk-MOCK-WRONG']) {
    const out = r.del('l-agent', { heldRealKey: held });
    assert.equal(out.status, 409);
    assert.equal(out.body.error, 'blocked_by_demo_guard');
    assert.equal(out.body.demoGuard, true);
    assert.match(out.body.message, /Revoke instead/);
    assert.equal(r.get('l-agent').status, 200, 'still there');
  }
  assert.equal(r.del('l-agent', { heldRealKey: FAKE_REAL }).status, 200);
  assert.equal(RULES['never-delete-llm-without-real-key'].status, 'demo-guard', 'honest: the real API does not stop you');
});

test('never-delete guard applies to a REVOKED llm key too, and does not apply to an mcp key', () => {
  const r = fresh();
  r.create({ name: 'l-agent', spec: llmSpec() }); r.revoke('l-agent');
  assert.equal(r.del('l-agent').status, 409);
  r.create({ name: 'm-agent', spec: mcpSpec() });
  assert.equal(r.del('m-agent').status, 200);
});

test('rule revoke-only-non-destructive-kill: revoke keeps the key and its spec, flips state, is idempotent', () => {
  const { w, vk } = seeded();
  const before = w.registry.get('travel-agent').body.spec;
  assert.equal(call(w, vk, mcp()).status, 200);
  const out = w.registry.revoke('travel-agent');
  assert.equal(out.status, 200);
  assert.equal(out.body.state, 'revoked');
  assert.equal(w.registry.get('travel-agent').status, 200, 'not deleted');
  assert.equal(w.registry.get('travel-agent').body.spec.VirtualKey, before.VirtualKey);
  assert.equal(w.grants.listFor('travel-agent').length, 1, 'grants stay');
  assert.equal(w.registry.revoke('travel-agent').status, 200);
  assert.equal(w.registry.events().filter((e) => e.type === 'key.revoked').length, 1, 'idempotent: one event');
  assert.equal(call(w, vk, mcp()).status, 401);
});

test('PUT Revoked:true revokes; PUT Revoked:false is refused (un-revoke is UNVERIFIED)', () => {
  const { w } = seeded();
  assert.equal(w.registry.update('travel-agent', { spec: { Revoked: true } }).body.state, 'revoked');
  const back = w.registry.update('travel-agent', { spec: { Revoked: false } });
  assert.equal(back.status, 400);
  assert.equal(w.registry.stateOf('travel-agent'), 'revoked');
});

test('rule expired-edit-renews: state flips to expired at NotAfter; moving NotAfter forward renews the same key', () => {
  const w = createWorld();
  const soon = new Date(w.clock.now() + 3600_000).toISOString();
  const vk = w.registry.create({ name: 'a-agent', spec: mcpSpec({ NotAfter: soon }) }).body.spec.VirtualKey;
  assert.equal(w.registry.stateOf('a-agent'), 'active');
  w.clock.advance(3600);
  assert.equal(w.registry.stateOf('a-agent'), 'expired');
  const out = w.registry.update('a-agent', { spec: { NotAfter: new Date(w.clock.now() + 86400_000).toISOString() } });
  assert.equal(out.body.state, 'active');
  assert.equal(out.body.spec.VirtualKey, vk, 'same key value: edit, not rotation');
  assert.match(out.notes.join(' '), /renewed/);
});

test('rule guardrail-copied-with-spec: the snapshot and the successor carry guardrail, caps, scopes, custodian, expiry', () => {
  const { w } = seeded({ spec: mcpSpec({ RPMLimit: 33, TPMLimit: 4400, BudgetUSD: 9, Guardrail: { mode: 'block', blockAgreement: 'off' } }) });
  const snap = w.registry.snapshot('travel-agent');
  assert.equal(snap.spec.Guardrail.mode, 'block');
  assert.ok(!('VirtualKey' in snap.spec), 'the snapshot never carries the key value');
  const out = rotateSafely(w, 'travel-agent', { successorName: 'travel-agent-v2' });
  assert.equal(out.status, 200);
  for (const f of ['Guardrail', 'RPMLimit', 'TPMLimit', 'BudgetUSD', 'Scopes', 'Custodian', 'NotAfter', 'AllowedModels', 'Provider']) {
    assert.deepEqual(out.body.successor.spec[f], out.body.old.spec[f], f);
  }
  assert.notEqual(out.body.successor.spec.VirtualKey, out.body.old.spec.VirtualKey, 'but the key value is new');
});

test('rotate by replacement: ordered steps, old revoked only after verify, grants recreated, old 401, new 200', () => {
  const { w, vk } = seeded();
  const out = rotateSafely(w, 'travel-agent', { successorName: 'travel-agent-v2' });
  assert.deepEqual(out.body.steps.map((s) => s.step), ['snapshot', 'create-successor', 'copy-grants', 'verify', 'revoke-old']);
  assert.ok(out.body.steps.every((s) => s.ok));
  assert.equal(w.registry.stateOf('travel-agent'), 'revoked');
  assert.equal(w.registry.get('travel-agent').status, 200, 'old key is revoked, never deleted');
  assert.equal(w.grants.listFor('travel-agent-v2').length, 1);
  assert.equal(call(w, vk, mcp()).status, 401);
  assert.equal(call(w, out.body.successor.spec.VirtualKey, mcp()).status, 200);
});

test('rotate by replacement: failed verify leaves the OLD key active and untouched, and discards the successor', () => {
  const { w, vk } = seeded();
  const out = w.registry.rotateByReplacement('travel-agent', { successorName: 'travel-agent-v2', verify: () => ({ ok: false, detail: 'probe returned 403' }) });
  assert.equal(out.status, 409);
  assert.equal(out.body.error, 'verify_failed');
  assert.equal(w.registry.stateOf('travel-agent'), 'active');
  assert.equal(call(w, vk, mcp()).status, 200);
  assert.equal(w.registry.stateOf('travel-agent-v2'), 'revoked');
  assert.equal(out.body.steps.at(-1).step, 'discard-successor');
});

test('rotate by replacement: a successor that cannot be verified because grants were not copied is caught', () => {
  const { w } = seeded();
  const out = w.registry.rotateByReplacement('travel-agent', {
    successorName: 'travel-agent-v2',
    verify: (s) => { const r = call(w, s.spec.VirtualKey, mcp()); return { ok: r.status === 200, detail: `probe ${r.status}` }; },
  }); // no onSuccessor: grants not copied
  assert.equal(out.status, 409);
  assert.equal(w.registry.stateOf('travel-agent'), 'active');
});

test('rotate of an llm key needs the RealKey (reads never return it) and never deletes the old key', () => {
  const w = createWorld();
  w.registry.create({ name: 'l-agent', spec: llmSpec() });
  const no = rotateSafely(w, 'l-agent', { successorName: 'l-agent-v2' });
  assert.equal(no.status, 400);
  assert.match(no.body.message, /old key was not touched/);
  assert.equal(w.registry.stateOf('l-agent'), 'active');
  const yes = rotateSafely(w, 'l-agent', { successorName: 'l-agent-v2', realKey: FAKE_REAL });
  assert.equal(yes.status, 200);
  assert.equal(w.registry.get('l-agent').status, 200);
});

test('rotate: successor must have a new valid name (duplicate names UNVERIFIED, so refused); unknown key is 404', () => {
  const { w } = seeded();
  assert.equal(w.registry.rotateByReplacement('travel-agent', { successorName: 'travel-agent' }).status, 400);
  assert.equal(w.registry.rotateByReplacement('travel-agent', { successorName: 'Bad Name' }).status, 400);
  w.registry.create({ name: 'taken-agent', spec: mcpSpec() });
  assert.equal(w.registry.rotateByReplacement('travel-agent', { successorName: 'taken-agent' }).status, 409);
  assert.equal(w.registry.stateOf('travel-agent'), 'active');
  assert.equal(w.registry.rotateByReplacement('nobody', { successorName: 'x-agent' }).status, 404);
});

test('name is permanent and unique; invalid names are refused', () => {
  const r = fresh();
  assert.equal(r.create({ name: 'a-agent', spec: mcpSpec() }).status, 201);
  assert.equal(r.create({ name: 'a-agent', spec: mcpSpec() }).status, 409);
  for (const n of ['', 'A', 'Has Space', '1abc', '../x', 'a'.repeat(60)]) assert.equal(r.create({ name: n, spec: mcpSpec() }).status, 400, n);
  assert.equal(r.update('a-agent', { name: 'renamed', spec: {} }).status, 400);
});

test('validation: scopes, custodian, caps, expiry, unknown fields', () => {
  const r = fresh();
  assert.equal(r.create({ name: 'a-agent', spec: mcpSpec({ Scopes: ['admin'] }) }).status, 400);
  assert.equal(r.create({ name: 'a-agent', spec: mcpSpec({ Scopes: [] }) }).status, 400);
  assert.equal(r.create({ name: 'a-agent', spec: mcpSpec({ Custodian: '' }) }).status, 400);
  assert.equal(r.create({ name: 'a-agent', spec: mcpSpec({ RPMLimit: -1 }) }).status, 400);
  assert.equal(r.create({ name: 'a-agent', spec: mcpSpec({ RPMLimit: 1.5 }) }).status, 400);
  assert.equal(r.create({ name: 'a-agent', spec: mcpSpec({ NotAfter: 'tomorrow-ish' }) }).status, 400);
  assert.equal(r.create({ name: 'l-agent', spec: llmSpec({ Provider: '' }) }).status, 400);
  r.create({ name: 'b-agent', spec: mcpSpec() });
  assert.equal(r.update('b-agent', { spec: { Nonsense: 1 } }).status, 400);
  assert.equal(r.update('zzz-agent', { spec: {} }).status, 404);
});

test('caps are registration attributes: stored exactly, 0 means unlimited', () => {
  const r = fresh();
  const s = r.create({ name: 'a-agent', spec: mcpSpec({ RPMLimit: 60, TPMLimit: 90000, BudgetUSD: 50 }) }).body.spec;
  assert.deepEqual([s.RPMLimit, s.TPMLimit, s.BudgetUSD], [60, 90000, 50]);
  const d = r.create({ name: 'b-agent', spec: mcpSpec() }).body.spec;
  assert.deepEqual([d.RPMLimit, d.TPMLimit, d.BudgetUSD], [0, 0, 0]);
});

test('custodian text is inert: control characters stripped, length capped', () => {
  const r = fresh();
  const s = r.create({ name: 'a-agent', spec: mcpSpec({ Custodian: `<img src=x onerror=alert(1)>\u0000\n${'x'.repeat(500)}` }) }).body.spec;
  assert.ok(s.Custodian.length <= 80);
  assert.ok(!/[\u0000-\u001f]/.test(s.Custodian));
});

test('rule workload-no-static-secret: a workload key mints no VirtualKey; audience and subject binding are mandatory', () => {
  const r = fresh();
  const W = { Issuer: 'https://issuer.example.invalid', Audience: 'https://gw.example.invalid/x/mcp', Subject: 'spiffe://x.example.invalid/a' };
  const ok = r.create({ name: 'w-agent', spec: { Scopes: ['mcp'], WorkloadIdentity: W } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.spec.VirtualKey, '');
  assert.equal(r.authenticate(''), null, 'an empty credential never matches a workload key');
  assert.equal(r.create({ name: 'w2-agent', spec: { Scopes: ['mcp'], WorkloadIdentity: { ...W, Audience: '' } } }).status, 400);
  assert.equal(r.create({ name: 'w3-agent', spec: { Scopes: ['mcp'], WorkloadIdentity: { ...W, Subject: '' } } }).status, 400);
  assert.equal(r.create({ name: 'w4-agent', spec: { Scopes: ['mcp'], WorkloadIdentity: { ...W, Subject: '', AllowAnySubject: true } } }).status, 201);
  assert.equal(r.create({ name: 'w5-agent', spec: { Scopes: ['llm'], Provider: 'p', RealKey: FAKE_REAL, WorkloadIdentity: W } }).status, 400);
  assert.equal(r.create({ name: 'a-agent', spec: mcpSpec() }).body.spec.VirtualKey.startsWith('sk-MOCK-'), true);
});

test('lifecycle events: a small own list, ordered, capped, not an audit product', () => {
  const r = fresh();
  r.create({ name: 'a-agent', spec: mcpSpec() }); r.revoke('a-agent'); r.del('a-agent');
  assert.deepEqual(r.events().map((e) => e.type), ['key.created', 'key.revoked', 'key.deleted']);
  assert.deepEqual(r.events().map((e) => e.seq), [1, 2, 3]);
  for (let i = 0; i < 600; i++) r.create({ name: `k-${i}-agent`.replace(/[^a-z0-9-]/g, 'x'), spec: mcpSpec() });
  assert.ok(r.events().length <= 500);
});

test('rules table marks every rule verified, demo-guard or unverified', () => {
  for (const [id, r] of Object.entries(RULES)) { assert.ok(['verified', 'demo-guard', 'unverified'].includes(r.status), id); assert.ok(r.text.length > 20, id); }
  assert.ok(Object.values(RULES).some((r) => r.status === 'unverified'));
});
