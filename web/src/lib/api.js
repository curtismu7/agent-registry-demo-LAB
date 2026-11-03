// Same origin only: every URL is a path. The mock registry answers with its refusals as normal responses (status + body),
// so call() never throws on 4xx; it throws only when the server cannot be reached.
export async function call(method, path, body) {
  const r = await fetch(path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}
async function must(method, path, body) {
  const { status, data } = await call(method, path, body);
  if (status >= 400) throw new Error(data.message || `HTTP ${status}`);
  return data;
}
export const getInfo = () => must("GET", "/api/info");
export const setMode = (source) => must("POST", "/api/mode", { source });
export const getCatalog = (vertical) => must("GET", `/api/catalog${vertical ? `?vertical=${encodeURIComponent(vertical)}` : ""}`);
export const runScenario = (scenario, vertical) => must("POST", "/api/run", { scenario, vertical });
export const resetServer = () => must("POST", "/api/reset");

export async function loadWorld() {
  const [keys, grants, events, clock] = await Promise.all([must("GET", "/api/registry/keys"), must("GET", "/api/registry/grants"), must("GET", "/api/events"), must("GET", "/api/clock")]);
  return { keys: keys.response.items, grants: grants.items, warnings: grants.warnings, events: events.items, now: clock.now };
}
// Registry writes: { status, response, notes }.
export const registryCall = async (method, path, body) => { const { status, data } = await call(method, path, body); return { status, response: data.response ?? data, notes: data.notes || [] }; };
export const advanceClock = (seconds) => must("POST", "/api/clock/advance", { seconds });
export const gatewayCall = (input) => must("POST", "/api/gateway/call", input);
