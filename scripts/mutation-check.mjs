#!/usr/bin/env node
// Mutation pinning: break each real-behaviour rule in a throwaway copy of server/ and require the server tests to FAIL.
// A mutation that the tests survive means a rule is not pinned. Exits 1 if any mutant survives or a mutation did not apply.
//   node scripts/mutation-check.mjs [--only <label-substring>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MUTATIONS = [
  ['virtual-key-immutable: PUT can set VirtualKey', 'registry.js', "    Object.assign(k.spec, out);\n", "    Object.assign(k.spec, out); if ('VirtualKey' in spec) k.spec.VirtualKey = spec.VirtualKey;\n"],
  ['no-rotate-endpoint: an in-place rotate exists', 'registry.js', 'snapshot, rotateByReplacement,', 'snapshot, rotate: () => 1, rotateByReplacement,'],
  ['llm-needs-real-key: create without RealKey accepted', 'registry.js', "if (!spec.RealKey) return err(400, 'real_key_required'", "if (false) return err(400, 'real_key_required'"],
  ['real-key-never-returned: reads leak RealKey', 'registry.js', "spec: { ...clone(k.spec), RealKey: '' }", 'spec: { ...clone(k.spec), RealKey: k.realKey }'],
  ['put-preserves-real-key: PUT without RealKey wipes it', 'registry.js', ': k.realKey; // omitted', ": ''; // omitted"],
  ['never-delete-llm: guard removed', 'registry.js', "if (k.spec.Scopes.includes('llm') && (!heldRealKey", "if (false && (!heldRealKey"],
  ['revoke: also drops the key', 'registry.js', "if (!k.spec.Revoked) { k.spec.Revoked = true;", "if (!k.spec.Revoked) { k.spec.Revoked = true; keys.delete(name);"],
  ['rotate: old key revoked before it is verified', 'registry.js', "    const v = verify ? verify(succ)", "    revoke(name);\n    const v = verify ? verify(succ)"],
  ['rotate: old key deleted instead of revoked', 'registry.js', "    revoke(name);\n    step('revoke-old'", "    keys.delete(name);\n    step('revoke-old'"],
  ['guardrail-copied-with-spec: successor loses the guardrail', 'registry.js', 'const spec = { ...snap.spec };', 'const spec = { ...snap.spec }; delete spec.Guardrail;'],
  ['caps copied: successor loses the caps', 'registry.js', 'const spec = { ...snap.spec };', 'const spec = { ...snap.spec }; delete spec.RPMLimit;'],
  ['expired-edit-renews: expiry never computed', 'registry.js', "return 'expired';", "return 'active';"],
  ['duplicate names accepted', 'registry.js', "if (keys.has(name)) return err(409", "if (false) return err(409"],
  ['workload: audience not required', 'registry.js', "if (!w.Audience) p.push(", "if (false) p.push("],
  ['grants-by-name: grant bound to the key incarnation, not the name', 'grants.js', "x.keyName === keyName && x.app === app);\n    if (!g)", "x.keyName === keyName && x.app === app && x.forIncarnation === registry.incarnationOf(keyName));\n    if (!g)"],
  ['grants-by-name: deleting a key cascades to its grants', 'world.js', "  const gateway = createGateway(", "  const _del = registry.del; registry.del = (n, o) => { const r = _del(n, o); if (r.status === 200) grants.list().filter((g) => g.keyName === n).forEach((g) => grants.remove(g.id)); return r; };\n  const gateway = createGateway("],
  ['grants: inherited trap not reported', 'grants.js', "else if (inc !== g.forIncarnation)", "else if (false)"],
  ['native-caps-429: rpm off by one', 'gateway.js', 'u.calls.length >= rpm', 'u.calls.length >= rpm + 1'],
  ['native-caps-429: tpm not enforced', 'gateway.js', "else if (tpm && u.tokens", "else if (false && u.tokens"],
  ['gateway: revoked key still accepted', 'gateway.js', "if (st !== 'active') return unauthorized", "if (st === 'expired') return unauthorized"],
  ['gateway: expired key still accepted', 'gateway.js', "if (st !== 'active') return unauthorized", "if (st === 'revoked') return unauthorized"],
  ['gateway: scope check removed', 'gateway.js', "if (!entry.spec.Scopes.includes(kind))", "if (false)"],
  ['gateway: grant check removed', 'gateway.js', "if (!g.ok) {", "if (false) {"],
  ['gateway: 401 explains why on the wire', 'gateway.js', "const unauthorized = (why) => {\n      log.push(`auth: rejected (${why})`);", "const unauthorized = (why) => {\n      log.push(`auth: rejected (${why})`); return finish(401, { error: why });"],
  ['workload: audience not checked', 'gateway.js', "w.Audience === c.aud && ", ""],
  ['workload: lifetime cap not checked', 'gateway.js', "c.exp - c.iat > (w.MaxTokenLifetimeSec || 3600)", "c.exp - c.iat > 1e9"],
  ['trace: keys not masked', 'trace.js', "return String(text).replace(/sk-MOCK-", "return String(text); /* off */ String(text).replace(/sk-MOCK-"],
  ['safety: cross-site writes allowed', 'safety.js', "if (site && site !== 'same-origin' && site !== 'none')", 'if (false)'],
  ['safety: Host check removed', 'safety.js', "if (!(isLoopbackHost(host) || allowed.has(host.toLowerCase()))) return res.status(403).json({ error: 'bad_host'", "if (false) return res.status(403).json({ error: 'bad_host'"],
  ['safety: allowlist ignored on the Host check', 'safety.js', "isLoopbackHost(host) || allowed.has(host.toLowerCase())", "isLoopbackHost(host)"],
  ['safety: forwarded headers believed on any Host', 'safety.js', "const proxied = allowed.has(hostNameOf(String(req.headers.host || '')).toLowerCase()) && xfh", "const proxied = xfh"],
  ['safety: port range widened', 'safety.js', 'port < PORT_MIN || port > PORT_MAX', 'false'],
  ['netguard: fetch not guarded', 'netguard.js', "if (!isLoopbackHost(url.hostname)) { attempts.push(`fetch:", "if (false) { attempts.push(`fetch:"],
  ['runner: scenario outcomes not checked', 'runner.js', "if (exp.status !== undefined && out.status !== exp.status)", "if (false)"],
];

