# Safety, and what is simulated versus real

## Hard rules, each pinned by a test

- **Mock only.** No tenant, no credential, no outbound network. `netguard` refuses and records every non-loopback socket, DNS lookup, `fetch` and UDP send, and proves it with a self-test that doctor and `/api/health` run.
- **Loopback only.** Binds 127.0.0.1 unless `AREG_BIND` is set on purpose. The Host header must be a loopback name (DNS rebinding). A write with a cross-origin `Origin` or a cross-site `Sec-Fetch-Site` is refused.
- **Fake keys only.** Every key is `sk-MOCK-` plus 54 base32 characters. Any other `sk-` value in a story fails doctor. Traces mask keys to their first and last four characters. RealKey is never returned by a read and never echoed.
- **Reserved hosts only.** Every host in shipped text is `.invalid` or `.example` (or loopback). Doctor scans every story.
- **Inert text.** Caller text (custodian, description, app, tool) has control and bidi characters stripped and its length capped; the API returns JSON and the UI must render it as text.
- **Ports 5010-5049 only.**
- No keys, tenant ids, client ids or hostnames from any real environment are in this repo. A check of the full git history against a private denylist (kept outside the repo) runs before every step and in CI, and gitleaks runs as a pre-commit hook and in CI.

## What is simulated versus real

Source: memory notes `privilege-agent-key-api-facts` and `privilege-agent-key-rotation-facts`, and the skills `privilege-agent-nhi-lessons` and `privilege-nhi-setup` (measured 2026-10-14 on one tenant; workload-identity schema read 2026-10-21).

| Rule | Status | In the mock |
| --- | --- | --- |
| VirtualKey is server-generated and immutable; a PUT with a new one returns 200 and is ignored | verified | exactly that |
| No rotate endpoint; rotation = snapshot, create successor, verify, revoke old | verified | `rotateByReplacement`; no in-place rotate exists, and a test asserts none does |
| An llm-scoped create needs a RealKey (400 `Spec.RealKey is required for llm scope`) | verified | exactly that message |
| RealKey is never returned; a PUT without it keeps the stored one | verified | empty string on reads; kept on PUT |
| Revoke (`Revoked:true`) is the only non-destructive kill | verified | state `revoked`, gateway 401 |
| Grants reference keys by NAME; delete + recreate under the same name inherits them | verified | no cascade on delete; inherited and dangling warnings are the demo's own |
| Native RPM, TPM and budget caps return 429 | verified (llm routes) | 429 `tokens_rate_limit_exceeded` + `retry-after`; virtual clock |
| The per-key guardrail is copied with the Spec | verified | carried by snapshot and successor |
| An expired key is edit-locked until NotAfter moves; editing renews it | verified (console) | a PUT with a later NotAfter renews the same key |
| Workload identity: no static secret; issuer, mandatory audience, subject, lifetime cap | verified (schema and live objects) | modelled; signatures and JWKS are NOT simulated |
| 401 for unknown, revoked and expired looks the same; only the scope 403 names itself; a bare 403 is explained only in the gateway log | verified | same; the log lines are in the trace |

## Not real: demo additions

- **Delete guard for llm keys.** The real API lets you delete an llm-scoped key; you then cannot recreate it because reads never return the RealKey. The mock refuses the delete (409 `blocked_by_demo_guard`, `demoGuard: true`) unless the caller shows the RealKey. This is the lesson made into a stop, labelled as the demo's own.
- Dangling and inherited grant warnings: the real product shows no such warning.
- The lifecycle event list, rotation helper and snapshot are demo conveniences.
- Grant creation requires the key to exist; the real behaviour is not recorded.
- Policy and app changes take about four minutes to reach the real gateway. The mock applies them instantly.

## UNVERIFIED (the mock picks the cautious reading; do not present these as facts)

- Whether the deployed gateway accepts workload tokens on mcp and llm routes. In the one live attempt the token was rejected (401) and no `workload token accepted/rejected` line was logged. The mock accepts a well-formed claim set; treat that as the intended design, not a measurement.
- Whether caps apply to mcp and a2a routes (measured on llm only). The mock applies them to llm only.
- Whether two keys can share a name at once. The mock refuses a duplicate, so a successor needs a new name.
- Whether `PUT Revoked:false` un-revokes. The mock refuses it.
- What the real API does with a VirtualKey supplied on create. The mock ignores it.
- Workload identity combined with the llm scope. The mock refuses it.
- The original budget, RPM and TPM numbers of keys that were lost in the delete incident were never recovered; no figure here comes from them.

## Overlap

Guardrail screening (D12), kill switch and cap enforcement (D14) and the audit trail (D17) belong to other demos. This one links to them in docs and never imports them. `privilege-demo` (human personas, Cedar) is not extended or imported; only its style is followed.
