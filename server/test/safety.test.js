import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { isLoopbackHost, assertBindAllowed, bindHost, portProblem, resolvePort, isReservedHost, scanHosts, scanKeys, cleanText, hostCheck, sameOriginWrites, allowedHostsFrom, makeHostCheck, makeSameOriginWrites } from '../src/safety.js';

test('loopback names', () => {
  for (const h of ['localhost', '127.0.0.1', '127.9.9.9', '::1', '[::1]']) assert.ok(isLoopbackHost(h), h);
  for (const h of ['0.0.0.0', '192.168.1.5', 'example.com', 'localhost.evil.invalid']) assert.ok(!isLoopbackHost(h), h);
});

test('bind: loopback only unless AREG_BIND is set', () => {
  assert.equal(bindHost({}), '127.0.0.1');
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /loopback only/);
  assert.equal(assertBindAllowed('127.0.0.1', {}), '127.0.0.1');
  assert.equal(assertBindAllowed('0.0.0.0', { AREG_BIND: '0.0.0.0' }), '0.0.0.0');
});

test('ports: 5010-5049 only, never a reserved or another agent\'s one', () => {
  assert.equal(portProblem(5010), null); assert.equal(portProblem(5049), null);
  for (const p of [5000, 5009, 5050, 8080, 5173, 3900, 4000, 4400, 4510, 4600, 4601, 4840, 18080, 19080, 19090, 4771, 4700]) assert.ok(portProblem(p), String(p));
  assert.ok(portProblem(NaN));
  assert.equal(resolvePort({}), 5010);
  assert.equal(resolvePort({ PORT: '5020' }), 5020);
  assert.throws(() => resolvePort({ PORT: '5000' }));
  assert.throws(() => resolvePort({ PORT: '5050' }));
});

test('reserved hosts and the host scan', () => {
  assert.ok(isReservedHost('a.b.invalid')); assert.ok(isReservedHost('example.com')); assert.ok(!isReservedHost('sub.example.com'));
  assert.deepEqual(scanHosts('https://as.example.invalid/x and mail a@example.org and http://localhost:5010/'), []);
  assert.deepEqual(scanHosts('see https://real.com/x and 10.1.2.3'), ['10.1.2.3', 'real.com']);
});

test('key scan: only sk-MOCK- values are allowed in shipped text', () => {
  assert.deepEqual(scanKeys('sk-MOCK-ABCDEF and sk-MOCK-REAL-UPSTREAM-PLACEHOLDER'), []);
  assert.equal(scanKeys('key sk-proj-abcdefghijklmnop1234').length, 1);
  assert.equal(scanKeys('sk-ant-api03-abcdefghijkl').length, 1);
});

test('cleanText strips control and bidi characters and caps the length', () => {
  assert.equal(cleanText('a\u0000b\nc‮d', 80), 'a b c d');
  assert.equal(cleanText('x'.repeat(100), 10).length, 10);
  assert.equal(cleanText(undefined), '');
});

const run = (mw, req) => { const out = {}; const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } }; mw(req, res, () => { out.next = true; }); return out; };

test('hostCheck refuses a non-loopback Host (DNS rebinding)', () => {
  assert.ok(run(hostCheck, { headers: { host: 'localhost:5010' } }).next);
  assert.ok(run(hostCheck, { headers: { host: '[::1]:5010' } }).next);
  assert.equal(run(hostCheck, { headers: { host: 'evil.example.invalid:5010' } }).status, 403);
  assert.equal(run(hostCheck, { headers: {} }).status, 403);
});

test('sameOriginWrites: GET passes, cross-origin and cross-site writes refused', () => {
  const h = { host: 'localhost:5010' };
  assert.ok(run(sameOriginWrites, { method: 'GET', headers: { ...h, origin: 'http://evil.example.invalid' } }).next);
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: h }).next, 'no Origin (curl) is allowed');
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'http://localhost:5010' } }).next);
  assert.equal(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'http://localhost:9999' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'null' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'DELETE', headers: { ...h, 'sec-fetch-site': 'cross-site' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'PUT', headers: { ...h, 'sec-fetch-site': 'same-site' } }).status, 403);
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: { ...h, 'sec-fetch-site': 'same-origin' } }).next);
});

// LAB_ALLOWED_HOSTS: the lab-proxy sends Host: <this app's name> and, for API calls, X-Forwarded-Host/-Proto; the browser's Origin is the proxy's.
const LAB = 'areg.lab.example';
const PROXY = 'proxy.example:8443';
const via = (over = {}) => ({ host: `${LAB}:5010`, origin: `https://${PROXY}`, 'x-forwarded-host': PROXY, 'x-forwarded-proto': 'https', ...over });
const allowed = allowedHostsFrom({ LAB_ALLOWED_HOSTS: ` ${LAB.toUpperCase()}, second.lab.example ` });

