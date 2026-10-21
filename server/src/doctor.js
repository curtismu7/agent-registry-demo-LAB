// Preflight checks shared by `npm run doctor` and GET /api/health. Never prints a secret, needs no network.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import { assertBindAllowed, bindHost, portProblem, scanHosts, scanKeys, DEFAULT_PORT, PORT_MIN, PORT_MAX } from './safety.js';
import { netguardSelfTest } from './netguard.js';
import { storyCorpus, VERTICALS, SCENARIOS, unfilledTokens } from './stories.js';
import { runAll } from './runner.js';

export async function runChecks({ env = process.env } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 20 ? 'pass' : 'fail', `v${process.versions.node} (need >= 20)`);

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.AREG_BIND ? ' (AREG_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  add('port-range', problem ? 'fail' : 'pass', problem || `${port} is inside ${PORT_MIN}-${PORT_MAX} and not reserved`);

  const corpus = storyCorpus();
  const badHosts = corpus.map(({ where, text }) => ({ where, hosts: scanHosts(text) })).filter((x) => x.hosts.length);
  add('story-hosts', badHosts.length ? 'fail' : 'pass', badHosts.length ? `non-reserved hosts: ${badHosts.map((b) => `${b.where}: ${b.hosts.join(', ')}`).join('; ')}` : 'every host in every story is .invalid, .example or loopback');
  const badKeys = corpus.map(({ where, text }) => ({ where, keys: scanKeys(text) })).filter((x) => x.keys.length);
  add('story-keys', badKeys.length ? 'fail' : 'pass', badKeys.length ? `key-looking values that are not sk-MOCK-: ${badKeys.map((b) => b.where).join(', ')}` : 'every key-looking value in every story is an obviously fake sk-MOCK- value');
  const holes = SCENARIOS.flatMap((s) => VERTICALS.flatMap((v) => unfilledTokens(s, v).map((t) => `${s.id}/${v.id}:${t}`)));
  add('story-tokens', holes.length ? 'fail' : 'pass', holes.length ? `unfilled {{tokens}}: ${holes.join(', ')}` : 'every {{cast}} token is filled in every vertical');

  const ng = await netguardSelfTest();
  add('netguard', ng.ok ? 'pass' : 'fail', ng.ok ? `blocked fetch, socket, socket-by-IP, dns lookup, dns resolve and udp to a non-loopback host (${ng.blocked}/6)` : ng.detail);

  try {
    const results = VERTICALS.flatMap((v) => runAll(v.id));
    const failed = results.filter((r) => !r.pass);
    add('scenarios', failed.length ? 'fail' : 'pass', failed.length ? `scenarios not behaving as written: ${failed.map((f) => f.id).join(', ')}` : `${results.length} scenario runs across ${VERTICALS.length} verticals all behave as written`);
  } catch (e) { add('scenarios', 'fail', e.message); }

  add('tenant', 'pass', 'mock only: no tenant, no credentials, no outbound network');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
