import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer, rawHttp, mcpSpec, llmSpec } from './helpers.js';

const post = (url, body, method = 'POST') => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('GET /api/health is demo-health/1: public, no-store, small, no counts or secrets', async () => {
  await withServer(async (base) => {
    const r = await fetch(`${base}/api/health`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-type'), /application\/json/);
    const text = await r.text();
    assert.ok(text.length < 4096);
    const j = JSON.parse(text);
    assert.equal(j.schema, 'demo-health/1');
    assert.equal(j.state, 'ready');
    assert.equal(j.runtime, 'offline');
    assert.deepEqual(Object.keys(j.demo).sort(), ['id', 'name', 'version']);
    assert.equal(j.demo.id, 'agent-registry-demo');
    assert.ok(j.demo.name.length <= 80 && j.demo.version.length <= 32);
    assert.deepEqual(Object.keys(j).sort(), ['at', 'demo', 'runtime', 'schema', 'state']);
    assert.ok(!Number.isNaN(Date.parse(j.at)));
  });
});

test('health is GET only', async () => {
  await withServer(async (base) => {
    const r = await post(`${base}/api/health`, {});
    assert.equal(r.status, 405);
    assert.equal(r.headers.get('allow'), 'GET');
  });
});

test('Host check: a non-loopback Host is refused; same-origin writes enforced', async () => {
  await withServer(async (base) => {
    assert.equal((await rawHttp(`${base}/api/health`, { headers: { host: 'evil.example.invalid' } })).status, 403);
    const evil = await rawHttp(`${base}/api/reset`, { method: 'POST', headers: { origin: 'http://evil.example.invalid', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(evil.status, 403);
    assert.equal(JSON.parse(evil.text).error, 'cross_origin');
    assert.equal((await rawHttp(`${base}/api/reset`, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await post(`${base}/api/reset`, {})).status, 200);
  });
});

test('catalog lists verticals, scenarios and the rules table with their status', async () => {
  await withServer(async (base) => {
    const j = await (await fetch(`${base}/api/catalog?vertical=banking`)).json();
    assert.equal(j.vertical, 'banking'); assert.equal(j.scenarios.length, 9); assert.equal(j.verticals.length, 3);
    assert.equal(j.rules['virtual-key-immutable'].status, 'verified');
    assert.equal((await fetch(`${base}/api/catalog?vertical=mining`)).status, 400);
  });
});

test('POST /api/run and /api/run-all', async () => {
  await withServer(async (base) => {
    const r = await (await post(`${base}/api/run`, { scenario: 'rotate-unsafe-vs-safe', vertical: 'retail' })).json();
    assert.equal(r.pass, true); assert.equal(r.id, 'S05');
    assert.equal((await post(`${base}/api/run`, { scenario: 'nope' })).status, 400);
    assert.equal((await post(`${base}/api/run`, { scenario: 'S01', vertical: 'nope' })).status, 400);
    const all = await (await post(`${base}/api/run-all`, { vertical: 'travel' })).json();
    assert.equal(all.total, 9); assert.equal(all.passed, 9);
  });
});

test('live registry: create, list, read, PUT ignores VirtualKey, revoke, delete guard, reset', async () => {
  await withServer(async (base) => {
    const c = await post(`${base}/api/registry/keys`, { name: 'demo-agent', spec: mcpSpec() });
    assert.equal(c.status, 201);
    const vk = (await c.json()).response.spec.VirtualKey;
    assert.match(vk, /^sk-MOCK-/);
    const put = await post(`${base}/api/registry/keys/demo-agent`, { spec: { VirtualKey: 'sk-MOCK-NEW', RPMLimit: 3 } }, 'PUT');
    const pj = await put.json();
    assert.equal(put.status, 200); assert.equal(pj.response.spec.VirtualKey, vk); assert.match(pj.notes.join(), /ignored/);
    assert.equal((await post(`${base}/api/registry/keys`, { name: 'l-agent', spec: llmSpec({ RealKey: undefined }) })).status, 400);
    await post(`${base}/api/registry/keys`, { name: 'l-agent', spec: llmSpec() });
    const del = await post(`${base}/api/registry/keys/l-agent`, {}, 'DELETE');
    assert.equal(del.status, 409);
    assert.equal((await del.json()).response.error, 'blocked_by_demo_guard');
    assert.equal((await (await fetch(`${base}/api/registry/keys`)).json()).response.items.length, 2);
    assert.equal((await post(`${base}/api/registry/keys/demo-agent/revoke`, {})).status, 200);
    assert.equal((await fetch(`${base}/api/registry/keys/zzz`)).status, 404);
    assert.equal((await (await fetch(`${base}/api/events`)).json()).items.some((e) => e.type === 'key.delete.blocked'), true);
    await post(`${base}/api/reset`, {});
    assert.equal((await (await fetch(`${base}/api/registry/keys`)).json()).response.items.length, 0);
    assert.equal((await (await fetch(`${base}/api/events`)).json()).items.length, 0);
  });
});

test('live gateway: grant, call 200, revoke, call 401; rotate by replacement over HTTP; clock advance', async () => {
  await withServer(async (base) => {
    const vk = (await (await post(`${base}/api/registry/keys`, { name: 'demo-agent', spec: mcpSpec() })).json()).response.spec.VirtualKey;
    assert.equal((await post(`${base}/api/registry/grants`, { keyName: 'demo-agent', app: 'flights-mcp' })).status, 201);
    const call = async (value) => (await (await post(`${base}/api/gateway/call`, { credential: { type: 'bearer', value }, route: { kind: 'mcp', app: 'flights-mcp', tool: 'x' } })).json());
    assert.equal((await call(vk)).status, 200);
    const rot = await post(`${base}/api/registry/keys/demo-agent/rotate`, { successorName: 'demo-agent-v2' });
    const rj = await rot.json();
    assert.equal(rot.status, 200);
    assert.deepEqual(rj.response.steps.map((s) => s.step), ['snapshot', 'create-successor', 'copy-grants', 'verify', 'revoke-old']);
    assert.equal((await call(vk)).status, 401);
    assert.equal((await call(rj.response.successor.spec.VirtualKey)).status, 200);
    assert.equal((await post(`${base}/api/gateway/call`, { credential: { type: 'nope' }, route: {} })).status, 400);
    const t0 = (await (await fetch(`${base}/api/clock`)).json()).now;
    const t1 = (await (await post(`${base}/api/clock/advance`, { seconds: 3600 })).json()).now;
    assert.equal(Date.parse(t1) - Date.parse(t0) >= 3_599_000, true);
    assert.equal((await post(`${base}/api/clock/advance`, { seconds: -5 })).status, 400);
    assert.equal((await post(`${base}/api/clock/advance`, { seconds: 1e12 })).status, 400);
  });
});

test('live trap: the same-name recreate warning is visible through the API', async () => {
  await withServer(async (base) => {
    await post(`${base}/api/registry/keys`, { name: 'demo-agent', spec: mcpSpec() });
    await post(`${base}/api/registry/grants`, { keyName: 'demo-agent', app: 'flights-mcp' });
    await post(`${base}/api/registry/keys/demo-agent`, {}, 'DELETE');
    assert.equal((await (await fetch(`${base}/api/registry/grants`)).json()).warnings[0].type, 'dangling');
    await post(`${base}/api/registry/keys`, { name: 'demo-agent', spec: mcpSpec() });
    assert.equal((await (await fetch(`${base}/api/registry/grants`)).json()).warnings[0].type, 'inherited');
  });
});

test('bad JSON is a 400, oversized is a 413, unknown endpoint is a 404, safety-scan is clean', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' })).status, 400);
    assert.equal((await post(`${base}/api/run`, { scenario: 'x'.repeat(20000) })).status, 413);
    assert.equal((await fetch(`${base}/api/nothing`)).status, 404);
    assert.equal((await (await fetch(`${base}/api/safety-scan`)).json()).ok, true);
  });
});

test('no API response carries a real-looking key or a non-reserved host', async () => {
  await withServer(async (base) => {
    await post(`${base}/api/registry/keys`, { name: 'l-agent', spec: llmSpec() });
    for (const p of ['/api/registry/keys', '/api/catalog', '/api/events']) {
      const t = await (await fetch(`${base}${p}`)).text();
      assert.ok(!/sk-(?!MOCK-)[A-Za-z0-9]{8,}/.test(t), p);
    }
    const r = await (await post(`${base}/api/run`, { scenario: 'S04' })).text();
    assert.ok(!r.includes('sk-MOCK-REAL-UPSTREAM-PLACEHOLDER'), 'the RealKey is never echoed in a run');
  });
});

test('workspace header scopes the world: one visitor resets, another keeps their data (rule 13)', async () => {
  await withServer(async (base) => {
    const ws = (id) => ({ 'content-type': 'application/json', 'x-workspace': id });
    // A key in the default workspace is invisible from ws-b.
    await post(`${base}/api/registry/keys`, { name: 'ws-a-key', spec: mcpSpec() });
    const inB = await (await fetch(`${base}/api/registry/keys/ws-a-key`, { headers: ws('ws-b') })).status;
    assert.equal(inB, 404, 'ws-b must not see the default workspace key');
    // Resetting ws-b does not clear the default workspace.
    await fetch(`${base}/api/reset`, { method: 'POST', headers: ws('ws-b') });
    assert.equal((await fetch(`${base}/api/registry/keys/ws-a-key`)).status, 200, 'default keeps its key after the ws-b reset');
    // Resetting the default clears it.
    await fetch(`${base}/api/reset`, { method: 'POST' });
    assert.equal((await fetch(`${base}/api/registry/keys/ws-a-key`)).status, 404);
    // A malformed workspace id is refused.
    assert.equal((await fetch(`${base}/api/registry/keys`, { headers: ws('../evil') })).status, 400);
  });
});

test('GET /api/shelf is reachable without a web build and reads SHELF_URL; POST is refused', async () => {
  const prev = process.env.SHELF_URL;
  process.env.SHELF_URL = 'https://shelf.example:8443/';
  try {
    await withServer(async (base) => {
      const r = await fetch(`${base}/api/shelf`);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { shelfUrl: 'https://shelf.example:8443' });
      assert.notEqual((await fetch(`${base}/api/shelf`, { method: 'POST', headers: { origin: base } })).status, 200);
    });
  } finally {
    if (prev === undefined) delete process.env.SHELF_URL; else process.env.SHELF_URL = prev;
  }
});
