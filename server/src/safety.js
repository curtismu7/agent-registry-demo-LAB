// Safety rules. Pure functions plus two tiny middlewares. No I/O.
//  1. Loopback bind only unless AREG_BIND is set on purpose.
//  2. Host header must be a loopback name (DNS-rebinding defence), or a name in LAB_ALLOWED_HOSTS (the lab-proxy's name for this app).
//  3. A write must be same-origin: a cross-origin Origin, or a cross-site Sec-Fetch-Site, is refused. Behind the lab-proxy the
//     Origin is the proxy's public origin, accepted only when the Host is a LAB_ALLOWED_HOSTS name and X-Forwarded-Host/-Proto agree.
//  4. Every host in any shipped text is reserved (.invalid / .example / apex of example.com|net|org).
//  5. Ports are 5010-5049 and never one of the forbidden ones.
//  6. Every key-looking string is an obviously fake sk-MOCK- value.

export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

export function bindHost(env = process.env) { return env.AREG_BIND || '127.0.0.1'; }

export function assertBindAllowed(host, env = process.env) {
  if (isLoopbackHost(host) || env.AREG_BIND) return host;
  throw new Error(`refusing to bind ${host}: loopback only. Set AREG_BIND to opt in.`);
}

export const PORT_MIN = 5010;
export const PORT_MAX = 5049;
export const DEFAULT_PORT = 5010;
const FORBIDDEN_PORTS = new Set([8080, 5173, 3900, 4000, 4400, 4510, 4600, 4601, 4840, 18080, 19080, 19090]);
export function portProblem(port) {
  if (!Number.isInteger(port)) return 'PORT is not an integer';
  if (FORBIDDEN_PORTS.has(port)) return `port ${port} is reserved for something else`;
  if (port < PORT_MIN || port > PORT_MAX) return `port ${port} is outside ${PORT_MIN}-${PORT_MAX}`;
  return null;
}
export function resolvePort(env = process.env) {
  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  if (problem) throw new Error(problem);
  return port;
}

export function isReservedHost(host) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  return /(^|\.)(invalid|example)$/.test(h) || /^example\.(com|net|org)$/.test(h);
}

const NETWORK_URL = /\b(?:https?|wss?|ftp|sftp|ssh|smtp|tcp|udp):\/\/([^\s/?#"'<>\\]+)/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const stripAuthority = (a) => a.replace(/^[^@]*@/, '').replace(/:\d+$/, '');

// Every hostname or IP in text that is not reserved. Loopback names in URLs are allowed. Empty = clean.
export function scanHosts(text) {
  const found = new Set();
  const s = String(text);
  for (const m of s.matchAll(NETWORK_URL)) found.add(stripAuthority(m[1]).toLowerCase());
  for (const m of s.matchAll(EMAIL)) found.add(m[1].toLowerCase());
  for (const m of s.matchAll(IPV4)) found.add(m[0]);
  return [...found].filter((h) => !isReservedHost(h) && !isLoopbackHost(h)).sort();
}

// Any "sk-" secret that is not an obviously fake sk-MOCK- value. Empty = clean.
export function scanKeys(text) {
  return [...String(text).matchAll(/\bsk-(?!MOCK-)[A-Za-z0-9_-]{8,}/g)].map((m) => `${m[0].slice(0, 8)}...`);
}

// Free text from a caller (custodian, description): control characters stripped, length capped. Rendered as text, never as markup.
export function cleanText(value, max = 80) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').trim().slice(0, max);
}

// Extra Host names this app answers to (family standard): LAB_ALLOWED_HOSTS, comma separated host names that point at this Mac,
// such as the lab-proxy's agent-registry-demo.local.ping-devops.com. Loopback always works; unset = loopback only.
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
export function allowedHostsFrom(env = process.env) {
  const names = String(env.LAB_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  for (const h of names) if (!HOSTNAME.test(h)) throw new Error(`LAB_ALLOWED_HOSTS: not a host name: ${h}`);
  return new Set(names);
}

const hostNameOf = (raw) => (raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.replace(/:\d+$/, ''));

export const makeHostCheck = (allowed = new Set()) => function hostCheck(req, res, next) {
  const host = hostNameOf(String(req.headers.host || ''));
  if (!(isLoopbackHost(host) || allowed.has(host.toLowerCase()))) return res.status(403).json({ error: 'bad_host', message: 'Host must be a loopback name' });
  next();
};
export const hostCheck = makeHostCheck();

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const makeSameOriginWrites = (allowed = new Set()) => function sameOriginWrites(req, res, next) {
  if (!WRITE.has(req.method)) return next();
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === req.headers.host; } catch { /* malformed */ }
    // Behind the lab-proxy the browser's origin is the proxy's public one (local.ping-devops.com:8443) while Host is this app's own name. The proxy sets
    // X-Forwarded-Host/-Proto; they are believed only when Host is one of the allowed names (loopback does not count), so a request
    // that did not come through the proxy cannot use them.
    const xfh = String(req.headers['x-forwarded-host'] || '').toLowerCase();
    const xfp = String(req.headers['x-forwarded-proto'] || 'https').toLowerCase();
    const proxied = allowed.has(hostNameOf(String(req.headers.host || '')).toLowerCase()) && xfh !== '' && (xfp === 'https' || xfp === 'http') && origin === `${xfp}://${xfh}`;
    if (!ok && !proxied) return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
  }
  next();
};
export const sameOriginWrites = makeSameOriginWrites();
