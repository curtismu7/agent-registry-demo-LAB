# Talk track for SEs

About ten minutes. Start the demo (`./scripts/run.sh`, then http://localhost:5010/), pick a vertical, and turn on Present if the room is large. Everything is a mock: say so once, early, and move on. The banner at the top says it too.

## The one-sentence point

"An AI agent is a non-human identity, so give it the same lifecycle you give a person: a named owner, the least scope it needs, an expiry, a grant to exactly one tool, a safe way to replace its credential, and a kill switch that works."

## Flow

1. **Set the scene (30 seconds).** Pick a vertical. "A custodian registers an agent. One key is the agent's whole identity: scopes, caps and expiry hang off it. The registry mints the key; nobody chooses it."
2. **Happy path, S01 (2 minutes).** Lifecycle tab, S01, Run, then Diagram: Simulate. Register, grant to one app and tool, call, 200. Point out that the grant names the key, not its value.
3. **Retire, S02 (1 minute).** "Revoke is the only non-destructive kill. Nothing is deleted, and the gateway answers 401 without saying why: a revoked key looks like an unknown one."
4. **Refusals, S03 and S04 (2 minutes).** 403 for a missing scope names itself; a bare 403 means the app was never granted (the reason is only in the gateway log). A per-key rate cap gives 429 with `retry-after`. "Caps are registration attributes here; enforcement is its own demo."
5. **Rotation, S05 (2 minutes).** The key point: there is no rotate button. Show the in-place attempt returning 200 and changing nothing, then rotation by replacement: snapshot, create the successor, verify it, then revoke the old one. "Never delete first."
6. **The traps, S06 and S07 (2 minutes).** S06: an llm key cannot be deleted without its RealKey, so revoke instead. S07: delete and recreate under the same name and the new key silently inherits the old grants, because grants follow the name.
7. **Optional, S08 and S09.** Workload identity with no static secret (audience and lifetime checked), and expiry then renewal by editing.
8. **Reset.** The Reset button (or `node scripts/reset.mjs`) clears everything so the next audience starts clean, and the diagram goes back to its starting positions.

## Likely questions

- **"Is this the real Agent Registry?"** No. It is a simulator built from behaviour measured on one test tenant. `docs/safety.md` lists each rule and whether it is verified or UNVERIFIED. The owner can compare with a real tenant by following `docs/live-checks.md`.
- **"Can I rotate a key in place?"** Not on the real product, and the mock refuses to pretend. Rotate by replacement.
- **"What screens the agent's traffic, and who sees the audit trail?"** Separate demos: AI Guard sidecar (D12), kill switch and cost and rate cap enforcement (D14), audit trail (D17). Here the event list is small and only for the lifecycle.
- **"Do workload tokens work on every route?"** UNVERIFIED on the gateway; do not promise it.
- **"Are those real keys?"** No. They are `sk-MOCK-...` values, masked in the UI and traces.
- **"Does it call out to anything?"** No. Outbound sockets are blocked by a guard with its own tests, and the server only listens on loopback.

## If something goes wrong

`npm run doctor` checks Node, the bind address, the port, the network guard and every scenario. If the page cannot reach the server the process is not running. If a hand-driven flow gets confused, press Reset.
