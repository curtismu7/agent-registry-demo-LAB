import http from 'node:http';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createWorld } from '../src/world.js';

export const ISO = (ms) => new Date(ms).toISOString();
export const FAKE_REAL = 'sk-MOCK-REAL-UPSTREAM-PLACEHOLDER';

export const mcpSpec = (over = {}) => ({ Scopes: ['mcp'], Custodian: 'Mark', NotAfter: '2027-10-21T12:00:00.000Z', ...over });
export const llmSpec = (over = {}) => ({ Scopes: ['llm'], Provider: 'anthropic', AllowedModels: ['m-small'], RealKey: FAKE_REAL, Custodian: 'Mark', ...over });

// A world with one registered, granted mcp key.
export function seeded({ name = 'travel-agent', spec = mcpSpec(), app = 'flights-mcp', tools = [] } = {}) {
  const w = createWorld();
  const c = w.registry.create({ name, spec });
  const g = w.grants.grant({ keyName: name, app, tools });
  return { w, vk: c.body.spec.VirtualKey, create: c, grant: g };
}
export const call = (w, vk, route, extra = {}) => w.gateway.evaluate({ credential: { type: 'bearer', value: vk }, route, ...extra });
export const mcp = (app = 'flights-mcp', tool = 'search') => ({ kind: 'mcp', app, tool });

export async function withServer(fn) {
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, world: createWorld() }) });
  try { await fn(url.replace(/\/$/, '')); } finally { health.stop(); await new Promise((r) => server.close(r)); }
}

// fetch cannot set Host; node:http can.
export function rawHttp(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, agent: false }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
