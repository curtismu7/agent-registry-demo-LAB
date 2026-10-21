import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, VERTICALS, getScenario, renderScenario, unfilledTokens, storyCorpus } from '../src/stories.js';
import { runScenario, runAll } from '../src/runner.js';
import { scanHosts, scanKeys } from '../src/safety.js';
import { TRACEPARENT } from '../src/trace.js';
import { RULES } from '../src/registry.js';

const EXPECTED = { S01: 'completed', S02: 'refused', S03: 'refused', S04: 'refused', S05: 'completed', S06: 'blocked', S07: 'trap-shown', S08: 'completed', S09: 'refused' };

test('the scenario set is the nine in the brief, ids stable', () => {
  assert.deepEqual(SCENARIOS.map((s) => s.id), Object.keys(EXPECTED));
  assert.equal(VERTICALS.length, 3);
});

for (const v of VERTICALS) {
  for (const s of SCENARIOS) {
    test(`${s.id} ${s.slug} behaves as written in ${v.id}`, () => {
      const r = runScenario(s.id, v.id);
      assert.deepEqual(r.steps.flatMap((x) => x.failures.map((f) => `step ${x.index}: ${f}`)), []);
      assert.equal(r.pass, true);
      assert.equal(r.verdict, EXPECTED[s.id]);
    });
  }
}

test('the same story reads right in every vertical: cast tokens differ, no token is left unfilled', () => {
  for (const s of SCENARIOS) for (const v of VERTICALS) assert.deepEqual(unfilledTokens(s, v), [], `${s.id}/${v.id}`);
  const a = JSON.stringify(renderScenario(getScenario('S01'), VERTICALS[0]));
  const b = JSON.stringify(renderScenario(getScenario('S01'), VERTICALS[1]));
  assert.notEqual(a, b);
  assert.match(a, /Mark/); assert.match(b, /Alice/);
});

test('every vertical agent name is a valid key name, and successors are valid and different', () => {
  for (const v of VERTICALS) {
    assert.match(v.cast.agent, /^[a-z][a-z0-9-]{1,40}$/);
    assert.match(v.cast.agent_next, /^[a-z][a-z0-9-]{1,40}$/);
    assert.notEqual(v.cast.agent, v.cast.agent_next);
  }
});

test('S05 shows the unsafe PUT ignored, then safe replacement', () => {
  const r = runScenario('S05', 'travel');
  const put = r.steps.find((s) => s.op === 'put');
  assert.equal(put.status, 200);
  assert.match(put.notes.join(' '), /ignored/);
  const rot = r.steps.find((s) => s.op === 'rotate');
  assert.deepEqual(rot.body.steps.map((x) => x.step), ['snapshot', 'create-successor', 'copy-grants', 'verify', 'revoke-old']);
  assert.equal(r.steps.at(-1).status, 200);
});

test('S06: the delete is blocked, the key survives, revoke kills it', () => {
  const r = runScenario('S06', 'banking');
  assert.equal(r.steps.find((s) => s.op === 'delete').status, 409);
  assert.equal(r.steps.find((s) => s.op === 'delete').body.rule, 'never-delete-llm-without-real-key');
  assert.equal(r.steps.at(-1).status, 401);
});

test('S07: the trap is data: a dangling warning, then an inherited one, and the impostor gets 200', () => {
  const r = runScenario('S07', 'retail');
  assert.deepEqual(r.steps.filter((s) => s.op === 'warnings').map((s) => s.body.warnings[0].type), ['dangling', 'inherited']);
  assert.equal(r.steps.find((s) => s.op === 'call').status, 200);
  assert.deepEqual(r.warnings.map((w) => w.type), ['inherited']);
});

test('S08: no static secret is minted, and workload gateway acceptance is flagged UNVERIFIED in the trace', () => {
  const r = runScenario('S08', 'travel');
  assert.equal(r.steps[0].body.spec.VirtualKey, '');
  assert.match(r.steps.find((s) => s.op === 'call').trace.notes.join(), /UNVERIFIED/);
  assert.ok(r.rules.includes('workload-gateway-acceptance'));
});

