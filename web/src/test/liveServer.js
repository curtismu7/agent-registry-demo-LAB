// The real Express app (same code `npm start` runs) on an ephemeral loopback port, with fetch() pointed at it. No mocks of the registry:
// the UI under test talks to the real simulator and gateway, over real loopback HTTP. Writes carry a same-origin Origin header, as a browser would.
import { createApp, startHttpServer } from "../../../server/src/app.js";
import { createHealth } from "../../../server/src/health.js";
import { createWorld } from "../../../server/src/world.js";

const realFetch = globalThis.fetch;

export async function startLive(appOpts = {}) {
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: "127.0.0.1", app: createApp({ health, world: createWorld({ start: Date.UTC(2026, 9, 21, 12, 0, 0) }), ...appOpts }) });
  const base = url.replace(/\/$/, "");
  globalThis.fetch = (path, init = {}) => realFetch(`${base}${path}`, { ...init, headers: { origin: base, ...(init.headers || {}) } });
  const api = async (method, path, body) => {
    const r = await globalThis.fetch(path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  return { api, stop: async () => { globalThis.fetch = realFetch; health.stop(); await new Promise((r) => server.close(r)); } };
}

export const seedKey = (api, name = "travel-agent", extra = {}) => api("POST", "/api/registry/keys", { name, spec: { Scopes: ["mcp"], Custodian: "Mark", NotAfter: "2027-10-21T12:00:00.000Z", ...extra } });