test('LAB_ALLOWED_HOSTS: names are trimmed and lower-cased, unset is empty, an invalid name throws', () => {
  assert.deepEqual([...allowed].sort(), [LAB, 'second.lab.example']);
  assert.equal(allowedHostsFrom({}).size, 0);
  assert.equal(allowedHostsFrom({ LAB_ALLOWED_HOSTS: '' }).size, 0);
  for (const bad of ['good.example,bad name', 'http://x.example', 'x.example:8443', '-x.example', 'x..example', 'a_b.example', 'x.example/']) {
    assert.throws(() => allowedHostsFrom({ LAB_ALLOWED_HOSTS: bad }), /LAB_ALLOWED_HOSTS: not a host name/, bad);
  }
});

test('Host check with LAB_ALLOWED_HOSTS: listed names pass with or without a port in any case, loopback still passes, tricks are refused', () => {
  const check = makeHostCheck(allowed);
  for (const host of [LAB, `${LAB}:5010`, 'AREG.Lab.Example:8443', 'second.lab.example', 'localhost:5010', '127.0.0.1']) assert.ok(run(check, { headers: { host } }).next, host);
  for (const host of [`${LAB}.evil.example`, `evil.${LAB}`, `x${LAB}`, 'lab.example', 'third.lab.example', `${LAB}@evil.example`, `${LAB}:abc:5010`]) assert.equal(run(check, { headers: { host } }).status, 403, host);
  assert.equal(run(check, { headers: {} }).status, 403);
  // unset = loopback only
  assert.equal(run(makeHostCheck(), { headers: { host: LAB } }).status, 403);
  assert.equal(run(hostCheck, { headers: { host: LAB } }).status, 403);
});

test('proxied write: accepted for a listed Host with a matching forwarded host and scheme', () => {
  const w = makeSameOriginWrites(allowed);
  assert.ok(run(w, { method: 'POST', headers: via() }).next);
  assert.ok(run(w, { method: 'DELETE', headers: via({ host: LAB.toUpperCase() }) }).next, 'Host case does not matter');
  assert.ok(run(w, { method: 'POST', headers: via({ 'x-forwarded-proto': undefined }) }).next, 'the scheme defaults to https');
  assert.ok(run(w, { method: 'POST', headers: via({ origin: 'http://proxy.example', 'x-forwarded-host': 'proxy.example', 'x-forwarded-proto': 'http' }) }).next);
});

test('proxied write: refused for a foreign origin, a forwarded host mismatch, the wrong scheme, cross-site and a missing forwarded host', () => {
  const w = makeSameOriginWrites(allowed);
  const cases = {
    'foreign origin': via({ origin: 'https://evil.example' }),
    'forwarded host mismatch': via({ 'x-forwarded-host': 'other.example:8443' }),
    'https origin, http forwarded': via({ 'x-forwarded-proto': 'http' }),
    'http origin, https default': via({ origin: `http://${PROXY}`, 'x-forwarded-proto': undefined }),
    'unknown scheme': via({ origin: `ftp://${PROXY}`, 'x-forwarded-proto': 'ftp' }),
    'no forwarded host': via({ 'x-forwarded-host': undefined }),
    'cross-site': via({ 'sec-fetch-site': 'cross-site' }),
    'same-site': via({ 'sec-fetch-site': 'same-site' }),
  };
  for (const [name, headers] of Object.entries(cases)) assert.equal(run(w, { method: 'POST', headers }).status, 403, name);
});

test('forwarded headers are ignored on a loopback Host, on a Host that is not listed, and when LAB_ALLOWED_HOSTS is unset', () => {
  const w = makeSameOriginWrites(allowed);
  for (const host of ['localhost:5010', '127.0.0.1:5010', '[::1]:5010', 'other.lab.example']) assert.equal(run(w, { method: 'POST', headers: via({ host }) }).status, 403, host);
  assert.equal(run(makeSameOriginWrites(), { method: 'POST', headers: via() }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'POST', headers: via({ host: 'localhost:5010' }) }).status, 403);
});

test('an invalid LAB_ALLOWED_HOSTS stops the start before anything listens', () => {
  const r = spawnSync(process.execPath, ['src/index.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: '5049', AREG_BIND: '', LAB_ALLOWED_HOSTS: 'good.example,bad name' }, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /LAB_ALLOWED_HOSTS: not a host name: bad name/);
  assert.doesNotMatch(r.stdout, /mock Agent Registry/);
});
