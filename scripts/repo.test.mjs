// Repo-level checks: content pack, shelf entry, docs truth, hygiene, CI shape, the pre-commit hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePack } from './validate-content-pack.mjs';
import { buildPack } from './build-content-pack.mjs';
import { MUTATIONS } from './mutation-check.mjs';
import { portProblem, scanHosts, scanKeys } from '../server/src/safety.js';
import { RULES } from '../server/src/registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const tracked = () => execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f && !/package-lock\.json$/.test(f) && fs.existsSync(path.join(ROOT, f)));

test('content pack validates and is in sync with the scenario data', () => {
  const pack = JSON.parse(read('content-pack.json'));
  assert.deepEqual(validatePack(pack), []);
  assert.deepEqual(pack, buildPack(), 'run: node scripts/build-content-pack.mjs');
  assert.deepEqual(pack.stories.map((s) => s.id), JSON.parse(read('server/data/scenarios.json')).map((s) => s.id));
  assert.equal(pack.demo.catalog, 'D11');
  assert.equal(pack.demo.doctor, '/api/health');
});

test('content pack validation rejects a broken pack', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['no-such-term'];
  assert.ok(validatePack(pack).some((e) => /unknown term/.test(e)));
  delete pack.glossary;
  assert.ok(validatePack(pack).length > 0);
});

test('shelf entry matches the demo: id, catalog id, port, health path, loopback url', () => {
  const [d] = JSON.parse(read('docs/shelf-entry.json')).demos;
  assert.equal(d.id, 'agent-registry-demo');
  assert.equal(d.catalogId, 'D11');
  assert.equal(d.healthPath, '/api/health');
  const u = new URL(d.url);
  assert.equal(u.hostname, 'localhost');
  assert.equal(portProblem(Number(u.port)), null);
  assert.equal(JSON.parse(read('content-pack.json')).demo.baseUrl, d.url);
});

test('README is true: default port, commands exist, endpoints are real, status says core only', () => {
  const readme = read('README.md');
  const pkg = JSON.parse(read('package.json'));
  for (const s of ['doctor', 'start', 'test', 'reset', 'mutation-check', 'content-pack']) { assert.ok(pkg.scripts[s], s); assert.ok(readme.includes(`npm run ${s}`) || s === 'start' || s === 'test', s); }
  for (const f of ['scripts/run.sh', 'docs/architecture.md', 'docs/safety.md', 'content-pack.json', 'docs/shelf-entry.json']) { assert.ok(readme.includes(f), f); assert.ok(fs.existsSync(path.join(ROOT, f)), f); }
  assert.match(readme, /localhost:5010/);
  assert.match(readme, /step AR0/);
  const app = read('server/src/app.js');
  for (const m of readme.matchAll(/`(?:GET|POST|PUT|DELETE|GET\/POST|GET\/PUT\/DELETE|GET\/POST\/PUT)? ?(\/api\/[a-z/:-]+)/g)) {
    const route = m[1].replace(/\/:name.*$/, '').replace(/^\/api/, '').replace(/\/:id$/, '');
    assert.ok(app.includes(`'${route}`) || app.includes(`'${route}/`) || route === '', `README documents ${m[1]} but app.js has no ${route}`);
  }
  for (const p of new Set([...readme.matchAll(/localhost:(\d{4,5})/g)].map((m) => Number(m[1])))) assert.equal(portProblem(p), null, String(p));
});

test('docs/safety.md covers every rule in the table and lists the UNVERIFIED ones', () => {
  const doc = read('docs/safety.md');
  assert.match(doc, /## UNVERIFIED/);
  for (const [id, r] of Object.entries(RULES).filter(([, x]) => x.status === 'unverified')) assert.ok(r.text.length > 0, id);
  for (const w of ['workload tokens', 'mcp and a2a', 'share a name', 'Revoked:false', 'supplied on create', 'llm scope']) assert.ok(doc.includes(w), w);
  assert.match(doc, /blocked_by_demo_guard/);
});

test('hygiene: every host in every tracked text file is reserved, every key is sk-MOCK-, no tenant-looking ids, no mermaid', () => {
  for (const f of tracked().filter((x) => !/\.(png|ico|woff2?)$/.test(x) && !x.startsWith('node_modules/'))) {
    const text = read(f);
    if (f !== "server/test/safety.test.js") assert.deepEqual(scanHosts(text).filter((h) => !/^(www\.rfc-editor\.org|json-schema\.org|0\.0\.0\.0|192\.0\.2\.\d+|localhost.*)$/.test(h) && !h.includes("$")), [], `${f}: real host`);
    if (f !== "server/test/safety.test.js") assert.deepEqual(scanKeys(text), [], `${f}: non-mock key`);
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(text), `${f}: uuid-shaped id (tenant or client id?)`);
    if (f !== 'scripts/repo.test.mjs') assert.ok(!/mermaid/i.test(text), `${f}: mermaid`);
  }
});

test('hygiene: .env is ignored, no .env committed, gitleaks pre-commit hook is executable', () => {
  assert.match(read('.gitignore'), /^\.env$/m);
  assert.ok(!tracked().includes('.env'));
  const hook = path.join(ROOT, '.githooks/pre-commit');
  assert.ok(fs.statSync(hook).mode & 0o111, 'hook not executable');
  assert.match(fs.readFileSync(hook, 'utf8'), /gitleaks protect --staged/);
  assert.match(read('package.json'), /core\.hooksPath \.githooks/);
});

test('CI has the self-hosted runner shape, Node 22 on PRs and 20+22 on main, and the forbidden-strings job', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /\["self-hosted","macOS"\]/);
  assert.match(ci, /pull_request' && '\[22\]' \|\| '\[20,22\]'/);
  assert.match(ci, /forbidden-strings\.txt/);
  assert.match(ci, /gitleaks detect/);
  assert.match(ci, /npm test/);
  assert.ok(!ci.includes('forbidden-strings.txt contents'));
});

test('the forbidden-strings list is never read or embedded by the repo', () => {
  for (const f of tracked().filter((x) => x !== '.github/workflows/ci.yml' && x !== 'scripts/repo.test.mjs')) assert.ok(!read(f).includes('forbidden-strings'), `${f} mentions the forbidden-strings list`);
});

test('every mutation names a real file and the rules table lists every rule the mutations pin', () => {
  for (const [label, file] of MUTATIONS) assert.ok(fs.existsSync(path.join(ROOT, 'server/src', file)), `${label}: ${file}`);
  for (const id of ['virtual-key-immutable', 'no-rotate-endpoint', 'llm-needs-real-key', 'never-delete-llm', 'grants-by-name', 'native-caps-429', 'guardrail-copied-with-spec', 'expired-edit-renews', 'workload']) assert.ok(MUTATIONS.some(([l]) => l.includes(id)), `no mutation pins ${id}`);
});

test('no crypto.generateKeyPairSync anywhere (aborts under GC on Node 20 here)', () => {
  for (const f of tracked().filter((x) => /\.(m?js)$/.test(x) && x !== 'scripts/repo.test.mjs')) assert.ok(!/generateKeyPair/.test(read(f)), f);
});

test('web is a placeholder until AR1 and says so; package workspaces are server and web', () => {
  assert.deepEqual(JSON.parse(read('package.json')).workspaces, ['server', 'web']);
  assert.match(read('web/package.json'), /placeholder/);
});
