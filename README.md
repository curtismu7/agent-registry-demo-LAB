# Agent Registry Lifecycle demo (catalog D11)

Shows the life of a non-human identity, an AI agent, in an Agent Registry: **register** it (name, scopes, custodian, caps, expiry), **grant** it to a tool, **rotate** it safely, **retire** it, and watch the gateway refuse it (401, 403, 429).

Everything is a mock. An in-process registry simulator and a tiny mock gateway run inside one Node process. There is no tenant, no credential and no outbound network (a runtime netguard refuses and self-tests that). Every key is an obviously fake `sk-MOCK-...` value.

**Status: step AR0, core only.** The server, simulator, gateway, stories, doctor and tests are done. The React UI, diagram page, presenter mode and Docker packaging arrive in later steps (`web/` is a placeholder; `npm run build` prints that and succeeds).

## Run it

```sh
./scripts/run.sh          # installs if needed, runs the doctor, starts the server
```

Then open http://localhost:5010/api/health (there is no page yet). Port 5010 is the default; `PORT` must be 5010-5049. Copy `.env.example` to `.env` to change it. The server binds 127.0.0.1 only unless you set `AREG_BIND` on purpose.

```sh
npm test                  # server (node:test) + web placeholder + repo checks
npm run doctor            # preflight: node, bind, port, stories clean, netguard self-test, every scenario behaves
npm run reset             # forget every key, grant and event in a RUNNING server (loopback only)
npm run mutation-check    # break each rule on purpose and require the tests to fail
npm run content-pack      # validate content-pack.json (Learning Hub)
```

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
| S08 | Workload identity, no static secret | 200, wrong audience 401, over-long token 401 |
| S09 | Expiry and renewal | 401, then edit renews |

The real-behaviour rules the simulator encodes, and which are verified, a demo-added guard, or UNVERIFIED, are in [docs/safety.md](docs/safety.md). The mock never pretends in-place rotation exists.

## API (loopback, same-origin writes)

Responses from `/api/registry/*` are `{ "response": <wire body>, "notes": [...] }`; the notes are demo annotations, not part of the wire.

| Endpoint | What |
| --- | --- |
| `GET /api/health` | `demo-health/1` (public, no-store) |
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

Try it (server running):

```sh
curl -s -X POST http://localhost:5010/api/run -H 'content-type: application/json' -d '{"scenario":"S05","vertical":"travel"}'
```

## Not this demo

Runtime guardrail screening (AI Guard sidecar), kill switch and cost or rate cap enforcement, and the audit trail belong to separate demos (catalog D12, D14, D17). Here caps are registration attributes and the gateway only shows the refusal shape; the lifecycle event list is a small own list, not an audit product. `~/Development/privilege-demo` is the Cedar enforcement demo for human personas; nothing here imports it.

See [docs/architecture.md](docs/architecture.md), [docs/safety.md](docs/safety.md), `content-pack.json` and `docs/shelf-entry.json`.
