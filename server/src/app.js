// One Express app. /api = the demo API: the live mock registry (keys, grants), the mock gateway, a virtual clock, scenario runs.
// Loopback Host check and same-origin writes on everything. Serves web/dist when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites, scanHosts, scanKeys } from './safety.js';
import { createHealth } from './health.js';
import { createWorld, rotateSafely } from './world.js';
import { RULES, SCOPES } from './registry.js';
import { runScenario, runAll } from './runner.js';
import { SCENARIOS, VERTICALS, getScenario, getVertical, storyCorpus, renderScenario } from './stories.js';

const WEB_DIST = process.env.WEB_DIST || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const bad = (res, message, status = 400) => res.status(status).json({ error: status === 404 ? 'not_found' : 'bad_request', message });
const MAX_ADVANCE_S = 10 * 365 * 86400;

export function createApp({ health = createHealth(), world: initialWorld = createWorld({ start: Date.now() }) } = {}) {
  let world = initialWorld; // POST /api/reset swaps in a fresh one
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '8kb' }));
  api.use('/health', health.router);
  const send = (res, out) => res.status(out.status).json({ response: out.body, notes: out.notes || [] });

  api.get('/catalog', (req, res) => {
    const v = getVertical(req.query.vertical || VERTICALS[0].id);
    if (!v) return bad(res, 'unknown vertical');
    res.json({
      verticals: VERTICALS.map(({ id, name, cast }) => ({ id, name, cast })),
      vertical: v.id, scopes: SCOPES, rules: RULES,
      scenarios: SCENARIOS.map((s) => { const r = renderScenario(s, v); return { id: r.id, slug: r.slug, kind: r.kind, title: r.title, takeaway: r.takeaway, expectedOutcome: r.outcome, rules: r.rules, steps: r.steps.length }; }),
    });
  });
  api.post('/run', (req, res) => {
    const { scenario, vertical = VERTICALS[0].id } = req.body || {};
    if (typeof scenario !== 'string' || !getScenario(scenario)) return bad(res, 'scenario must be a known id or slug');
    if (typeof vertical !== 'string' || !getVertical(vertical)) return bad(res, 'unknown vertical');
    res.json(runScenario(scenario, vertical));
  });
  api.post('/run-all', (req, res) => {
    const { vertical = VERTICALS[0].id } = req.body || {};
    if (typeof vertical !== 'string' || !getVertical(vertical)) return bad(res, 'unknown vertical');
    const results = runAll(vertical);
    res.json({ vertical, total: results.length, passed: results.filter((r) => r.pass).length, results });
  });

  // The live mock registry. Same rules as the stories use.
  api.get('/registry/keys', (_req, res) => send(res, world.registry.list()));
  api.post('/registry/keys', (req, res) => send(res, world.registry.create(req.body)));
  api.get('/registry/keys/:name', (req, res) => send(res, world.registry.get(req.params.name)));
  api.put('/registry/keys/:name', (req, res) => send(res, world.registry.update(req.params.name, req.body)));
  api.post('/registry/keys/:name/revoke', (req, res) => send(res, world.registry.revoke(req.params.name)));
  api.delete('/registry/keys/:name', (req, res) => send(res, world.registry.del(req.params.name, { heldRealKey: (req.body || {}).heldRealKey })));
  api.post('/registry/keys/:name/rotate', (req, res) => {
    const { successorName, realKey } = req.body || {};
    send(res, rotateSafely(world, req.params.name, { successorName, realKey }));
  });
  api.get('/registry/grants', (_req, res) => res.json({ items: world.grants.list(), warnings: world.grants.warnings() }));
  api.post('/registry/grants', (req, res) => send(res, world.grants.grant(req.body || {})));
  api.delete('/registry/grants/:id', (req, res) => send(res, world.grants.remove(req.params.id)));
  api.get('/events', (_req, res) => res.json({ items: world.registry.events() }));

  // The mock gateway and its virtual clock. The gateway's own status is data here, so the HTTP status is always 200.
  api.post('/gateway/call', (req, res) => {
    const b = req.body || {};
    const cred = b.credential || {};
    let credential = cred;
    if (cred.type === 'workload') {
      const c = cred.claims || {};
      const t = Math.floor(world.clock.now() / 1000);
      credential = { type: 'workload', claims: { iss: c.iss, aud: c.aud, sub: c.sub, iat: c.iat ?? t, exp: c.exp ?? t + (Number.isFinite(c.lifetime) ? c.lifetime : 300) } };
    } else if (cred.type !== 'bearer') return bad(res, 'credential.type must be bearer or workload');
    res.json(world.gateway.evaluate({ credential, route: b.route, traceparent: b.traceparent, tokens: b.tokens, costUsd: b.costUsd }));
  });
  api.get('/clock', (_req, res) => res.json({ now: new Date(world.clock.now()).toISOString(), virtual: true }));
  api.post('/clock/advance', (req, res) => {
    const s = (req.body || {}).seconds;
    if (!Number.isFinite(s) || s < 0 || s > MAX_ADVANCE_S) return bad(res, 'seconds must be a number between 0 and 10 years');
    world.clock.advance(s);
    res.json({ now: new Date(world.clock.now()).toISOString(), virtual: true });
  });

  // Reset: forget every key, grant, usage counter and event; the virtual clock starts again from the real time.
  api.post('/reset', (_req, res) => { world = createWorld({ start: Date.now() }); res.json({ ok: true, reset: 'mock registry, grants, gateway usage and events cleared' }); });
  api.get('/safety-scan', (_req, res) => {
    const offenders = storyCorpus().map(({ where, text }) => ({ where, hosts: scanHosts(text), keys: scanKeys(text) })).filter((x) => x.hosts.length || x.keys.length);
    res.json({ ok: offenders.length === 0, offenders });
  });
  api.use((_req, res) => bad(res, 'no such endpoint', 404));
  api.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
    if (err.type === 'entity.parse.failed') return bad(res, 'request body is not valid JSON');
    console.error('[agent-registry-demo] api error:', err.message);
    return res.status(500).json({ error: 'server_error' });
  });
  app.use('/api', api);

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
