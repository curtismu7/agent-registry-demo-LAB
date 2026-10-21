import React, { useEffect, useState } from "react";
import { Inert } from "../lib/Inert.jsx";

// Raw messages: either from the story on screen or from live gateway calls. Keys are masked on the server before they get here.
export default function RawTab({ app }) {
  const { run, cursor, live } = app;
  const story = (run?.steps || []).filter((s) => s.trace).map((s) => ({ label: `story step ${s.index} ${s.op} ${s.status}`, step: s.index, trace: s.trace }));
  const [source, setSource] = useState(live.length ? "live" : "story");
  const [idx, setIdx] = useState(0);
  const list = source === "live" ? live : story;
  useEffect(() => {
    if (!run || cursor < 0) return;
    const i = story.findIndex((m) => m.step === cursor + 1);
    if (i >= 0) { setSource("story"); setIdx(i); }
  }, [cursor, run]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = list[Math.min(idx, list.length - 1)];
  return (
    <>
      <h2>Raw messages</h2>
      <p className="lede" data-admin-only>The request and response as they would look on the wire, each with a W3C traceparent. Only sk-MOCK- values appear, and they are masked. Text is shown, never run.</p>
      <div className="card controls">
        <label htmlFor="raw-source">Source
          <select id="raw-source" value={source} onChange={(e) => { setSource(e.target.value); setIdx(0); }}>
            <option value="live">Live gateway calls ({live.length})</option><option value="story">Story on screen ({story.length})</option>
          </select>
        </label>
        {m && (
          <label htmlFor="raw-msg">Message
            <select id="raw-msg" value={Math.min(idx, list.length - 1)} onChange={(e) => setIdx(Number(e.target.value))}>
              {list.map((x, i) => <option key={i} value={i}>{i + 1} {x.label}</option>)}
            </select>
          </label>
        )}
      </div>
      {!m ? <p className="muted" data-testid="raw-empty">No messages yet. Send a call on the Gateway tab or run a story.</p> : (
        <>
          <p className="muted small">traceparent <code>{m.trace.traceparent}</code></p>
          <div className="cols">
            <section className="card"><h3>Request</h3><Inert block text={m.trace.request} testid="raw-request" /></section>
            <section className="card"><h3>Response</h3><Inert block text={m.trace.response} testid="raw-response" /></section>
          </div>
        </>
      )}
    </>
  );
}
