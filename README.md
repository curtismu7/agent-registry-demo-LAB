# Agent Registry Lifecycle LAB

Tier: Demo. Shows the life of a non-human identity, an AI agent, in an Agent Registry: **register** it (name, scopes, custodian, caps, expiry), **grant** it to a tool, **rotate** it safely, **retire** it, and watch the gateway refuse it (401, 403, 429).

Repo: https://github.com/ping-sandbox/agent-registry-demo-LAB

Everything is a mock. An in-process registry simulator and a tiny mock gateway run inside one Node process. There is no tenant, no credential and no outbound network (a runtime netguard refuses and self-tests that). Every key is an obviously fake `sk-MOCK-...` value.

**Status: step AR2, integration and docs.** Server, simulator, gateway, stories, doctor and tests, a React + Vite UI with five tabs (Registry, Lifecycle, Gateway, Diagram, Raw), a ReactFlow lifecycle diagram, presenter mode and dark/light, Docker packaging (loopback publish pinned by a test), Learning Hub content pack, shelf entry, talk track and an optional owner-run live-check guide.

## Run it

```sh
./scripts/run.sh          # installs if needed, runs the doctor, starts the server
```

Then open http://localhost:5010/ (health: http://localhost:5010/api/health). Port 5010 is the default; `PORT` must be 5010-5049. Copy `.env.example` to `.env` to change it. The server binds 127.0.0.1 only unless you set `AREG_BIND` on purpose.

```sh
npm test                  # server (node:test) + web (vitest, against the real server app) + repo checks
npm run doctor            # preflight: node, bind, port, stories clean, netguard self-test, every scenario behaves
npm run reset             # forget every key, grant and event in a RUNNING server (loopback only; if you used HOST_PORT=5019 with Docker, run PORT=5019 npm run reset)
npm run mutation-check    # break each rule on purpose and require the tests to fail
npm run content-pack      # validate content-pack.json (Learning Hub)
```

Note: the delete guard on llm keys (409 until you show the RealKey) is a demo guard; the real API would let you delete. See docs/safety.md.

## What it teaches

Nine stories (`server/data/scenarios.json`), each run in three verticals (Travel, Banking, Retail) by filling `{{cast}}` tokens from `server/data/verticals.json`:

| Id | Story | Outcome |
| --- | --- | --- |
| S01 | Register, grant, call | 200 |
| S02 | Revoke the agent | 401 |
| S03 | Scope too narrow; app never granted | 403 (named) and 403 (bare) |
| S04 | Per-key rate cap | 429 with retry-after |
| S05 | In-place rotation attempt (ignored) vs rotation by replacement | PUT 200 and nothing changes; replacement works |
| S06 | Delete an llm key without its RealKey | blocked, revoke instead |
| S07 | Delete and recreate under the same name | the new key inherits the old grants |
| S08 | Workload identity (now called Federated Identity), no static secret | 200, wrong audience 401, over-long token 401 |
| S09 | Expiry and renewal | 401, then edit renews |

The real-behaviour rules the simulator encodes, and which are verified, a demo-added guard, or UNVERIFIED, are in [docs/safety.md](docs/safety.md). The mock never pretends in-place rotation exists.

## API (loopback, same-origin writes)

Responses from `/api/registry/*` are `{ "response": <wire body>, "notes": [...] }`; the notes are demo annotations, not part of the wire.

