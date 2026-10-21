// A tiny mock gateway. evaluate() takes one call, decides 200/401/403/429 the way the measured gateway does, and returns the
// wire response plus a trace and the gateway-log lines that explain it. Time is virtual: the caller owns the clock.
//
//  routes:  /llm/<provider>/v1/chat/completions   scope llm
//           /<app>/mcp                             scope mcp (grant on the app, optionally per tool)
//           /<app>/a2a/jsonrpc                     scope a2a
//  order:   authenticate -> scope -> provider/model (llm) or grant (mcp, a2a) -> caps (llm only, measured there)
//  wire:    401 does not say why (unknown, revoked and expired look identical); the only self-describing refusal is the scope 403;
//           a bare 403 is explained only in the gateway log.
import { childTraceparent, rawRequest, rawResponse, envelope } from './trace.js';
import { cleanText } from './safety.js';

export const GATEWAY_HOST = 'gateway.example.invalid';
const ROUTES = { llm: (r) => `/llm/${r.provider}/v1/chat/completions`, mcp: (r) => `/${r.app}/mcp`, a2a: (r) => `/${r.app}/a2a/jsonrpc` };
const WINDOW_MS = 60_000;

export function createGateway({ registry, grants, now = () => Date.now() }) {
  const usage = new Map(); // key incarnation -> { calls: [ms], tokens: [[ms, n]], spendUsd }

  function evaluate(input = {}) {
    const cred = input.credential || {};
    const route = input.route || {};
    const kind = ['llm', 'mcp', 'a2a'].includes(route.kind) ? route.kind : null;
    const log = [];
    const notes = [];
    const traceparent = childTraceparent(input.traceparent);
    if (!kind) return invalid('route.kind must be llm, mcp or a2a');
    const app = cleanText(route.app, 60);
    const provider = cleanText(route.provider, 40);
    const model = cleanText(route.model, 80);
    const tool = cleanText(route.tool, 60);
    const path = ROUTES[kind]({ app, provider });
    const headers = { traceparent, 'content-type': 'application/json' };
    let body;
    if (kind === 'llm') body = { model, messages: [{ role: 'user', content: 'ping' }] };
    else if (kind === 'mcp') body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool || 'noop', arguments: {} } };
    else body = { jsonrpc: '2.0', id: 1, method: 'message/send', params: {} };
    if (cred.type === 'workload') {
      headers.authorization = 'Bearer mock-workload-token';
      headers['x-mock-workload-claims'] = JSON.stringify(cred.claims || {});
    } else headers.authorization = `Bearer ${cred.value || ''}`;
    const request = rawRequest({ method: 'POST', host: GATEWAY_HOST, path, headers, body });

    const finish = (status, resBody, extraHeaders = {}) => {
      const resHeaders = { 'content-type': typeof resBody === 'string' ? 'text/plain' : 'application/json', traceparent, ...extraHeaders };
      const response = rawResponse({ status, headers: resHeaders, body: resBody });
      return { status, headers: resHeaders, body: resBody, verdict: status === 200 ? 'allow' : 'deny', trace: envelope({ traceparent, request, response, log, notes }) };
    };
    const unauthorized = (why) => {
      log.push(`auth: rejected (${why})`);
      if (kind === 'llm') return finish(401, { error: { type: 'invalid_request_error', message: 'invalid virtual key' } });
      if (kind === 'mcp') return finish(401, 'Bearer token required', { 'www-authenticate': `Bearer resource_metadata="https://${GATEWAY_HOST}/.well-known/oauth-protected-resource/${app}/mcp"` });
      return finish(401, { error: 'unauthorized' });
    };
    function invalid(message) {
      return { status: 400, headers: {}, body: { error: 'bad_request', message }, verdict: 'deny', trace: envelope({ traceparent, request: '', response: '', log: [message] }) };
    }

    // 1. authenticate
    let name; let entry;
    if (cred.type === 'workload') {
      const c = cred.claims || {};
      const hit = registry.workloadKeys().find(({ k }) => {
        const w = k.spec.WorkloadIdentity;
        return w.Issuer === c.iss && w.Audience === c.aud && (w.AllowAnySubject || w.Subject === c.sub);
      });
      if (!hit) return unauthorized(`workload token rejected: no workload identity matches iss/aud/sub ${JSON.stringify({ iss: c.iss, aud: c.aud, sub: c.sub })}`);
      const w = hit.k.spec.WorkloadIdentity;
      const t = Math.floor(now() / 1000);
      if (!Number.isFinite(c.exp) || !Number.isFinite(c.iat)) return unauthorized('workload token rejected: exp and iat are required');
      if (c.exp <= t) return unauthorized('workload token rejected: token expired');
      if (c.exp - c.iat > (w.MaxTokenLifetimeSec || 3600)) return unauthorized(`workload token rejected: lifetime ${c.exp - c.iat}s exceeds MaxTokenLifetimeSec ${w.MaxTokenLifetimeSec || 3600}`);
      name = hit.name; entry = hit.k;
      log.push(`mcpgw: workload token accepted for key ${name} issuer=${c.iss} subject=${c.sub}`);
      notes.push('Workload-token acceptance on the real gateway is UNVERIFIED (rule workload-gateway-acceptance). Signature checking and JWKS fetching are not simulated.');
    } else {
      const found = registry.authenticate(cred.value);
      if (!found) return unauthorized('unknown key');
      name = found.name; entry = found.k;
    }
    const st = registry.stateOfEntry(entry);
    if (st !== 'active') return unauthorized(`key ${name} is ${st}`);

    // 2. scope: the one self-describing refusal
    if (!entry.spec.Scopes.includes(kind)) { log.push(`scope: key ${name} lacks ${kind}`); return finish(403, { error: `key not scoped for ${kind} access` }); }

    // 3. provider/model (llm) or grant (mcp, a2a)
    if (kind === 'llm') {
      if (entry.spec.Provider !== provider) { log.push(`provider: key ${name} is for ${entry.spec.Provider}, call is for ${provider}`); return finish(403, { error: { type: 'wrong_provider', message: 'key belongs to a different provider' } }); }
      if (entry.spec.AllowedModels.length && !entry.spec.AllowedModels.includes(model)) { log.push(`model: ${model} not on the allowlist of ${name}`); return finish(403, { error: `model "${model}" not allowed for this key` }); }
    } else {
      const g = grants.allowed(name, app, kind === 'mcp' ? tool : '');
      if (!g.ok) { log.push(`policy denied key=${name} app=${app}${tool ? ` tool=${tool}` : ''} (${g.reason})`); return finish(403, 'Forbidden'); }
      log.push(`policy allowed key=${name} app=${app}`);
    }

    // 4. caps (measured on llm routes only)
    if (kind === 'llm') {
      const u = usage.get(entry.id) || { calls: [], tokens: [], spendUsd: 0 };
      usage.set(entry.id, u);
      const t = now();
      u.calls = u.calls.filter((x) => t - x < WINDOW_MS);
      u.tokens = u.tokens.filter(([x]) => t - x < WINDOW_MS);
      const tokens = Number.isInteger(input.tokens) && input.tokens > 0 ? input.tokens : 1;
      const cost = Number.isFinite(input.costUsd) && input.costUsd > 0 ? input.costUsd : 0;
      const { RPMLimit: rpm, TPMLimit: tpm, BudgetUSD: budget } = entry.spec;
      let over = null; let retry = 60;
      if (rpm && u.calls.length >= rpm) { over = 'RPMLimit'; retry = Math.ceil((WINDOW_MS - (t - u.calls[0])) / 1000); }
      else if (tpm && u.tokens.reduce((s, [, n]) => s + n, 0) + tokens > tpm) { over = 'TPMLimit'; retry = Math.ceil((WINDOW_MS - (t - (u.tokens[0]?.[0] ?? t))) / 1000); }
      else if (budget && u.spendUsd + cost > budget) { over = 'BudgetUSD'; retry = 0; }
      if (over) { log.push(`caps: ${name} over ${over}`); return finish(429, { error: { type: 'tokens_rate_limit_exceeded', message: `${over} exceeded for this key` } }, retry ? { 'retry-after': String(Math.max(1, retry)) } : {}); }
      if (!input.probe) { u.calls.push(t); u.tokens.push([t, tokens]); u.spendUsd += cost; }
    }
    return finish(200, kind === 'llm' ? { id: 'mock-completion', choices: [{ message: { role: 'assistant', content: 'mock reply' } }] } : { jsonrpc: '2.0', id: 1, result: { ok: true, mock: true } });
  }

  return { evaluate, reset: () => usage.clear() };
}
