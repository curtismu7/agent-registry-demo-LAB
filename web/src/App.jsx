import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCatalog, loadWorld, resetServer, runScenario } from "./lib/api.js";
import { fill } from "./lib/fill.js";
import RegistryTab from "./tabs/RegistryTab.jsx";
import LifecycleTab from "./tabs/LifecycleTab.jsx";
import GatewayTab from "./tabs/GatewayTab.jsx";
import DiagramTab, { START_BOXES } from "./tabs/DiagramTab.jsx";
import RawTab from "./tabs/RawTab.jsx";

export const TABS = [["registry", "Registry"], ["lifecycle", "Lifecycle"], ["gateway", "Gateway"], ["diagram", "Diagram"], ["raw", "Raw"]];
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const tabFromHash = () => { const id = window.location.hash.replace(/^#\/?/, "").split("?")[0]; return TABS.some(([t]) => t === id) ? id : "registry"; };

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [world, setWorld] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState(tabFromHash);
  const [theme, setTheme] = useState(() => (["light", "dark"].includes(read("areg.theme", "")) ? read("areg.theme", "") : "system"));
  const [present, setPresent] = useState(() => read("areg.present", "0") === "1");

  const refresh = useCallback(async () => { const w = await loadWorld(); setWorld(w); return w; }, []);
  useEffect(() => { Promise.all([getCatalog(), refresh()]).then(([c]) => setCatalog(c)).catch((e) => setLoadError(e.message)); }, [refresh]);
  useEffect(() => { const on = () => setTab(tabFromHash()); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  useEffect(() => { if (theme === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { if (present) document.documentElement.dataset.present = "1"; else delete document.documentElement.dataset.present; }, [present]);

  const shell = (body) => (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <div className="banner" role="note" data-testid="banner">
        <strong>Mock only: simulated registry, not the real product.</strong> An in-process stand-in for the Agent Registry and gateway. No tenant, no outbound network, every key is an obviously fake <code>sk-MOCK-</code> value, and every address is a reserved <code>.invalid</code> name.
      </div>
      {body}
    </>
  );
  if (loadError) return shell(<main className="page" id="main" tabIndex={-1}><p className="alert" role="alert">Could not reach the mock server: {loadError}</p></main>);
  if (!catalog || !world) return shell(<main className="page" id="main" tabIndex={-1}><p className="muted" role="status">Loading the mock registry...</p></main>);
  return shell(<Shell catalog={catalog} setCatalog={setCatalog} world={world} refresh={refresh} tab={tab} theme={theme} setTheme={setTheme} present={present} setPresent={setPresent} />);
}

function Shell({ catalog, setCatalog, world, refresh, tab, theme, setTheme, present, setPresent }) {
  const [run, setRun] = useState(null);
  const [scenarioId, setScenarioId] = useState(catalog.scenarios[0].id);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [cursor, setCursor] = useState(-1);
  const [boxes, setBoxes] = useState(START_BOXES);
  const [selected, setSelected] = useState(null);
  const [live, setLive] = useState([]);
  const [resetNote, setResetNote] = useState("");
  const tabRefs = useRef({});

  const cast = useMemo(() => catalog.verticals.find((v) => v.id === catalog.vertical)?.cast || {}, [catalog]);
  const addLive = useCallback((m) => setLive((l) => [...l, m]), []);

  const pickVertical = useCallback(async (id) => {
    const next = await getCatalog(id);
    setCatalog(next); setRun(null); setCursor(-1);
  }, [setCatalog]);

  const doRun = useCallback(async () => {
    setRunning(true); setRunError(null);
    try { setRun(await runScenario(scenarioId, catalog.vertical)); setCursor(0); }
    catch (e) { setRunError(e.message); } finally { setRunning(false); }
  }, [scenarioId, catalog.vertical]);

  const resetAll = useCallback(async () => {
    try { await resetServer(); await refresh(); setRun(null); setCursor(-1); setBoxes(START_BOXES); setSelected(null); setLive([]); setResetNote("Reset: every mock key, grant, usage counter and event is gone, and the diagram is back to its starting positions."); }
    catch (e) { setResetNote(`Reset failed: ${e.message}`); }
  }, [refresh]);

  const cycle = () => { const next = { system: "light", light: "dark", dark: "system" }[theme]; setTheme(next); write("areg.theme", next); };
  const togglePresent = () => { write("areg.present", present ? "0" : "1"); setPresent(!present); };
  const go = (id) => { window.location.hash = `#/${id}`; };
  const onTabKey = (e) => {
    const i = TABS.findIndex(([id]) => id === tab);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const [id] = TABS[(to + TABS.length) % TABS.length];
    go(id); tabRefs.current[id]?.focus();
  };

  const app = { catalog, cast, world, refresh, selected, setSelected, live, addLive, run, scenarioId, setScenarioId, doRun, running, runError, cursor, setCursor, boxes, setBoxes, present, theme, go };
  const Panel = { registry: RegistryTab, lifecycle: LifecycleTab, gateway: GatewayTab, diagram: DiagramTab, raw: RawTab }[tab];

  return (
    <>
      <header className="top">
        <h1><span className="mark" aria-hidden="true">REG</span> Agent Registry Lifecycle</h1>
        <div className="tools-right">
          <label className="inline">Persona
            <select value={catalog.vertical} onChange={(e) => pickVertical(e.target.value)} aria-label="Persona and vertical">
              {catalog.verticals.map((v) => <option key={v.id} value={v.id}>{v.name}: {v.cast.custodian} and {v.cast.agent}</option>)}
            </select>
          </label>
          <button type="button" className="btn" onClick={resetAll}>Reset</button>
          <button type="button" className="btn" aria-pressed={present} onClick={togglePresent}>Present</button>
          <button type="button" className="btn" onClick={cycle} title="Theme: system, light, dark">Theme: {theme}</button>
        </div>
      </header>
      <p className="muted page" role="status" data-testid="reset-note" style={{ paddingBottom: 0, paddingTop: 0 }}>{resetNote}</p>
      <div className="tabbar" role="tablist" aria-label="Sections" onKeyDown={onTabKey}>
        {TABS.map(([id, label]) => (
          <button key={id} id={`tab-${id}`} ref={(el) => { tabRefs.current[id] = el; }} type="button" role="tab" aria-selected={id === tab} aria-controls="main" tabIndex={id === tab ? 0 : -1} className="tab" onClick={() => go(id)}>{label}</button>
        ))}
      </div>
      <main className="page" id="main" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1}>
        <p className="lede" data-admin-only>{fill("{{custodian}} registers {{agent_label}}, grants it to {{app}}, rotates it by replacement and retires it. Switch the persona to change the cast.", cast)}</p>
        <Panel app={app} />
      </main>
    </>
  );
}
