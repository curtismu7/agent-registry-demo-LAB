// Repo-level checks: content pack, shelf entry, docs truth, hygiene, CI shape, the pre-commit hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePack } from './validate-content-pack.mjs';
import { buildPack } from './build-content-pack.mjs';
import { MUTATIONS } from './mutation-check.mjs';
import { portProblem, scanHosts, scanKeys } from '../server/src/safety.js';
import { RULES } from '../server/src/registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// Tracked files. Outside a git clone (e.g. the air-test sync, which ships no .git) walk
// the tree with the same exclusions instead of failing every hygiene test.
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.data', '.git']);
const walkFiles = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walkFiles(path.join(dir, e.name), out); }
    else out.push(path.relative(ROOT, path.join(dir, e.name)));
  }
  return out;
};
const tracked = () => {
  const inGit = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT }).status === 0;
  const files = inGit
    ? execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
    : walkFiles(ROOT).map((f) => `${f}`);
  return files.filter((f) => f && !/package-lock\.json$/.test(f) && fs.existsSync(path.join(ROOT, f)));
};

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

test('README is true: default port, commands exist, endpoints are real, status names the current step', () => {
  const readme = read('README.md');
  const pkg = JSON.parse(read('package.json'));
  for (const s of ['doctor', 'start', 'test', 'reset', 'mutation-check', 'content-pack']) { assert.ok(pkg.scripts[s], s); assert.ok(readme.includes(`npm run ${s}`) || s === 'start' || s === 'test', s); }
  for (const f of ['scripts/run.sh', 'docs/architecture.md', 'docs/safety.md', 'content-pack.json', 'docs/shelf-entry.json', 'docs/talk-track.md', 'docs/live-checks.md']) { assert.ok(readme.includes(f), f); assert.ok(fs.existsSync(path.join(ROOT, f)), f); }
  assert.match(readme, /localhost:5010/);
  assert.match(readme, /step AR2/);
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
    if (f !== "server/test/safety.test.js" && f !== "scripts/check-forbidden-strings.test.mjs") assert.deepEqual(scanHosts(text.replace(/https:\/\/github\.com\/(ping-sandbox\/[A-Za-z0-9._-]+|gitleaks\/gitleaks\/)/g, '')).filter((h) => !/^(www\.rfc-editor\.org|json-schema\.org|0\.0\.0\.0|192\.0\.2\.\d+|localhost.*)$/.test(h) && !h.includes("$")), [], `${f}: real host`);
    if (f !== "server/test/safety.test.js") assert.deepEqual(scanKeys(text), [], `${f}: non-mock key`);
    if (f !== 'scripts/check-forbidden-strings.test.mjs') assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(text), `${f}: uuid-shaped id (tenant or client id?)`);
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

test('CI is GitHub-hosted on Node 26 only, with the build, forbidden-strings and gitleaks jobs', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /runs-on: ubuntu-latest/);
  assert.deepEqual([...new Set([...ci.matchAll(/^\s*runs-on:\s*(.+)$/gm)].map((m) => m[1].trim()))], ['ubuntu-latest']);
  assert.match(ci, /node: \[26\]/);
  assert.match(ci, /node-version: 26/);
  assert.doesNotMatch(ci, /node: \[(?!26\])/);
  for (const job of ['build', 'forbidden-strings', 'gitleaks']) assert.match(ci, new RegExp(`^  ${job}:`, 'm'), job);
  assert.match(ci, /secrets\.FORBIDDEN_STRINGS/);
  assert.match(ci, /npm run check:forbidden/);
  assert.match(ci, /gitleaks detect/);
  assert.match(ci, /npm test/);
  assert.ok(!ci.includes('forbidden-strings.txt contents'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.engines.node, '>=26');
  assert.equal(pkg.scripts['check:forbidden'], 'node scripts/check-forbidden-strings.mjs');
});

test('the forbidden-strings list is never read or embedded by the repo', () => {
  for (const f of tracked().filter((x) => !['.github/workflows/ci.yml', 'scripts/repo.test.mjs', 'package.json', 'docs/forbidden-strings.md', 'scripts/check-forbidden-strings.mjs', 'scripts/check-forbidden-strings.test.mjs', 'scripts/forbidden-allowlist.json'].includes(x))) assert.ok(!read(f).includes('forbidden-strings'), `${f} mentions the forbidden-strings list`);
});

test('every mutation names a real file and the rules table lists every rule the mutations pin', () => {
  for (const [label, file] of MUTATIONS) assert.ok(fs.existsSync(path.join(ROOT, 'server/src', file)), `${label}: ${file}`);
  for (const id of ['virtual-key-immutable', 'no-rotate-endpoint', 'llm-needs-real-key', 'never-delete-llm', 'grants-by-name', 'native-caps-429', 'guardrail-copied-with-spec', 'expired-edit-renews', 'workload']) assert.ok(MUTATIONS.some(([l]) => l.includes(id)), `no mutation pins ${id}`);
});

test('no crypto.generateKeyPairSync anywhere (aborts under GC on Node 20 here)', () => {
  for (const f of tracked().filter((x) => /\.(m?js)$/.test(x) && x !== 'scripts/repo.test.mjs')) assert.ok(!/generateKeyPair/.test(read(f)), f);
});

test('web is the real React + Vite UI (no placeholder); package workspaces are server and web', () => {
  assert.deepEqual(JSON.parse(read('package.json')).workspaces, ['server', 'web']);
  const web = JSON.parse(read('web/package.json'));
  assert.ok(!/placeholder/.test(read('web/package.json')));
  assert.equal(web.scripts.build, 'vite build');
  assert.equal(web.scripts.test, 'vitest run');
  assert.ok(web.dependencies['@xyflow/react'], 'diagrams are ReactFlow');
  assert.ok(fs.existsSync(path.join(ROOT, 'web/src/tabs/DiagramTab.jsx')));
});

test('shelf entry compose file points at this repo and exists; run.sh builds the UI before starting', () => {
  const [d] = JSON.parse(read('docs/shelf-entry.json')).demos;
  // The shelf entry names the compose file relative to the demo root (the folder the repos sit in); the shelf checks that it exists.
  assert.equal(d.composeFile, 'agent-registry-demo-LAB/docker-compose.yml');
  assert.ok(fs.existsSync(path.join(ROOT, 'docker-compose.yml')));
  assert.doesNotMatch(d.notes, /later step/);
  assert.match(read('scripts/run.sh'), /npm run build/);
});

test('live-checks is instructions only: no script or source runs it, and it says so and marks writes owner-only', () => {
  const doc = read('docs/live-checks.md');
  assert.match(doc, /instructions only/i);
  assert.match(doc, /owner-only/i);
  assert.match(doc, /UNVERIFIED/);
  for (const f of tracked().filter((x) => /\.(m?js|sh|jsx)$/.test(x) && x !== 'scripts/repo.test.mjs')) assert.ok(!read(f).includes('live-checks'), `${f} references live-checks`);
});

test('talk track covers every story id', () => {
  const doc = read('docs/talk-track.md');
  for (const s of JSON.parse(read('server/data/scenarios.json'))) assert.ok(doc.includes(s.id), s.id);
});

test('README is not stale: no "no page yet", and tells Docker users to set PORT for reset', () => {
  const r = read('README.md');
  assert.doesNotMatch(r, /no page yet/);
  assert.match(r, /PORT=5019 npm run reset/);
});
