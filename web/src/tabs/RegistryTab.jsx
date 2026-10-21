import React, { useEffect, useState } from "react";
import { Inert, pretty } from "../lib/Inert.jsx";
import { maskKey, maskDeep } from "../lib/mask.js";
import { registryCall } from "../lib/api.js";
import { ResultBox, RuleNote, StatePill, expiryText } from "../lib/ui.jsx";

const MOCK_REAL = "sk-MOCK-REAL-UPSTREAM-PLACEHOLDER";
const EXPIRIES = [["+30d", "30 days", 30 * 86400], ["+90d", "90 days", 90 * 86400], ["+1y", "1 year", 365 * 86400], ["none", "no expiry", 0]];
const ints = (v) => (v === "" ? 0 : Number(v));

export default function RegistryTab({ app }) {
  const { world, selected, setSelected, cast, catalog } = app;
  const [open, setOpen] = useState(false);
  const key = world.keys.find((k) => k.name === selected) || null;
  const warnings = world.warnings.filter((w) => w.type === "dangling" || w.type === "inherited");
  return (
    <>
      <h2>Agent Registry</h2>
      <p className="lede" data-admin-only>Each row is one non-human identity: an agent access key. Its scopes, custodian, caps and expiry hang off the key. {cast.custodian} is the custodian for {cast.agent_label}. Everything here is simulated.</p>
      {warnings.length > 0 && (
        <section className="note" role="alert" data-testid="grant-warnings" aria-label="Grant warnings">
          <strong>Grants follow the key's name, not the key.</strong>
          <ul>{warnings.map((w) => <li key={w.grant}><Inert text={w.message} /></li>)}</ul>
          <RuleNote id="grants-by-name" rules={catalog.rules} />
        </section>
      )}
      <section className="card" aria-label="Registered agents">
        <div className="controls">
          <h3>Registered agents ({world.keys.length})</h3>
          <button type="button" className="btn primary" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close the wizard" : "Register an agent"}</button>
        </div>
        {world.keys.length === 0 ? <p className="muted" data-testid="empty">No agents yet. Register one, or run a story on the Lifecycle tab.</p> : (
          <table className="keytable">
            <thead><tr><th scope="col">Name</th><th scope="col">State</th><th scope="col">Scopes</th><th scope="col">Custodian</th><th scope="col">Expiry</th><th scope="col">Key</th></tr></thead>
            <tbody>
              {world.keys.map((k) => (
                <tr key={k.name} aria-selected={k.name === selected}>
                  <td><button type="button" className="linkbtn" onClick={() => setSelected(k.name)} aria-label={`Open ${k.name}`}><Inert text={k.name} /></button></td>
                  <td><StatePill state={k.state} /></td>
                  <td>{k.spec.Scopes.join(", ")}</td>
                  <td><Inert text={k.spec.Custodian} /></td>
                  <td>{expiryText(k.spec)}</td>
                  <td><code>{k.spec.WorkloadIdentity ? "no static secret" : maskKey(k.spec.VirtualKey)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {open && <Wizard app={app} onDone={(name) => { setSelected(name); setOpen(false); }} />}
      {key && <KeyDetail key={key.name} app={app} k={key} />}
    </>
  );
}

function Wizard({ app, onDone }) {
  const { cast, world, refresh, catalog } = app;
  const [f, setF] = useState({ name: cast.agent, mode: "key", mcp: true, llm: false, a2a: false, custodian: cast.custodian, provider: cast.provider, models: cast.model, realKey: "", rpm: "60", tpm: "0", budget: "0", expiry: "+1y", guard: "alert", issuer: cast.issuer, audience: cast.audience, subject: cast.subject, life: "300" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const workload = f.mode === "workload";
  const realKeyBad = f.llm && f.realKey && !f.realKey.startsWith("sk-MOCK-");

  async function submit(e) {
    e.preventDefault();
    if (realKeyBad) { setResult({ status: 400, response: { message: "Refused by the demo: only sk-MOCK- placeholder values are accepted here. Never type a real provider key into a demo." }, notes: [] }); return; }
    const scopes = ["mcp", "llm", "a2a"].filter((s) => f[s] && !(workload && s === "llm"));
    const exp = EXPIRIES.find(([v]) => v === f.expiry);
    const spec = {
      Scopes: scopes, RPMLimit: ints(f.rpm), TPMLimit: ints(f.tpm), BudgetUSD: ints(f.budget),
      NotAfter: exp[2] ? new Date(Date.parse(world.now) + exp[2] * 1000).toISOString() : "", Guardrail: { mode: f.guard, blockAgreement: "off" },
    };
    if (!workload) spec.Custodian = f.custodian;
    if (scopes.includes("llm")) { spec.Provider = f.provider; spec.AllowedModels = f.models.split(",").map((m) => m.trim()).filter(Boolean); if (f.realKey) spec.RealKey = f.realKey; }
    if (workload) spec.WorkloadIdentity = { Issuer: f.issuer, Audience: f.audience, Subject: f.subject, MaxTokenLifetimeSec: ints(f.life) };
    setBusy(true);
    try {
      const r = await registryCall("POST", "/api/registry/keys", { name: f.name, spec });
      setResult(r);
      if (r.status === 201) { await refresh(); onDone(f.name); }
    } finally { setBusy(false); }
  }

  const text = (id, label, extra = {}) => (
    <label className="field" htmlFor={`w-${id}`}>{label}
      <input id={`w-${id}`} type="text" value={f[id]} onChange={(e) => set({ [id]: e.target.value })} {...extra} />
    </label>
  );
  const num = (id, label) => (
    <label className="field" htmlFor={`w-${id}`}>{label}
      <input id={`w-${id}`} type="number" min="0" value={f[id]} onChange={(e) => set({ [id]: e.target.value })} />
    </label>
  );
  return (
    <form className="card" onSubmit={submit} aria-label="Register an agent" data-testid="wizard">
      <h3>Register an agent</h3>
      <p className="muted small" data-admin-only>The name is permanent: renaming means delete and recreate, and then the key value changes. The registry mints the key; you never choose it.</p>
      {text("name", "Name (permanent)")}
      <fieldset>
        <legend>Identity type</legend>
        <label className="check"><input type="radio" name="mode" checked={!workload} onChange={() => set({ mode: "key" })} /> Static access key</label>
        <label className="check"><input type="radio" name="mode" checked={workload} onChange={() => set({ mode: "workload", llm: false })} /> Workload identity (no static secret)</label>
      </fieldset>
      <fieldset>
        <legend>Scopes</legend>
        <label className="check"><input type="checkbox" checked={f.mcp} onChange={(e) => set({ mcp: e.target.checked })} /> mcp</label>
        <label className="check"><input type="checkbox" checked={f.llm && !workload} disabled={workload} onChange={(e) => set({ llm: e.target.checked })} /> llm</label>
        <label className="check"><input type="checkbox" checked={f.a2a} onChange={(e) => set({ a2a: e.target.checked })} /> a2a</label>
        {workload && <p className="small muted">Workload identities are limited to mcp and a2a in this demo.</p>}
      </fieldset>
      {!workload && text("custodian", "Custodian (the human the agent acts as)")}
      {f.llm && !workload && (
        <fieldset>
          <legend>llm settings</legend>
          {text("provider", "Provider (one per key)")}
          {text("models", "Allowed models (comma separated)")}
          {text("realKey", "Upstream RealKey (mock placeholder only)", { placeholder: "required for llm scope" })}
          <button type="button" className="btn" onClick={() => set({ realKey: MOCK_REAL })}>Use the mock placeholder</button>
          <p className="small muted">An llm key cannot be created without the real upstream key. Leave it empty and submit to see the refusal. The real value is never readable afterwards, which is why you never delete an llm key before you hold it.</p>
          {realKeyBad && <p className="alert" role="alert">Only sk-MOCK- values are accepted here.</p>}
        </fieldset>
      )}
      {workload && (
        <fieldset>
          <legend>Federation (external issuer)</legend>
          {text("issuer", "Issuer")}{text("audience", "Audience (mandatory)")}{text("subject", "Subject")}{num("life", "Max token lifetime (seconds)")}
          <p className="small muted">The issuer's token is the credential, so there is no key to leak. Whether the real gateway accepts these on mcp and llm routes is UNVERIFIED.</p>
        </fieldset>
      )}
      <fieldset>
        <legend>Per-key caps (attributes only, 0 = unlimited)</legend>
        <div className="field--row">{num("rpm", "Requests per minute")}{num("tpm", "Tokens per minute")}{num("budget", "Budget (USD)")}</div>
        <p className="small muted">Registration attributes. The gateway refuses with 429 over a cap on llm routes; cap policy and kill switches are a separate demo.</p>
      </fieldset>
      <div className="controls">
        <label className="field" htmlFor="w-expiry">Expiry
          <select id="w-expiry" value={f.expiry} onChange={(e) => set({ expiry: e.target.value })}>{EXPIRIES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        </label>
        <label className="field" htmlFor="w-guard">Guardrail (copied with the spec)
          <select id="w-guard" value={f.guard} onChange={(e) => set({ guard: e.target.value })}><option value="alert">alert</option><option value="block">block</option></select>
        </label>
      </div>
      <div className="actions"><button type="submit" className="btn primary" disabled={busy}>Register</button></div>
      <ResultBox result={result} rules={catalog.rules} />
    </form>
  );
}

function KeyDetail({ app, k }) {
  const { world, refresh, catalog, setSelected } = app;
  const [result, setResult] = useState(null);
  const [confirm, setConfirm] = useState(null); // "revoke" | "delete"
  const [panel, setPanel] = useState(null); // "grant" | "rotate"
  const grants = world.grants.filter((g) => g.keyName === k.name);
  useEffect(() => { setConfirm(null); }, [k.state]);

  async function act(fn) { const r = await fn(); setResult(r); await refresh(); return r; }
  const revoke = () => act(() => registryCall("POST", `/api/registry/keys/${k.name}/revoke`));
  const del = async () => { const r = await act(() => registryCall("DELETE", `/api/registry/keys/${k.name}`, {})); if (r.status === 200) setSelected(null); };
  const removeGrant = (id) => act(() => registryCall("DELETE", `/api/registry/grants/${id}`));
  const gone = k.state === "revoked";

  return (
    <section className="card" aria-label={`Agent ${k.name}`} data-testid="detail">
      <h3><Inert text={k.name} /> <StatePill state={k.state} /></h3>
      <dl className="kv">
        <dt>Identity</dt><dd>{k.spec.WorkloadIdentity ? "workload identity, no static secret" : <code>{maskKey(k.spec.VirtualKey)}</code>}</dd>
        <dt>Scopes</dt><dd>{k.spec.Scopes.join(", ")}</dd>
        <dt>Custodian</dt><dd><Inert text={k.spec.Custodian} /></dd>
        <dt>Caps</dt><dd>{k.spec.RPMLimit || "no"} rpm, {k.spec.TPMLimit || "no"} tpm, {k.spec.BudgetUSD ? `$${k.spec.BudgetUSD}` : "no"} budget</dd>
        <dt>Expiry</dt><dd>{expiryText(k.spec)}</dd>
        <dt>Guardrail</dt><dd>{k.spec.Guardrail?.mode}</dd>
        {k.spec.Scopes.includes("llm") && <><dt>Provider</dt><dd><Inert text={k.spec.Provider} /> ({(k.spec.AllowedModels || []).join(", ") || "any model"}); RealKey is never returned</dd></>}
      </dl>
      <h4>Grants (by name)</h4>
      {grants.length === 0 ? <p className="muted small">No grants: the gateway refuses mcp and a2a calls with a bare 403 until the key is granted to an app.</p> : (
        <ul>{grants.map((g) => (
          <li key={g.id}><Inert text={`${g.app}${g.tools.length ? ` (tools: ${g.tools.join(", ")})` : " (all tools)"}`} /> <button type="button" className="btn" onClick={() => removeGrant(g.id)} aria-label={`Remove grant ${g.app}`}>Remove</button></li>
        ))}</ul>
      )}
      <div className="actions">
        <button type="button" className="btn" aria-pressed={panel === "grant"} onClick={() => setPanel(panel === "grant" ? null : "grant")}>Grant to an app</button>
        <button type="button" className="btn" aria-pressed={panel === "rotate"} onClick={() => setPanel(panel === "rotate" ? null : "rotate")}>Rotate by replacement</button>
        {confirm === "revoke"
          ? <button type="button" className="btn danger" onClick={revoke}>Confirm revoke {k.name}</button>
          : <button type="button" className="btn danger" disabled={gone} onClick={() => setConfirm("revoke")}>{gone ? "Revoked" : "Revoke / retire"}</button>}
        {confirm === "delete"
          ? <button type="button" className="btn danger" onClick={del}>Confirm delete {k.name}</button>
          : <button type="button" className="btn danger" onClick={() => setConfirm("delete")}>Delete (destructive)</button>}
      </div>
      {confirm && <p className="note small" role="status">{confirm === "revoke" ? "Revoke is the only non-destructive kill: the key, its caps and its grants stay, and the gateway answers 401." : "Delete removes the key but not the grants that name it. Whoever registers the same name next inherits them silently. An llm key also cannot be recreated afterwards."}</p>}
      <ResultBox result={result} rules={catalog.rules} />
      {panel === "grant" && <GrantPanel app={app} k={k} onResult={setResult} />}
      {panel === "rotate" && <RotatePanel app={app} k={k} />}
      <details><summary>Spec as the registry returns it (keys masked)</summary><Inert block text={pretty(maskDeep(k.spec))} testid="spec-json" /></details>
    </section>
  );
}

function GrantPanel({ app, k, onResult }) {
  const { cast, refresh } = app;
  const [appName, setAppName] = useState(cast.app);
  const [tools, setTools] = useState(cast.tool);
  async function submit(e) {
    e.preventDefault();
    const r = await registryCall("POST", "/api/registry/grants", { keyName: k.name, app: appName, tools: tools.split(",").map((t) => t.trim()).filter(Boolean) });
    onResult(r); await refresh();
  }
  return (
    <form className="card" onSubmit={submit} aria-label="Grant to an app">
      <h4>Grant {k.name} to an app</h4>
      <p className="small muted">The grant names the key, not its value. Selecting the app is the grant; leave tools empty for all tools.</p>
      <label className="field" htmlFor="g-app">App<input id="g-app" type="text" value={appName} onChange={(e) => setAppName(e.target.value)} /></label>
      <label className="field" htmlFor="g-tools">Tools (comma separated)<input id="g-tools" type="text" value={tools} onChange={(e) => setTools(e.target.value)} /></label>
      <button type="submit" className="btn primary">Grant</button>
    </form>
  );
}

const STEP_LABEL = { snapshot: "1. Snapshot the full spec", "create-successor": "2. Create the successor", "copy-grants": "2b. Recreate the grants for the new name", verify: "3. Verify with a real call", "discard-successor": "3b. Discard the failed successor", "revoke-old": "4. Revoke the old key" };

function RotatePanel({ app, k }) {
  const { cast, refresh, catalog } = app;
  const [name, setName] = useState(k.name === cast.agent ? cast.agent_next : `${k.name}-v2`);
  const [realKey, setRealKey] = useState("");
  const [out, setOut] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const llm = k.spec.Scopes.includes("llm");

  async function rotate(e) {
    e.preventDefault();
    const body = { successorName: name };
    if (llm) body.realKey = realKey;
    const r = await registryCall("POST", `/api/registry/keys/${k.name}/rotate`, body);
    setOut(r); await refresh();
  }
  async function inPlace() {
    const before = k.spec.VirtualKey;
    const r = await registryCall("PUT", `/api/registry/keys/${k.name}`, { name: k.name, spec: { VirtualKey: "sk-MOCK-ATTEMPTED-NEW-VALUE-NOT-A-REAL-KEY-0000" } });
    setAttempt({ r, same: r.response?.spec?.VirtualKey === before });
    await refresh();
  }
  const steps = out?.response?.steps || [];
  return (
    <section className="card" aria-label="Rotate by replacement" data-testid="rotate-panel">
      <h4>Rotate {k.name} by replacement</h4>
      <p className="note"><strong>There is no in-place rotation.</strong> The VirtualKey is server-generated and immutable, and there is no rotate endpoint. Rotation means: snapshot the spec, create a successor, verify it, then revoke the old key. Never delete first.</p>
      <RuleNote id="no-rotate-endpoint" rules={catalog.rules} />
      <div className="actions">
        <button type="button" className="btn" onClick={inPlace}>Try in-place rotation (a PUT with a new key)</button>
      </div>
      {attempt && (
        <div className="alert" role="status" data-testid="inplace-result">
          <strong>{attempt.r.status} came back, and nothing changed.</strong> The key is still <code>{maskKey(k.spec.VirtualKey)}</code>{attempt.same ? " (identical)" : ""}.
          {attempt.r.notes.map((n, i) => <p key={i} className="small"><Inert text={n} /></p>)}
        </div>
      )}
      <form onSubmit={rotate} aria-label="Rotate by replacement form">
        <label className="field" htmlFor="r-name">Successor name (must differ: two keys sharing a name was never tested)<input id="r-name" type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
        {llm && <label className="field" htmlFor="r-real">Upstream RealKey you hold (mock placeholder only)<input id="r-real" type="text" value={realKey} onChange={(e) => setRealKey(e.target.value)} placeholder="needed to recreate an llm key" /></label>}
        <button type="submit" className="btn primary">Start rotation</button>
      </form>
      {out && (
        <>
          <ol className="steps" data-testid="rotate-steps" aria-label="Rotation steps">
            {steps.map((s, i) => <li key={i} className={s.ok ? "pass" : "fail"}><strong>{STEP_LABEL[s.step] || s.step}</strong>: {s.ok ? "done" : "failed"}. <Inert text={s.detail} /></li>)}
          </ol>
          <ResultBox result={out} rules={catalog.rules} />
          {out.status === 200 && <p className="muted small">Next, in real life: repoint consumers to {name}, confirm the old value now gets 401, and only then delete the old key.</p>}
        </>
      )}
    </section>
  );
}
