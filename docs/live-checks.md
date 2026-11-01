# Live checks (optional, owner only)

Nothing in this repo calls a real Privilege console or gateway, and the tests prove it (netguard). This page is for the owner who wants to compare the mock with a real PingOne Privilege tenant. **It is instructions only: no script in this repo runs any of it, and the agent that built this repo never ran it.** Run it yourself, from your own shell. Never paste tenant ids, client ids, hostnames, keys or tokens into this repo, its issues or its commit messages.

**Read-only first.** Every check below only reads, or sends one call with a key you already own. Anything that creates, changes, rotates, revokes or deletes a key or a grant is a write: those are owner-only, belong in a test tenant, and are listed at the end as "not covered here". The mock never needs any of this.

## What you need

- A test tenant, the console API base URL and the gateway host, held in shell variables you set yourself (`CONSOLE`, `GATEWAY`, `TENANT`). The console accepts a browser session or the "For Developers" credentials (see the `privilege-console-api` skill for auth); do not write either into a file in this repo.
- One existing test agent key, in a `chmod 600` file outside this repo, loaded with `AGENT_KEY=$(cat ~/path/outside/repo)`. Never print it.

## Checks (all read-only)

1. **Real keys are never RealKey-bearing on read.** `GET $CONSOLE/api/$TENANT/v1/agentaccesskeys`. For an `llm`-scoped key, expect `RealKey` to be an empty string. Mock equivalent: Registry tab, any llm key. Note that the real list returns `VirtualKey` unredacted; the mock masks it on purpose (do not copy the real output anywhere).
2. **The list carries every Spec field** (guardrail, limits, expiry, workload identity), not a subset. Mock equivalent: Raw tab. This is why rotation starts with a snapshot.
3. **Grants are objects that name the key.** `GET $CONSOLE/api/$TENANT/v1/pacpolicys`. Find a rule whose `Attributes.Map.agentaccesskey` is a base64 string; decode it locally (`printf %s "<value>" | base64 -d`) and confirm it ends in the key's NAME, not its value. Mock equivalent: S07 (same-name recreate inherits grants).
4. **An unknown (made-up) key gives a bare 401.** `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $BOGUS_KEY" https://$GATEWAY/<app>/mcp` (an app you know exists), with BOGUS_KEY set to any made-up string. Expect 401. A revoked or expired real key should look identical. Gateway probes can lie for door paths that never existed, so use a real app and compare with the console. Mock equivalent: S02, S09.
5. **Scope 403 names itself, a bare 403 does not.** With `AGENT_KEY` that has no `a2a` scope, call an `/a2a/` route. Expect a self-describing `key not scoped for ... access`. A call to an app the key was never granted gives a bare 403 whose reason only appears in the gateway log. Mock equivalent: S03.
6. **Caps return 429.** Only if your test key has a tiny RPM or TPM and you accept the burst: expect 429 with a `retry-after` header once exceeded. Mock equivalent: S04. (Enforcement as a product feature belongs to the cost and rate cap demo, D14.)
7. **Workload identity objects (read).** (Federated Identity in Ping's 2026-11-02 naming; the API path is unchanged.) `GET $CONSOLE/api/$TENANT/v1/nonhumanidentities`. Expect `Federation` with `Issuer`, a mandatory `Audience`, `Subject` or `AllowAnySubject`, `MaxTokenLifetimeSec`, and no secret anywhere. Mock equivalent: S08. UNVERIFIED: whether the deployed gateway accepts a minted workload token on every route; do not promise it to a customer from the mock.

## Not covered here (writes, owner only)

- PUT with a different `VirtualKey` returning 200 and being ignored, and Revoked:true as the kill: reproduce only on a throwaway key in a test tenant. The agent-key PUT only works on the bare name path under the `default` namespace.
- Rotation by replacement, and a same-name delete and recreate. For an llm-scoped key you must hold the RealKey before any delete.
- Creating grants. Automation classifiers often block these; do them in the console.

## Recording results

Write a few lines in your own notes (not this repo): date, product version, which checks matched the mock, which differed. If a difference changes what an SE should say, update `docs/talk-track.md` and the status column in `docs/safety.md` in a normal commit that names no tenant details.

## After you are done

Delete any captured output and the key file if it was temporary. Do not commit them.
