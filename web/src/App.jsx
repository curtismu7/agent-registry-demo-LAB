import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShelfLink from "./components/ShelfLink.jsx";
import ReturnLink from "./return-link/ReturnLink.jsx";
import { readReturnContext } from "./return-link/returnTargets.js";
import { scenarioFor, verticalFor } from "./handoffMap.js";
import { getCatalog, getInfo, loadWorld, resetServer, runScenario, setMode } from "./lib/api.js";
import { fill } from "./lib/fill.js";
import RegistryTab from "./tabs/RegistryTab.jsx";
import LifecycleTab from "./tabs/LifecycleTab.jsx";
import GatewayTab from "./tabs/GatewayTab.jsx";
import DiagramTab, { START_BOXES } from "./tabs/DiagramTab.jsx";
import RawTab from "./tabs/RawTab.jsx";
import TopMenu from "./top-menu/TopMenu.jsx";
import { setPresenter, initPresenter, presenterOn } from "./presenter.js";

export const TABS = [["registry", "Registry"], ["lifecycle", "Lifecycle"], ["gateway", "Gateway"], ["diagram", "Diagram"], ["raw", "Raw"]];
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const tabFromHash = () => { const id = window.location.hash.replace(/^#\/?/, "").split("?")[0]; return TABS.some(([t]) => t === id) ? id : "registry"; };

export default function App() {
  // Opened from Customer Agent LAB: preselect the matching story (Lifecycle tab) and persona (handoffMap.js), once, on load.
  const [handoff] = useState(() => readReturnContext(window.location.search));
  const [catalog, setCatalog] = useState(null);
  const [world, setWorld] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [info, setInfo] = useState(null);
  const [reload, setReload] = useState(0); // bumped after a switch: the page below remounts and shows freshly fetched data
  const [modeError, setModeError] = useState("");
  const [tab, setTab] = useState(() => (!window.location.hash && scenarioFor(handoff) ? "lifecycle" : tabFromHash()));
  const [theme, setTheme] = useState(() => (["light", "dark"].includes(read("areg.theme", "")) ? read("areg.theme", "") : "system"));
  const [present, setPresent] = useState(() => read("areg.present", "0") === "1");

  const refresh = useCallback(async () => { const w = await loadWorld(); setWorld(w); return w; }, []);
  useEffect(() => { Promise.all([getCatalog(verticalFor(handoff) || undefined), refresh()]).then(([c]) => setCatalog(c)).catch((e) => setLoadError(e.message)); }, [refresh, handoff]);
  useEffect(() => { getInfo().then(setInfo).catch(() => setInfo(null)); }, []);
  useEffect(() => { const on = () => setTab(tabFromHash()); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  useEffect(() => { if (theme === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { if (present) document.documentElement.dataset.present = "1"; else delete document.documentElement.dataset.present; }, [present]);

  const selectMode = useCallback(async (source) => {
    setModeError("");
    try {
      setInfo(await setMode(source));
      const [c] = await Promise.all([getCatalog(), refresh()]);
      setCatalog(c);
      setReload((n) => n + 1);
    } catch (e) {
      setModeError(e.message);
      getInfo().then(setInfo).catch(() => {});
    }
  }, [refresh]);

  const shell = (body) => (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <div className="banner" role="note" data-testid="banner">
        <strong>Mock only: simulated registry, not the real product.</strong> An in-process stand-in for the Agent Registry and gateway. No tenant, no outbound network, every key is an obviously fake <code>sk-MOCK-</code> value, and every address is a reserved <code>.invalid</code> name.
      </div>
      <ReturnLink app="agent-registry-demo" />
      {body}
    </>
  );
  return shell(<Shell key={reload} loadError={loadError} ready={Boolean(catalog && world)} info={info} onSelectMode={selectMode} modeError={modeError} catalog={catalog} setCatalog={setCatalog} world={world} refresh={refresh} tab={tab} theme={theme} setTheme={setTheme} present={present} setPresent={setPresent} initialScenario={scenarioFor(handoff)} />);
}

function Shell({ loadError, ready, info, onSelectMode, modeError, catalog, setCatalog, world, refresh, tab, theme, setTheme, present, setPresent, initialScenario }) {
  if (loadError) return <main className="page" id="main" tabIndex={-1}><p className="alert" role="alert">Could not reach the mock server: {loadError}</p></main>;
  if (!ready) return <main className="page" id="main" tabIndex={-1}><p className="muted" role="status">Loading the mock registry...</p></main>;
  const [run, setRun] = useState(null);
  const [scenarioId, setScenarioId] = useState(() => (catalog.scenarios.some((s) => s.id === initialScenario) ? initialScenario : catalog.scenarios[0].id));
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

  const setThemePersist = (t) => { setTheme(t); write("areg.theme", t); };
  useEffect(() => { initPresenter(); }, []);
  const togglePresent = useCallback(() => setPresenter(!presenterOn()), []);

  const go = (id) => { window.location.hash = `#/${id}`; };
  const onTabKey = (e) => {
    const focused = TABS.findIndex(([id]) => tabRefs.current[id] === document.activeElement);
    const i = focused >= 0 ? focused : TABS.findIndex(([id]) => id === tab);
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
      <header className="shell-bar">
        <span className="shell-brand">
          <span className="shell-logo" aria-hidden="true">AR</span>
          <h1>Agent Registry Lifecycle</h1>
        </span>
        <div className="tools-right shell-right">
            <ReturnLink app="agent-registry-demo" variant="header" />
            <ShelfLink />
          <span className="mode-toggle" style={{ display: "contents" }}>
            <TopMenu
              mode={{ value: info?.source === "real" ? "real" : "mock", onChange: onSelectMode, realAvailable: info ? info.realAvailable === true : null, realHint: info?.realReason }}
              vertical={{ value: catalog.vertical, onChange: pickVertical, options: catalog.verticals.map((v) => v.id) }}
              theme={{ value: theme === "system" ? "auto" : theme, onChange: setThemePersist }}
              present={{ active: present, onToggle: togglePresent, label: "Present" }}
              help={{ href: "https://github.com/curtismu7/agent-registry-demo-LAB#readme" }}
              version={info?.version || null}
              onReset={resetAll}
            />
          </span>
        </div>
      </header>
      {modeError && <p className="alert page" role="alert" data-testid="mode-error">{modeError}</p>}
      <p className="muted page" role="status" data-testid="reset-note" style={{ paddingBottom: 0, paddingTop: 0 }}>{resetNote}</p>
      <div className="tabbar shell-nav" role="tablist" aria-label="Sections" onKeyDown={onTabKey}>
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