function run(label, file, from, to, only) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'areg-mut-'));
  try {
    fs.cpSync(path.join(ROOT, 'server'), path.join(dir, 'server'), { recursive: true, filter: (s) => !s.includes('node_modules') });
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
    const target = path.join(dir, 'server/src', file);
    const src = fs.readFileSync(target, 'utf8');
    const n = src.split(from).length - 1;
    if (n !== 1) return { label, status: 'NOT-APPLIED', detail: `pattern occurs ${n} times in ${file}` };
    fs.writeFileSync(target, src.replace(from, () => to));
    const r = spawnSync(process.execPath, ['--test', ...fs.readdirSync(path.join(dir, 'server/test')).filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`)], { cwd: path.join(dir, 'server'), encoding: 'utf8', timeout: 120000 });
    return { label, status: r.status === 0 ? 'SURVIVED' : 'killed', detail: '' };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--only');
  const only = i > 0 ? process.argv[i + 1] : '';
  const results = MUTATIONS.filter(([l]) => l.includes(only)).map(([l, f, a, b]) => run(l, f, a, b));
  for (const r of results) console.log(`${r.status.padEnd(11)} ${r.label}${r.detail ? ` (${r.detail})` : ''}`);
  const bad = results.filter((r) => r.status !== 'killed');
  console.log(`\n${results.length - bad.length}/${results.length} mutants killed`);
  process.exit(bad.length ? 1 : 0);
}
