import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Inert } from "../lib/Inert.jsx";
import { ScenarioBar, StoryPlayer } from "./LifecycleTab.jsx";

// Register -> grant -> call -> rotate -> retire. Boxes are draggable; Simulate walks the story on screen (or a built-in path when there is
// none); Reset puts the boxes and the simulation back; the speed control sets the pace. The caption says in words what the picture shows.
export const START_BOXES = [
  { id: "register", position: { x: 0, y: 0 }, data: { title: "1 Register", sub: "Name, scopes, custodian, caps, expiry. The registry mints the key." } },
  { id: "grant", position: { x: 300, y: 0 }, data: { title: "2 Grant", sub: "Key named on an app or tool. Grants follow the name." } },
  { id: "call", position: { x: 600, y: 0 }, data: { title: "3 Gateway call", sub: "Allowed, or refused with 401, 403 or 429." } },
  { id: "rotate", position: { x: 600, y: 220 }, data: { title: "4 Rotate by replacement", sub: "Snapshot, create successor, verify. No in-place rotation." } },
  { id: "retire", position: { x: 150, y: 220 }, data: { title: "5 Revoke / retire", sub: "Revoked:true. The old key now gets 401." } },
];
const EDGES = [
  { id: "e1", source: "register", target: "grant", sourceHandle: "r", targetHandle: "l", label: "key exists" },
  { id: "e2", source: "grant", target: "call", sourceHandle: "r", targetHandle: "l", label: "may reach app" },
  { id: "e3", source: "call", target: "rotate", sourceHandle: "b", targetHandle: "t", label: "time to replace" },
  { id: "e4", source: "rotate", target: "retire", sourceHandle: "l", targetHandle: "r", label: "old key revoked" },
  { id: "e5", source: "call", target: "retire", sourceHandle: "b", targetHandle: "t", label: "revoke: calls get 401" },
];
const OP_NODE = { register: "register", grant: "grant", call: "call", rotate: "rotate", put: "rotate", revoke: "retire", delete: "retire" };
export const DEMO_STEPS = [
  { op: "register", say: "The agent is registered: scopes, custodian, caps and expiry. The registry mints the key." },
  { op: "grant", say: "The key is granted to one tool, by name." },
  { op: "call", say: "The agent calls the tool through the gateway and is allowed.", status: 200 },
  { op: "rotate", say: "Rotation is replacement: snapshot, create a successor, verify it, revoke the old key." },
  { op: "revoke", say: "The old key is revoked, not deleted." },
  { op: "call", say: "The old key now gets 401 and the gateway does not say why.", status: 401 },
];
const SPEEDS = [["0.5", "0.5x"], ["1", "1x"], ["2", "2x"], ["4", "4x"]];
const BASE_MS = 1600;
const POS = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom };

function Box({ data }) {
  return (
    <div className={`fbox${data.on ? " on" : ""}${data.dim ? " dim" : ""}${data.deny ? " deny" : ""}`}>
      {Object.entries(POS).map(([id, pos]) => (
        <React.Fragment key={id}><Handle id={id} type="source" position={pos} /><Handle id={id} type="target" position={pos} /></React.Fragment>
      ))}
      <strong>{data.title}</strong>
      <span>{data.sub}</span>
    </div>
  );
}
const nodeTypes = { box: Box };

export default function DiagramTab({ app }) {
  const { run, cursor, setCursor, boxes, setBoxes, theme } = app;
  const [speed, setSpeed] = useState("1");
  const [running, setRunning] = useState(false);
  const steps = run?.steps ?? DEMO_STEPS;

  useEffect(() => { setRunning(false); }, [run]);
  useEffect(() => {
    if (!running) return undefined;
    if (cursor >= steps.length - 1) { setRunning(false); return undefined; }
    const t = setTimeout(() => setCursor(cursor + 1), BASE_MS / Number(speed));
    return () => clearTimeout(t);
  }, [running, cursor, steps.length, speed, setCursor]);

  const simulate = () => { setCursor(0); setRunning(true); };
  const reset = () => { setRunning(false); setCursor(-1); setBoxes(START_BOXES); };
  const onNodesChange = useCallback((changes) => setBoxes((n) => applyNodeChanges(changes, n)), [setBoxes]);

  const cur = cursor >= 0 ? steps[Math.min(cursor, steps.length - 1)] : null;
  const node = cur ? OP_NODE[cur.op] || null : null;
  const prev = useMemo(() => { for (let i = Math.min(cursor, steps.length) - 1; i >= 0; i--) if (OP_NODE[steps[i].op]) return OP_NODE[steps[i].op]; return null; }, [cursor, steps]);
  const refused = cur?.status >= 400;
  const into = EDGES.filter((e) => e.target === node);
  const litEdge = node ? (into.find((e) => e.source === prev) || into[0])?.id : null;
  const nodes = useMemo(() => boxes.map((n) => ({ ...n, type: "box", data: { ...n.data, on: n.id === node && !refused, deny: n.id === node && refused, dim: !!node && n.id !== node } })), [boxes, node, refused]);
  const edges = useMemo(() => EDGES.map((e) => ({ ...e, animated: e.id === litEdge, className: e.id === litEdge ? (refused ? "edge-deny" : "edge-on") : "", markerEnd: { type: MarkerType.ArrowClosed } })), [litEdge, refused]);

  const caption = cur
    ? `Step ${cursor + 1} of ${steps.length}: ${cur.say || "Time passes on the virtual clock."}${cur.status != null && cur.op === "call" ? (refused ? ` REFUSED ${cur.status}.` : ` Allowed (${cur.status}).`) : ""}`
    : "Press Simulate to walk the steps through the diagram. Drag any box to rearrange it.";

  return (
    <>
      <h2>The agent lifecycle</h2>
      <p className="lede" data-admin-only>Drag any box. Simulate walks the story on screen; with none on screen it plays a built-in path. Refused steps turn red and say so.</p>
      <div className="card controls">
        <label htmlFor="speed">Speed
          <select id="speed" value={speed} onChange={(e) => setSpeed(e.target.value)}>{SPEEDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        </label>
        <button type="button" className="btn primary" onClick={simulate} disabled={running}>Simulate</button>
        <button type="button" className="btn" onClick={reset}>Reset</button>
      </div>
      <div className="flow-wrap" role="group" aria-label="Lifecycle diagram: register, grant, gateway call, rotate by replacement, revoke or retire. Boxes can be dragged.">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} colorMode={theme === "system" ? undefined : theme}
          fitView fitViewOptions={{ padding: 0.12 }} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.2}>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className={`caption${refused ? " caption--deny" : ""}`} role="status" aria-live="polite" data-testid="caption"><Inert text={caption} /></p>
      <ScenarioBar app={app} />
      <StoryPlayer app={app} />
    </>
  );
}