| Endpoint | What |
| --- | --- |
| `GET /api/health` | `demo-health/1` (public, no-store) |
| `GET /api/info` | `{ source, realAvailable, realReason }`: the current mode and whether Real can be used |
| `POST /api/mode` `{source: "mock" \| "real"}` | switch Mock/Real at runtime (anything else 400; `real` 409) |
| `GET /api/catalog?vertical=` | verticals, scenarios, the rules table with status |
| `POST /api/run` `{scenario, vertical}` | run one story, returns every step with its trace |
| `POST /api/run-all` `{vertical}` | run all nine, pass/fail |
| `GET/POST /api/registry/keys` | list, create |
| `GET/PUT/DELETE /api/registry/keys/:name` | read, update (a PUT carrying a new VirtualKey returns 200 and is ignored), delete (llm keys blocked without `{heldRealKey}`) |
| `POST /api/registry/keys/:name/revoke` | revoke (the only non-destructive kill) |
| `POST /api/registry/keys/:name/rotate` `{successorName, realKey?}` | rotation by replacement: snapshot, create successor, copy grants, verify, revoke old |
| `GET/POST /api/registry/grants`, `DELETE /api/registry/grants/:id` | grants by key NAME; GET also returns inherited and dangling warnings |
| `POST /api/gateway/call` `{credential, route, tokens?, costUsd?}` | one call through the mock gateway; returns status, headers, body, trace |
| `GET /api/clock`, `POST /api/clock/advance` `{seconds}` | the virtual clock (nothing ever sleeps) |
| `GET /api/events` | the small lifecycle event list |
| `POST /api/reset` | clear all state |
| `GET /api/safety-scan` | host and key scan of every shipped story |

## Mock and Real

Every page header has a **Mock** / **Real** toggle (the pressed button is the current mode). This demo is **Mock only by design**: the registry and the gateway are in-process simulators, and the server calls nothing, so there is no real server for Real to use. `realAvailable` is always `false`, the **Real** button is disabled, and its tooltip says why.

- `GET /api/info` returns `{ source, realAvailable, realReason }`. `source` is `mock` here.
- `POST /api/mode` takes exactly `{ "source": "mock" | "real" }`: anything else is `400`; `real` is `409` (nothing real to call). Switching needs no restart and Mock makes no outbound request.
- The mode lives in memory, per app instance. After a successful switch the page refetches `/api/info`, the catalog and the registry data.
- No setting makes Real work. The tests use a test-only `createApp({ realAvailable: true })` seam (never read from the environment) to prove the switch goes both ways.

Try it (server running):

```sh
curl -s -X POST http://localhost:5010/api/run -H 'content-type: application/json' -d '{"scenario":"S05","vertical":"travel"}'
```

## Docker (OrbStack)

```sh
HOST_PORT=5010 docker compose up --build -d     # http://127.0.0.1:5010/  (HOST_PORT must be in 5010-5049)
docker compose down
```

The server listens on all interfaces inside the container (`AREG_BIND=0.0.0.0`, set in the Dockerfile on purpose) but `docker-compose.yml` publishes the port on `127.0.0.1` only, and `scripts/compose.test.mjs` pins that. The container is read-only, drops all capabilities and has a `demo-health/1` healthcheck.

## Reset

The Reset button in the UI, or `npm run reset` (`node scripts/reset.mjs [base-url]`, loopback only), forgets every key, grant and event and restarts the virtual clock. `POST /api/reset` is the endpoint behind both.

## Docs

- [docs/talk-track.md](docs/talk-track.md): ten-minute script for SEs.
- [docs/live-checks.md](docs/live-checks.md): optional, owner-run, read-only comparison with a real Privilege console. Instructions only; nothing here runs it.

## Not this demo

Runtime guardrail screening (AI Guard sidecar), kill switch and cost or rate cap enforcement, and the audit trail belong to separate demos (catalog D12, D14, D17). Here caps are registration attributes and the gateway only shows the refusal shape; the lifecycle event list is a small own list, not an audit product. `~/Development/privilege-demo` is the Cedar enforcement demo for human personas; nothing here imports it.

See [docs/architecture.md](docs/architecture.md), [docs/safety.md](docs/safety.md), `content-pack.json` and `docs/shelf-entry.json`.

## Web UI

`npm run build` then `npm start` serves the UI and API together at the loopback URL it prints (default port 5010). For hot reload run `npm start` and, in another terminal, `npm run dev -w web` (Vite on 5011, proxying /api). The banner "simulated registry, not the real product" is always visible, including in presenter mode.
