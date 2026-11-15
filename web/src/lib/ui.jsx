import React from "react";
import { Inert } from "./Inert.jsx";
import Json from "../components/JsonPane.jsx";
import { maskDeep } from "./mask.js";

// The keys that matter in this lab's payloads, stood out on every JSON pane (on top of JsonPane's defaults).
export const HOT = ["state", "Scopes", "Revoked", "NotAfter", "Custodian", "WorkloadIdentity", "Provider", "AllowedModels", "rule", "message", "type"];

export const StatePill = ({ state }) => <span className={`pill ${state}`}>{state}</span>;

// A rule the mock encodes, with its evidence status in words: verified, demo-guard (this demo's own safety stop) or UNVERIFIED.
export function RuleNote({ id, rules }) {
  const r = rules?.[id];
  if (!r) return null;
  return (
    <p className="small" data-testid="rule-note">
      <span className={`pill ${r.status}`}>{r.status === "unverified" ? "UNVERIFIED" : r.status}</span> <code>{id}</code> <Inert text={r.text} />
    </p>
  );
}

// What a registry call answered: status in words, the message, the notes the simulator adds, and the rule behind a refusal.
export function ResultBox({ result, rules }) {
  if (!result) return null;
  const bad = result.status >= 400;
  const body = result.response || {};
  return (
    <div className={bad ? "alert" : "okbox"} role="status" data-testid="result">
      <strong>{result.status} {bad ? "refused" : "accepted"}</strong>{body.message ? <>: <Inert text={body.message} /></> : null}
      {result.notes?.map((n, i) => <p key={i} className="small" data-testid="result-note"><Inert text={n} /></p>)}
      {body.rule && <RuleNote id={body.rule} rules={rules} />}
      {!bad && result.response?.spec && <Json value={maskDeep(result.response)} label="Registry response" testId="result-body" hot={HOT} />}
    </div>
  );
}

export const expiryText = (spec) => (spec.NotAfter ? spec.NotAfter.replace(/:\d\d\.\d+Z$/, "Z") : "no expiry");
