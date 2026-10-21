import React, { useEffect, useState } from "react";
import { Inert, pretty } from "../lib/Inert.jsx";
import { advanceClock, gatewayCall } from "../lib/api.js";
import { maskKey } from "../lib/mask.js";

const REASON = { 200: "OK", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 429: "Too Many Requests" };
const UNKNOWN = "__unknown__";
const UNKNOWN_KEY = "sk-MOCK-UNKNOWN-KEY-THE-REGISTRY-NEVER-ISSUED-0000";
const outcome = (s) => (s === 200 ? "allowed" : "refused");

export default function GatewayTab({ app }) {
  const { world, cast, refresh, addLive } = app;
  const [credName, setCredName] = useState(world.keys[0]?.name || UNKNOWN);
  const [route, setRoute] = useState({ kind: "mcp", app: cast.app, tool: cast.tool, provider: cast.provider, model: cast.model });
  const [claims, setClaims] = useState({ iss: "", aud: "", sub: "", lifetime: "300" });
  const [last, setLast] = useState(null);
  const [burst, setBurst] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const key = world.keys.find((k) => k.name === credName) || null;
  const workload = Boolean(key?.spec.WorkloadIdentity);
  useEffect(() => { if (!world.keys.some((k) => k.name === credName) && credName !== UNKNOWN) setCredName(world.keys[0]?.name || UNKNOWN); }, [world.keys, credName]);
  useEffect(() => {
    const w = key?.spec.WorkloadIdentity;
    if (w) setClaims({ iss: w.Issuer, aud: w.Audience, sub: w.Subject || "", lifetime: "300" });
  }, [credName]); // eslint-disable-line react-hooks/exhaustive-deps

  const setR = (p) => setRoute((r) => ({ ...r, ...p }));
  const credential = () => {
    if (workload) return { type: "workload", claims: { iss: claims.iss, aud: claims.aud, sub: claims.sub, lifetime: Number(claims.lifetime) } };
    return { type: "bearer", value: key ? key.spec.VirtualKey : UNKNOWN_KEY };
  };
  const body = () => ({ credential: credential(), route: route.kind === "llm" ? { kind: "llm", provider: route.provider, model: route.model } : { kind: route.kind, app: route.app, tool: route.kind === "mcp" ? route.tool : undefined }, tokens: 1 });

  async function send(n = 1) {
    setBusy(true); setError(null); setBurst(null);
    try {
      const statuses = [];
      let r = null;
      for (let i = 0; i < n; i++) {
        r = await gatewayCall(body());
        statuses.push(r.status);
        addLive({ label: `${r.status} ${route.kind} ${credName === UNKNOWN ? "unknown key" : credName}`, trace: r.trace });
      }
      setLast(r);
      if (n > 1) setBurst(statuses);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function advance(seconds) { await advanceClock(seconds); await refresh(); }
  const when = (world.now || "").replace(/\.\d+Z$/, "Z");

  return (
    <>
      <h2>Gateway call simulator</h2>
      <p className="lede" data-admin-only>Send a call through the mock gateway with a key from the registry and read the refusal. The wire says little; the gateway log says why. Time is virtual, so nothing sleeps.</p>
      <section className="card" aria-label="Call builder">
        <div className="controls">
          <label htmlFor="c-cred">Credential
            <select id="c-cred" value={credName} onChange={(e) => setCredName(e.target.value)}>
              {world.keys.map((k) => <option key={k.name} value={k.name}>{k.name} ({k.state})</option>)}
              <option value={UNKNOWN}>unknown key (never issued)</option>
            </select>
          </label>
          <label htmlFor="c-kind">Route
            <select id="c-kind" value={route.kind} onChange={(e) => setR({ kind: e.target.value })}>
              <option value="mcp">mcp: /app/mcp</option><option value="a2a">a2a: /app/a2a/jsonrpc</option><option value="llm">llm: /llm/provider/v1/chat/completions</option>
            </select>
          </label>
          {route.kind === "llm" ? (
            <>
              <label htmlFor="c-provider">Provider<input id="c-provider" type="text" value={route.provider} onChange={(e) => setR({ provider: e.target.value })} /></label>
              <label htmlFor="c-model">Model<input id="c-model" type="text" value={route.model} onChange={(e) => setR({ model: e.target.value })} /></label>
            </>
          ) : (
            <>
              <label htmlFor="c-app">App<input id="c-app" type="text" value={route.app} onChange={(e) => setR({ app: e.target.value })} /></label>
              {route.kind === "mcp" && <label htmlFor="c-tool">Tool<input id="c-tool" type="text" value={route.tool} onChange={(e) => setR({ tool: e.target.value })} /></label>}
            </>
          )}
        </div>
        <p className="small muted">{key ? (workload ? "This key has no static secret: the call carries a workload token." : <>Bearer <code>{maskKey(key.spec.VirtualKey)}</code> (masked here; the full mock value goes to the mock gateway only).</>) : <>Bearer <code>{maskKey(UNKNOWN_KEY)}</code>: a key the registry never issued.</>}</p>
        {workload && (
          <fieldset>
            <legend>Workload token claims (signature checking is not simulated)</legend>
            {[["iss", "Issuer"], ["aud", "Audience"], ["sub", "Subject"], ["lifetime", "Lifetime (seconds)"]].map(([id, label]) => (
              <label className="field" key={id} htmlFor={`cl-${id}`}>{label}<input id={`cl-${id}`} type="text" value={claims[id]} onChange={(e) => setClaims((c) => ({ ...c, [id]: e.target.value }))} /></label>
            ))}
          </fieldset>
        )}
        <div className="actions">
          <button type="button" className="btn primary" disabled={busy} onClick={() => send(1)}>Send call</button>
          <button type="button" className="btn" disabled={busy} onClick={() => send(5)}>Send 5 calls</button>
          <span className="small muted" data-testid="clock">Virtual clock {when}</span>
          <button type="button" className="btn" onClick={() => advance(61)}>+61 seconds</button>
          <button type="button" className="btn" onClick={() => advance(86400)}>+1 day</button>
          <button type="button" className="btn" onClick={() => advance(366 * 86400)}>+1 year</button>
        </div>
        {error && <p className="alert" role="alert">{error}</p>}
      </section>
      {burst && <p className="note" role="status" data-testid="burst">Five calls: {burst.join(", ")}. Over an llm key's cap the 429 starts; +61 seconds clears it.</p>}
      {last && <Result r={last} rules={app.catalog.rules} />}
    </>
  );
}

function Result({ r }) {
  const t = r.trace || {};
  return (
    <section className="card" aria-label="Gateway answer" data-testid="gateway-result">
      <p className={`verdict ${r.status === 200 ? "ok" : r.status === 429 ? "hold" : "deny"}`} role="status">{r.status} {REASON[r.status] || ""}: call {outcome(r.status)}</p>
      <div className="cols">
        <div>
          <h4>On the wire (what the agent sees)</h4>
          <Inert block text={t.response || pretty(r.body)} testid="gw-response" />
        </div>
        <div>
          <h4>Gateway log (only the operator sees this)</h4>
          <Inert block text={(t.gatewayLog || []).join("\n") || "(no log lines)"} testid="gw-log" />
          {(t.notes || []).map((n, i) => <p key={i} className="small muted"><Inert text={n} /></p>)}
          <p className="small muted">traceparent <code data-testid="traceparent">{t.traceparent}</code></p>
        </div>
      </div>
    </section>
  );
}
