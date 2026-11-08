import { fileURLToPath } from 'node:url';
import { installNetguard } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { allowedHostsFrom, assertBindAllowed, bindHost, resolvePort } from './safety.js';

installNetguard(); // before anything else can open a socket

try { process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url))); } catch { /* no .env */ }

const allowedHosts = allowedHostsFrom(process.env); // before the health timer or any server starts: a bad name must leave nothing running

const checks = await runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[agent-registry-demo] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const host = assertBindAllowed(bindHost(), process.env);
const { url } = await startHttpServer({ port: resolvePort(), host, app: createApp({ allowedHosts }) });
console.log(`[agent-registry-demo] mock Agent Registry + gateway at ${url} (loopback, no outbound network)`);
console.log(`[agent-registry-demo] health: ${url}api/health | registry: ${url}api/registry/keys | gateway: POST ${url}api/gateway/call`);
