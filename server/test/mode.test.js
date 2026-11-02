// The Mock/Real switch (owner rule 19). Nothing real exists to call here, so Real is refused unless the test-only
// `realAvailable` seam is on. Every test runs under the network guard: the switch makes zero outbound attempts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createWorld } from '../src/world.js';
import { installNetguard } from '../src/netguard.js';

async function withMode(fn, opts) {
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const guard = installNetguard();
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, world: createWorld(), ...opts }) });
  const base = url.replace(/\/$/, '');
  const mode = (body) => fetch(`${base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const info = async () => (await fetch(`${base}/api/info`)).json();
  try { await fn({ base, mode, info }); } finally { health.stop(); await new Promise((r) => server.close(r)); guard.restore(); }
  assert.deepEqual(guard.attempts, [], 'the switch made no outbound attempt');
}

test('GET /api/info: Mock by default, Real not available, with the reason', () => withMode(async ({ info }) => {
  const i = await info();
  assert.deepEqual(Object.keys(i).sort(), ['hosted', 'realAvailable', 'realReason', 'source']);
  assert.equal(i.source, 'mock');
  assert.equal(i.realAvailable, false);
  assert.equal(i.hosted, false);
  assert.match(i.realReason, /Real mode is not available: .*no real server to call\./);
}));

test('POST /api/mode real is refused with 409 and the mode stays Mock; mock is accepted', () => withMode(async ({ mode, info }) => {
  const r = await mode({ source: 'real' });
  assert.equal(r.status, 409);
  assert.match((await r.json()).message, /no real server to call/);
  assert.equal((await info()).source, 'mock');
  const m = await mode({ source: 'mock' });
  assert.equal(m.status, 200);
  assert.equal((await m.json()).source, 'mock');
}));

test('POST /api/mode needs exactly {source: "mock" | "real"}: anything else is 400', () => withMode(async ({ mode }) => {
  for (const body of [{}, { source: 'live' }, { mode: 'mock' }, { source: 'mock', extra: 1 }, { source: 1 }, [], 'null', '[]', '{not json']) {
    assert.equal((await mode(body)).status, 400, JSON.stringify(body));
  }
}));

test('with Real configured (test seam): Real is the default, and the switch goes both ways without a restart', () => withMode(async ({ mode, info, base }) => {
  const first = await info();
  assert.equal(first.source, 'real');
  assert.equal(first.realAvailable, true);
  assert.equal(first.realReason, null);
  const toMock = await mode({ source: 'mock' });
  assert.equal(toMock.status, 200);
  assert.equal((await toMock.json()).source, 'mock');
  assert.equal((await info()).source, 'mock');
  const back = await mode({ source: 'real' });
  assert.equal(back.status, 200);
  assert.equal((await back.json()).source, 'real');
  assert.equal((await info()).source, 'real');
  assert.equal((await fetch(`${base}/api/registry/keys`)).status, 200, 'the data endpoints keep answering after a switch');
}, { realAvailable: true }));

test('hosted build: fail-closed Mock; every switch is 403 and Real is reported unavailable with the reason', () => withMode(async ({ mode, info }) => {
  const i = await info();
  assert.deepEqual({ source: i.source, realAvailable: i.realAvailable, hosted: i.hosted }, { source: 'mock', realAvailable: false, hosted: true });
  assert.match(i.realReason, /hosted build is Mock only/);
  assert.equal((await mode({ source: 'real' })).status, 403);
  assert.equal((await mode({ source: 'mock' })).status, 403);
  assert.equal((await info()).source, 'mock');
}, { hosted: true, realAvailable: true }));

test('the mode is per app instance, not module-global', async () => {
  await withMode(async ({ mode, info }) => {
    await mode({ source: 'mock' });
    assert.equal((await info()).source, 'mock');
  }, { realAvailable: true });
  await withMode(async ({ info }) => assert.equal((await info()).source, 'real'), { realAvailable: true });
});

test('a cross-origin switch is refused like every other write', () => withMode(async ({ base }) => {
  const r = await fetch(`${base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example.invalid' }, body: '{"source":"mock"}' });
  assert.equal(r.status, 403);
}));
