# CLAUDE.md: Agent Registry Lifecycle LAB

Tier: Demo. The life of a non-human identity (an AI agent) in an Agent Registry: register, grant, rotate, retire, and the gateway's 401/403/429 refusals. Everything is a mock: an in-process registry simulator and a tiny mock gateway in one Node process, no tenant, no credential, no outbound network (netguard with a self-test). Node 26, Express server (`server/`), React + Vite page (`web/`), loopback only. Repo: https://github.com/curtismu7/agent-registry-demo-LAB. Read `README.md` first; the rulebook is `~/Development/STANDALONE-RULES.md` (skill `standalone-demo`).

## Run and test
- `npm ci`, `npm test`, `npm run doctor`, `npm start` (port 5010 host-run). Docker: `HOST_PORT=5010 docker compose up --build -d`, publishes `127.0.0.1` only.
- Run suites on the Air (`air-test`), not on this Mac.
- `GET /api/health` answers `demo-health/1` for the shelf.

## Rules that bite
- Mock only: no real tenant, no outbound network, loopback bind, Host check, same-origin writes. Keys are fake `sk-MOCK-...` values, shown raw (education).
- `web/src/standalone-ui.css` is the vendored shared stylesheet (AI-DEMO-Standalone canonical). Do not edit it; app CSS uses its tokens only. UI patterns: `AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md`; check with that repo's `scripts/check-ui-patterns.sh`.
- The secrets gate (a CI job with the owner's secret) fails on a string from the owner's list. No identifiers from other projects; `.example` hosts only.
- Node 26 only. CI is GitHub-hosted. Docker is OrbStack, never Docker Desktop.
- Never edit the shared `~/Development/AI-DEMO2` checkout; it is a read-only source.
- Do not use `crypto.generateKeyPairSync('ec')` or async EC `generateKeyPair` (SIGABRT on Node 20 CI); use `createECDH` + `createPrivateKey`.
- No AI attribution anywhere (owner, 2026-11-07): no Co-Authored-By trailer and no "Generated with" line in commits, PR bodies or files; CI runs `scripts/check-no-ai-attribution.sh`.
- What Privilege did (Rule 25, owner 2026-11-15): the shared `GatewayTrace` draws each gateway call under the Gateway tab result and under each `call` step of a Lifecycle story (Mock, from `gw` beside the unchanged text `trace`, built in `server/src/gateway.js` with `mockTrace`; every decision is `checked`, unreached ones `skipped`) and, in Real, `RealGatewayTrace.jsx` runs `POST /api/gateway-check` on a button and draws `traces` (built with `traceFromDoor` from the shared hop's `capture: true`; decisions only `inferred` or `observed`, key shown as its length). The panel and `server/src/gatewayTrace.js` are vendored byte for byte from AI-DEMO-Standalone `shared/gateway-trace/`, pinned by `web/src/gateway-trace/gateway-trace.sha256` and `scripts/gateway-trace.test.mjs`, and never edited here (`trace.js` stays the W3C traceparent helper). Registry admin calls are the Agent Registry simulation, not gateway calls, so they have no panel.

## Shelf
`docs/shelf-entry.json` registers this app. Run the parent's `scripts/check-drift.sh <this clone>` before a PR.
