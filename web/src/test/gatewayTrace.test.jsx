// "What Privilege did" (rule 25) in the page: the panel appears under a Gateway call and under a story's gateway step (Mock), not under a
// registry step, and shows the decisions the lab's gateway computed (checked). Real: one button runs the gateway check against a fake door.
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App.jsx";
import { setJsonView } from "../components/JsonPane.jsx";
import { startLive, seedKey } from "./liveServer.js";
import { startFakeGateway } from "../../../server/test/fakeGateway.js";

let live;
beforeEach(() => { setJsonView("raw"); window.location.hash = "#/registry"; try { localStorage.clear(); } catch { /* none */ } });
afterEach(async () => { cleanup(); await live?.stop(); live = null; });

const open = async (tab) => {
  render(<App />);
  await screen.findByRole("tablist");
  if (tab) { await userEvent.click(screen.getByRole("tab", { name: tab })); await waitFor(() => expect(screen.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true")); }
};

describe("What Privilege did: Mock", () => {
  it("Gateway tab: a call shows the panel with the request, the response and each decision marked checked by the simulation", async () => {
    live = await startLive();
    await seedKey(live.api);
    await live.api("POST", "/api/registry/grants", { keyName: "travel-agent", app: "flights-mcp" });
    await open("Gateway");
    expect(screen.queryByTestId("gateway-trace")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Send call" }));
    const panel = await screen.findByTestId("gateway-trace");
    expect(within(panel).getByTestId("gateway-trace-basis")).toHaveTextContent(/Simulated/);
    const decisions = within(panel).getByTestId("trace-1-decisions");
    expect(decisions.querySelectorAll("li")).toHaveLength(4);
    expect(decisions).toHaveTextContent("Authentication");
    expect(decisions).toHaveTextContent("Grant");
    expect(within(panel).getByTestId("trace-1")).toHaveTextContent("HTTP 200");
    expect(within(panel).getByTestId("trace-1-request-box")).toHaveTextContent("POST https://gateway.example.invalid/flights-mcp/mcp");
    expect(within(panel).getByTestId("trace-1-request-box")).toHaveTextContent(/sk-MOCK-[A-Z0-9-]{4}\.\.\.[A-Z0-9]{4}/);
    expect(within(panel).getByTestId("trace-1-response-box")).toHaveTextContent("HTTP 200");
  });

  it("Gateway tab: a refusal shows where the chain stopped, and the checks after it as not reached", async () => {
    live = await startLive();
    await open("Gateway"); // no key in the registry: the credential is one it never issued
    await userEvent.click(screen.getByRole("button", { name: "Send call" }));
    const panel = await screen.findByTestId("gateway-trace");
    const decisions = within(panel).getByTestId("trace-1-decisions");
    expect(within(panel).getByTestId("trace-1")).toHaveTextContent("HTTP 401");
    expect(within(panel).getByTestId("trace-1")).toHaveTextContent("refused at: Authentication");
    expect(decisions.querySelectorAll('li[data-outcome="fail"]')).toHaveLength(1);
    expect(decisions.querySelectorAll('li[data-outcome="skipped"]')).toHaveLength(3);
    expect(decisions).toHaveTextContent("NOT REACHED");
  });

  it("Lifecycle tab: a story's gateway step shows the panel, a registry step does not", async () => {
    live = await startLive();
    await open("Lifecycle");
    await userEvent.click(screen.getByRole("button", { name: "Run story" }));
    expect(await screen.findByTestId("verdict")).toHaveTextContent("Behaves as written");
    expect(screen.queryByTestId("gateway-trace")).toBeNull(); // step 1 registers a key
    await userEvent.click(screen.getByRole("button", { name: "Next step" }));
    await userEvent.click(screen.getByRole("button", { name: "Next step" }));
    const panel = await screen.findByTestId("gateway-trace");
    expect(within(screen.getByTestId("step-detail")).getByTestId("gateway-trace")).toBe(panel);
    expect(panel).toHaveTextContent("Decisions the gateway made");
  });
});

describe("What Privilege did: Real", () => {
  const ENV = ["STANDALONE_ENV", "ARG_GW_URL", "ARG_GW_APPS", "ARG_GW_KEY_TESTER"];
  let saved; let gw; let key;
  beforeEach(async () => {
    saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    key = `fake-key-${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
    gw = await startFakeGateway({ key });
    Object.assign(process.env, { STANDALONE_ENV: "/nonexistent/none.env", ARG_GW_URL: gw.origin, ARG_GW_APPS: "flights-mcp", ARG_GW_KEY_TESTER: key });
  });
  afterEach(async () => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    await gw.close();
  });

  it("the panel is not on the page until asked; then it shows each exchange as inferred or observed, with no key", async () => {
    live = await startLive();
    await open("Gateway");
    expect(await screen.findByTestId("real-trace-run")).toBeInTheDocument();
    expect(screen.queryByTestId("gateway-trace")).toBeNull();
    await userEvent.click(screen.getByTestId("real-trace-run"));
    const panel = await screen.findByTestId("gateway-trace");
    expect(within(panel).getByTestId("gateway-trace-basis")).toHaveTextContent(/Real gateway/);
    expect(within(panel).getByTestId("trace-1")).toHaveTextContent("HTTP 200");
    expect(within(panel).getByTestId("trace-2")).toHaveTextContent("HTTP 403");
    expect(within(panel).getAllByText("inferred from the outcome").length).toBeGreaterThan(0);
    expect(within(panel).getByTestId("trace-1-request-box")).toHaveTextContent(/Bearer <agent key, \d+ characters, kept on the server>/);
    expect(document.body.textContent).not.toContain(key);
  });

  it("without Real configured the button is not offered", async () => {
    for (const k of ENV) delete process.env[k];
    process.env.STANDALONE_ENV = "/nonexistent/none.env";
    live = await startLive();
    await open("Gateway");
    await screen.findByTestId("privilege-check");
    expect(screen.queryByTestId("real-trace-run")).toBeNull();
  });
});
