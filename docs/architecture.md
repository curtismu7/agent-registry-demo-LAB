# Architecture (step AR0)

One Node process (ESM, Express). No database, no network.

```
server/src
  registry.js   stateful Agent Registry simulator: keys, state, caps, expiry, snapshot, rotateByReplacement, events
  grants.js     grants by key NAME; dangling and inherited warnings
  gateway.js    mock gateway: authenticate -> scope -> provider/model or grant -> caps; 200/401/403/429 + trace + log
  world.js      virtual clock + registry + grants + gateway; rotateSafely (replacement with grants copied and a real probe call)
  trace.js      W3C traceparent, raw request/response, key masking
  stories.js    scenario and vertical data, {{cast}} rendering
  runner.js     executes a story against a fresh world, records steps and traces
  safety.js     loopback bind, Host check, same-origin writes, port range, host and key scans, cleanText
  netguard.js   refuses and records every non-loopback socket, DNS lookup, fetch and UDP send; self-tested
  doctor.js     the checks behind `npm run doctor` and GET /api/health
  health.js     demo-health/1
  app.js        /api routes; serves web/dist when it exists
server/data     scenarios.json, verticals.json (stories as data)
```

## Rotation by replacement

There is no rotate endpoint, so the helper does what an operator must do by hand:

1. `snapshot`: copy the full Spec (RealKey is not in it: reads never return it).
2. `create-successor`: new name (a duplicate name is refused: two keys sharing a name was never tested), new server-generated VirtualKey. An llm key needs the RealKey supplied again.
3. `copy-grants`: grants follow names, so the successor's grants are recreated.
4. `verify`: a probe call through the mock gateway must succeed (the probe does not consume cap). On failure the successor is revoked and the old key is untouched.
5. `revoke-old`: revoked, never deleted. Repoint consumers, confirm the old value gets 401, delete later.

## Virtual clock

Nothing sleeps. `world.clock.advance(seconds)` moves time; the gateway's rate windows and every expiry read the same clock. Story runs start at a fixed epoch so they repeat exactly; the live server's clock starts at the real time and moves only when `POST /api/clock/advance` says so.

## Trace envelope

Every gateway call and every registry operation in a story returns `{ traceparent, traceId, request, response, gatewayLog, notes }`. `traceparent` is W3C (`00-<32hex>-<16hex>-01`); a valid incoming one keeps its trace id and gets a new span. `request` and `response` are raw HTTP text with any `sk-MOCK-` value masked to its first and last four characters. `gatewayLog` is what the real gateway log would say and the wire does not (for example that a 401 was a revoked key). `notes` carry demo annotations such as "PUT carried a different VirtualKey: ignored".

## Planned

AR1 (done): React + Vite UI in web/ (tabs Registry, Lifecycle, Gateway, Diagram, Raw), ReactFlow lifecycle diagram (movable boxes, Simulate, Reset that restores positions and the simulation, speed control), presenter mode, theme tokens, dark and light, inert text rendering, keys masked in the UI. Web tests run the real Express app over loopback. AR2: Docker pin, Learning Hub wiring, shelf registration.
