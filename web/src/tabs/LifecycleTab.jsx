import React, { useState } from "react";
import { Inert, pretty } from "../lib/Inert.jsx";
import { maskDeep } from "../lib/mask.js";
import { runScenario } from "../lib/api.js";
import { RuleNote } from "../lib/ui.jsx";

// A story runs in its own fresh mock world (it never touches the live registry on the other tabs), one step at a time.
export function ScenarioBar({ app }) {
  const { catalog, scenarioId, setScenarioId, doRun, running } = app;
  return (
    <div className="card controls">
      <label htmlFor="scenario">Story
        <select id="scenario" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
          {catalog.scenarios.map((s) => <option key={s.id} value={s.id}>{s.id} {s.title}</option>)}
        </select>
      </label>
      <button type="button" className="btn" disabled={running} onClick={doRun}>Run story</button>
    </div>
  );
}

export function StoryPlayer({ app }) {
  const { run, runError, cursor, setCursor } = app;
  if (runError) return <p className="alert" role="alert">{runError}</p>;
  if (!run) return <p className="muted" data-testid="no-run">No story has run yet. Pick one and press Run story.</p>;
  const cur = run.steps[Math.max(cursor, 0)];
  const refused = run.expectedOutcome === "refused";
  return (
    <section className="story" aria-label="Story player" data-testid="story">
      <p className="story__eyebrow">{run.kind.toUpperCase()} - {run.id}</p>
      <h3 className="story__title"><Inert text={run.title} /></h3>
      <p className={`verdict ${run.pass ? (refused ? "hold" : "ok") : "deny"}`} role="status" data-testid="verdict">{run.pass ? `Behaves as written: ${run.verdict}` : "Does not behave as written"}</p>
      <div className="story__controls">
        <button type="button" className="btn" disabled={cursor <= 0} onClick={() => setCursor(Math.max(cursor - 1, 0))}>Previous step</button>
        <button type="button" className="btn" disabled={cursor >= run.steps.length - 1} onClick={() => setCursor(cursor + 1)}>Next step</button>
        <span className="muted small">Step {Math.max(cursor, 0) + 1} of {run.steps.length}</span>
      </div>
      <ol className="story__steps">
        {run.steps.map((s, i) => (
          <li key={i} className={i === cursor ? "is-current" : ""}>
            <button type="button" className="story__step" aria-current={i === cursor ? "step" : undefined} onClick={() => setCursor(i)}>
              <span className="story__n">{s.index}</span><span><Inert text={s.say} /></span>
              <span className={`story__tag${s.status >= 400 ? " refused" : ""}`}>{s.status >= 400 ? `refused ${s.status}` : `ok ${s.status}`}</span>
            </button>
          </li>
        ))}
      </ol>
      {cursor >= 0 && cur && (
        <div data-testid="step-detail">
          {!cur.ok && <p className="alert" role="alert">{cur.failures.join("; ")}</p>}
          {cur.notes.map((n, i) => <p key={i} className="small muted"><Inert text={n} /></p>)}
          {cur.trace && (
            <details open><summary>Trace {cur.trace.traceparent}</summary>
              <div className="cols"><Inert block text={cur.trace.request} testid="step-request" /><Inert block text={cur.trace.response} testid="step-response" /></div>
              {cur.trace.gatewayLog?.length > 0 && <Inert block text={cur.trace.gatewayLog.join("\n")} testid="step-log" />}
            </details>
          )}
          {!cur.trace && <Inert block text={pretty(maskDeep(cur.body))} testid="step-body" />}
        </div>
      )}
      <p className="story__takeaway" data-testid="takeaway"><Inert text={run.takeaway} /></p>
      {run.rules.map((r) => <RuleNote key={r} id={r} rules={app.catalog.rules} />)}
    </section>
  );
}

export default function LifecycleTab({ app }) {
  const { world, catalog } = app;
  return (
    <>
      <h2>Lifecycle stories</h2>
      <p className="lede" data-admin-only>Each story is data with the cast filled in for the chosen persona. Run one, step through it, and watch the Diagram tab follow along.</p>
      <ScenarioBar app={app} />
      <StoryPlayer app={app} />
      <section className="card" aria-label="Lifecycle events">
        <h3>Live lifecycle events</h3>
        <p className="muted small">This demo's own short list for the live registry on the Registry tab. It is not an audit product; see the audit-trail demo for that.</p>
        {world.events.length === 0 ? <p className="muted">No events yet.</p> : (
          <ol className="steps" data-testid="events">{world.events.slice().reverse().slice(0, 30).map((e) => <li key={e.seq}><code>{e.at.replace(/\.\d+Z$/, "Z")}</code> <strong>{e.type}</strong> <Inert text={e.key} /> <span className="muted"><Inert text={e.detail} /></span></li>)}</ol>
        )}
      </section>
      <section className="card" aria-label="Rules the mock encodes">
        <h3>What this mock encodes, and how sure we are</h3>
        <p className="muted small">verified = measured on the real product. demo-guard = a safety stop this demo adds. UNVERIFIED = stated but never reproduced; the mock picks the cautious reading.</p>
        {Object.keys(catalog.rules).map((id) => <RuleNote key={id} id={id} rules={catalog.rules} />)}
      </section>
    </>
  );
}