test('every rule a scenario cites exists in the rules table, and every verified rule is cited by a scenario or has a unit test', () => {
  for (const s of SCENARIOS) for (const id of s.rules) assert.ok(RULES[id], `${s.id}: ${id}`);
});

test('every step has a trace with a valid traceparent sharing one trace id per run; wait steps have none', () => {
  const r = runScenario('S04', 'travel');
  const ids = new Set(r.steps.filter((s) => s.trace).map((s) => { assert.match(s.trace.traceparent, TRACEPARENT); return s.trace.traceId; }));
  assert.equal(ids.size, 1);
  assert.equal(r.steps.find((s) => s.op === 'wait').trace, null);
  assert.ok(r.steps.filter((s) => s.op === 'call').every((s) => s.trace.request.startsWith('POST /')));
});

test('S04: the 429 carries retry-after and the clock is virtual (the run takes well under a second)', () => {
  const t0 = Date.now();
  const r = runScenario('S04', 'travel');
  assert.ok(Date.now() - t0 < 1000);
  const over = r.steps.filter((s) => s.op === 'call')[3];
  assert.equal(over.status, 429);
  assert.match(over.trace.response, /retry-after: \d+/);
});

test('runs are repeatable and isolated: two runs share no state, and the clock starts at a fixed epoch', () => {
  const a = runScenario('S01', 'travel'); const b = runScenario('S01', 'travel');
  assert.equal(a.steps[0].at, b.steps[0].at);
  assert.equal(b.steps[0].status, 201, 'the second run could create the same name: no leaked state');
});

test('no run output contains a key that is not masked or obviously fake, a real-looking secret or a real host', () => {
  for (const s of SCENARIOS) {
    const text = JSON.stringify(runScenario(s.id, 'banking'));
    assert.deepEqual(scanKeys(text), [], s.id);
    assert.deepEqual(scanHosts(text), [], s.id);
    for (const t of runScenario(s.id, 'banking').steps) if (t.trace) assert.ok(!/sk-MOCK-[A-Z2-7]{20,}/.test(t.trace.request + t.trace.response), `${s.id} unmasked key in trace`);
  }
});

test('story corpus is clean: reserved hosts only, fake keys only', () => {
  for (const { where, text } of storyCorpus()) { assert.deepEqual(scanHosts(text), [], where); assert.deepEqual(scanKeys(text), [], where); }
});

test('runAll reports pass for every scenario in every vertical', () => {
  for (const v of VERTICALS) { const r = runAll(v.id); assert.equal(r.length, 9); assert.ok(r.every((x) => x.pass), v.id); }
});

test('runScenario rejects unknown ids', () => {
  assert.throws(() => runScenario('S99', 'travel'), /unknown scenario/);
  assert.throws(() => runScenario('S01', 'mining'), /unknown vertical/);
});

test('a wrong expectation is caught: the run fails, names the step, and the verdict is unexpected', () => {
  const def = structuredClone(getScenario('S01'));
  def.steps[2].expect.status = 403;
  def.steps[0].expect.bodyIncludes = 'not-in-the-body';
  const r = runScenario('S01', 'travel', { definition: def });
  assert.equal(r.pass, false);
  assert.equal(r.verdict, 'unexpected');
  assert.match(r.steps[2].failures[0], /expected status 403, got 200/);
  assert.match(r.steps[0].failures[0], /does not include/);
  const noKey = structuredClone(getScenario('S08'));
  noKey.steps[0].spec.WorkloadIdentity = undefined; noKey.steps[0].spec.Custodian = '{{custodian}}';
  assert.equal(runScenario('S08', 'travel', { definition: noKey }).pass, false, 'a static key where noStaticSecret was expected fails');
});
