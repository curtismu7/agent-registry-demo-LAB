import React, { useState } from "react";
import GatewayTrace from "../gateway-trace/GatewayTrace.jsx";
import { call } from "../lib/api.js";

// "What Privilege did" for the real gateway check (rule 25). The Privilege card above runs the same check on its own; this runs it once
// more only when asked, so the page never makes extra live calls by itself, and shows each HTTP exchange with the key redacted at capture.
export default function RealGatewayTrace({ info }) {
  const [state, setState] = useState({ phase: "idle", exchanges: [] });
  if (!info?.realAvailable) return null;

  async function run() {
    setState({ phase: "running", exchanges: [] });
    try {
      const { status, data } = await call("POST", "/api/gateway-check", {});
      if (status >= 400) setState({ phase: "error", exchanges: [], reason: data.message || `the lab answered ${status}` });
      else setState({ phase: "done", exchanges: Array.isArray(data.traces) ? data.traces : [] });
    } catch (e) {
      setState({ phase: "error", exchanges: [], reason: String(e?.message || e).slice(0, 200) });
    }
  }

  return (
    <section className="card" aria-label="What Privilege did, real gateway" data-testid="real-gateway-trace">
      <div className="actions">
        {/* ui-pattern: allow P9 secondary on purpose; the one primary on every page is another control (the Privilege card's primaryRetry, or the page's own action), which the checker cannot expand */}
        <button type="button" className="btn" disabled={state.phase === "running"} onClick={run} data-testid="real-trace-run">
          {state.phase === "running" ? "Calling the gateway..." : "Show what Privilege did (one live gateway check)"}
        </button>
      </div>
      {state.phase === "error" && <p className="alert" role="alert">{state.reason}</p>}
      {state.phase === "done" && <GatewayTrace exchanges={state.exchanges} source="real" />}
    </section>
  );
}
