import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App.jsx";
import { startLive, seedKey } from "./liveServer.js";

let live;
beforeAll(async () => { live = await startLive(); });
afterAll(async () => { await live.stop(); });
beforeEach(async () => { await live.api("POST", "/api/reset"); window.location.hash = "#/registry"; document.documentElement.removeAttribute("data-present"); try { localStorage.clear(); } catch { /* none */ } });
afterEach(cleanup);

const open = async (tab) => {
  render(<App />);
  await screen.findByRole("tablist");
  if (tab) { await userEvent.click(screen.getByRole("tab", { name: tab })); await waitFor(() => expect(screen.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true")); }
};
const pick = (label, value) => userEvent.selectOptions(screen.getByLabelText(label), value);

describe("shell", () => {
  it("shows the Mock label at all times, including in presenter mode, on every tab", async () => {
    await open();
    expect(screen.getByTestId("banner")).toHaveTextContent("simulated registry, not the real product");
    await userEvent.click(screen.getByRole("button", { name: "Present" }));
    expect(document.documentElement.dataset.present).toBe("1");
    for (const t of ["Lifecycle", "Gateway", "Diagram", "Raw", "Registry"]) {
      await userEvent.click(screen.getByRole("tab", { name: t }));
      expect(screen.getByTestId("banner")).toBeVisible();
    }
  });
  it("has the five tabs and moves between them with the arrow keys", async () => {
    await open();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Registry", "Lifecycle", "Gateway", "Diagram", "Raw"]);
    screen.getByRole("tab", { name: "Registry" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Lifecycle" })).toHaveAttribute("aria-selected", "true"));
  });
  it("cycles the theme and the persona changes the cast", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Theme/ }));
    expect(document.documentElement.dataset.theme).toBe("light");
    await pick("Persona and vertical", "banking");
    await waitFor(() => expect(screen.getByText(/Alice registers Payments Agent/)).toBeInTheDocument());
  });
});

describe("register wizard", () => {
  it("registers an agent and shows only a masked key", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Register an agent" }));
    await userEvent.click(screen.getByRole("button", { name: "Register" }));
    const detail = await screen.findByTestId("detail");
    expect(within(detail).getByText(/^sk-MOCK-[A-Z0-9-]{4}\.\.\.[A-Z0-9]{4}$/)).toBeInTheDocument();
    const { data } = await live.api("GET", "/api/registry/keys/travel-agent");
    const full = data.response.spec.VirtualKey;
    expect(full).toMatch(/^sk-MOCK-/);
    expect(document.body.textContent).not.toContain(full);
  });
  it("shows the llm RealKey refusal, then accepts the mock placeholder", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Register an agent" }));
    await userEvent.click(screen.getByLabelText("llm"));
    await userEvent.click(screen.getByRole("button", { name: "Register" }));
    const res = await screen.findByTestId("result");
    expect(res).toHaveTextContent("400 refused");
    expect(res).toHaveTextContent("Spec.RealKey is required for llm scope");
    expect(res).toHaveTextContent("llm-needs-real-key");
    await userEvent.click(screen.getByRole("button", { name: "Use the mock placeholder" }));
    await userEvent.click(screen.getByRole("button", { name: "Register" }));
    await screen.findByTestId("detail");
  });
  it("refuses a real-looking provider key before it leaves the page", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Register an agent" }));
    await userEvent.click(screen.getByLabelText("llm"));
    await userEvent.type(screen.getByLabelText(/Upstream RealKey/), "real-looking-provider-key-0123456789");
    await userEvent.click(screen.getByRole("button", { name: "Register" }));
    expect((await screen.findAllByText(/Only sk-MOCK- values/))[0]).toBeInTheDocument();
    expect((await live.api("GET", "/api/registry/keys")).data.response.items).toHaveLength(0);
  });
  it("registers a workload identity with no static secret", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Register an agent" }));
    await userEvent.click(screen.getByLabelText("Workload identity (no static secret)"));
    expect(screen.getByLabelText("llm")).toBeDisabled();
    expect(screen.getByText(/gateway accepts these on mcp and llm routes is UNVERIFIED/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Register" }));
    const detail = await screen.findByTestId("detail");
    expect(detail).toHaveTextContent("workload identity, no static secret");
  });
  it("shows a duplicate name as the 409 it is", async () => {
    await seedKey(live.api);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Register an agent" }));
    await userEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(await screen.findByTestId("result")).toHaveTextContent("409 refused");
  });
});

describe("grant, call, revoke", () => {
  it("a bare 403 until granted, 200 after, 401 once revoked", async () => {
    await seedKey(live.api);
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Open travel-agent" }));
    // Gateway before the grant
    await userEvent.click(screen.getByRole("tab", { name: "Gateway" }));
    await userEvent.click(await screen.findByRole("button", { name: "Send call" }));
    expect(await screen.findByText(/403 Forbidden: call refused/)).toBeInTheDocument();
    expect(screen.getByTestId("gw-log")).toHaveTextContent("policy denied");
    // Grant
    await userEvent.click(screen.getByRole("tab", { name: "Registry" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open travel-agent" }));
    await userEvent.click(screen.getByRole("button", { name: "Grant to an app" }));
    await userEvent.click(screen.getByRole("button", { name: "Grant" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove grant flights-mcp" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("tab", { name: "Gateway" }));
    await userEvent.click(await screen.findByRole("button", { name: "Send call" }));
    expect(await screen.findByText(/200 OK: call allowed/)).toBeInTheDocument();
    // Revoke (two clicks)
    await userEvent.click(screen.getByRole("tab", { name: "Registry" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open travel-agent" }));
    await userEvent.click(screen.getByRole("button", { name: "Revoke / retire" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm revoke travel-agent" }));
    await waitFor(() => expect(within(screen.getByTestId("detail")).getAllByText("revoked").length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole("tab", { name: "Gateway" }));
    await userEvent.click(await screen.findByRole("button", { name: "Send call" }));
    expect(await screen.findByText(/401 Unauthorized: call refused/)).toBeInTheDocument();
    expect(screen.getByTestId("gw-log")).toHaveTextContent("is revoked");
  });
  it("429 with a burst over an RPM cap, cleared by the virtual clock", async () => {
    await live.api("POST", "/api/registry/keys", { name: "llm-agent", spec: { Scopes: ["llm"], Provider: "anthropic", AllowedModels: ["mock-model-small"], RealKey: "sk-MOCK-REAL-UPSTREAM-PLACEHOLDER", Custodian: "Mark", RPMLimit: 3 } });
    await open("Gateway");
    await pick("Route", "llm");
    await userEvent.click(screen.getByRole("button", { name: "Send 5 calls" }));
    expect(await screen.findByTestId("burst")).toHaveTextContent("200, 200, 200, 429, 429");
    expect(screen.getByTestId("gw-response")).toHaveTextContent("tokens_rate_limit_exceeded");
    await userEvent.click(screen.getByRole("button", { name: "+61 seconds" }));
    await userEvent.click(screen.getByRole("button", { name: "Send call" }));
    expect(await screen.findByText(/200 OK: call allowed/)).toBeInTheDocument();
  });
  it("an unknown key is a 401 and the wire does not say why", async () => {
    await open("Gateway");
    await pick("Credential", "__unknown__");
    await userEvent.click(screen.getByRole("button", { name: "Send call" }));
    expect(await screen.findByText(/401 Unauthorized: call refused/)).toBeInTheDocument();
    expect(screen.getByTestId("gw-response")).not.toHaveTextContent("unknown");
    expect(screen.getByTestId("gw-log")).toHaveTextContent("unknown key");
  });
  it("a workload token call is accepted with matching claims, rejected with another audience", async () => {
    await live.api("POST", "/api/registry/keys", { name: "wl-agent", spec: { Scopes: ["mcp"], WorkloadIdentity: { Issuer: "https://issuer.example.invalid/x", Audience: "https://gateway.example.invalid/x", Subject: "spiffe://x.example.invalid/a" } } });
    await live.api("POST", "/api/registry/grants", { keyName: "wl-agent", app: "flights-mcp" });
    await open("Gateway");
    await userEvent.click(screen.getByRole("button", { name: "Send call" }));
    expect(await screen.findByText(/200 OK: call allowed/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Audience"));
    await userEvent.type(screen.getByLabelText("Audience"), "https://elsewhere.example.invalid");
    await userEvent.click(screen.getByRole("button", { name: "Send call" }));
    expect(await screen.findByText(/401 Unauthorized: call refused/)).toBeInTheDocument();
    expect(screen.getByTestId("gw-log")).toHaveTextContent("workload token rejected");
  });
});

describe("rotate by replacement", () => {
  it("explains that in-place rotation does not exist and shows the PUT doing nothing", async () => {
    await seedKey(live.api);
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Open travel-agent" }));
    await userEvent.click(screen.getByRole("button", { name: "Rotate by replacement" }));
    expect(screen.getByText(/There is no in-place rotation/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Try in-place rotation/ }));
    const r = await screen.findByTestId("inplace-result");
    expect(r).toHaveTextContent("200 came back, and nothing changed");
    expect(r).toHaveTextContent("(identical)");
  });
  it("runs snapshot, successor, verify, revoke old, and the old key then gets 401", async () => {
    await seedKey(live.api);
    await live.api("POST", "/api/registry/grants", { keyName: "travel-agent", app: "flights-mcp", tools: ["search_flights"] });
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Open travel-agent" }));
    await userEvent.click(screen.getByRole("button", { name: "Rotate by replacement" }));
    await userEvent.click(screen.getByRole("button", { name: "Start rotation" }));
    const steps = await screen.findByTestId("rotate-steps");
    const items = within(steps).getAllByRole("listitem").map((l) => l.textContent);
    expect(items[0]).toMatch(/1\. Snapshot/);
    expect(items.some((t) => /3\. Verify with a real call: done/.test(t))).toBe(true);
    expect(items.at(-1)).toMatch(/4\. Revoke the old key: done/);
    const list = (await live.api("GET", "/api/registry/keys")).data.response.items;
    expect(list.map((k) => [k.name, k.state])).toEqual([["travel-agent", "revoked"], ["travel-agent-v2", "active"]]);
  });
  it("a successor with the same name is refused and the old key is untouched", async () => {
    await seedKey(live.api);
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Open travel-agent" }));
    await userEvent.click(screen.getByRole("button", { name: "Rotate by replacement" }));
    await userEvent.clear(screen.getByLabelText(/Successor name/));
    await userEvent.type(screen.getByLabelText(/Successor name/), "travel-agent");
    await userEvent.click(screen.getByRole("button", { name: "Start rotation" }));
    expect((await screen.findAllByText(/400 refused/))[0]).toBeInTheDocument();
    expect((await live.api("GET", "/api/registry/keys/travel-agent")).data.response.state).toBe("active");
  });
});

describe("the grants-by-name trap", () => {
  it("delete then re-register the same name: the new key silently inherits the grant, and the page says so", async () => {
    await seedKey(live.api);
    await live.api("POST", "/api/registry/grants", { keyName: "travel-agent", app: "flights-mcp" });
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Open travel-agent" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete (destructive)" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm delete travel-agent" }));
    expect(await screen.findByText(/no such key exists/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Register an agent" }));
    await userEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(await screen.findByText(/inherited access to flights-mcp without anyone granting it/)).toBeInTheDocument();
  });
  it("refuses to delete an llm key whose RealKey you have not shown", async () => {
    await live.api("POST", "/api/registry/keys", { name: "llm-agent", spec: { Scopes: ["llm"], Provider: "anthropic", AllowedModels: [], RealKey: "sk-MOCK-REAL-UPSTREAM-PLACEHOLDER", Custodian: "Mark" } });
    await open();
    await userEvent.click(await screen.findByRole("button", { name: "Open llm-agent" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete (destructive)" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm delete llm-agent" }));
    const res = await screen.findByTestId("result");
    expect(res).toHaveTextContent("409 refused");
    expect(res).toHaveTextContent("never-delete-llm-without-real-key");
    expect(res).toHaveTextContent("demo-guard");
  });
});

describe("story player", () => {
  it("runs a story, steps through it with the trace, and shows its rules", async () => {
    await open("Lifecycle");
    await userEvent.click(screen.getByRole("button", { name: "Run story" }));
    expect(await screen.findByTestId("verdict")).toHaveTextContent("Behaves as written");
    expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next step" }));
    await userEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByTestId("step-detail")).toHaveTextContent("traceparent: 00-");
    expect(screen.getByTestId("step-request")).toHaveTextContent("POST /flights-mcp/mcp");
    expect(screen.getAllByTestId("rule-note").length).toBeGreaterThan(0);
  });
  it("a refusal story says refused, in words, on the step tags", async () => {
    await open("Lifecycle");
    await pick("Story", "S02");
    await userEvent.click(screen.getByRole("button", { name: "Run story" }));
    expect(await screen.findByText("refused 401")).toBeInTheDocument();
  });
  it("lists the rules with UNVERIFIED marked", async () => {
    await open("Lifecycle");
    expect(screen.getAllByText("UNVERIFIED").length).toBeGreaterThan(0);
  });
  it("live events appear after a registry change", async () => {
    await seedKey(live.api);
    await open("Lifecycle");
    expect(await screen.findByTestId("events")).toHaveTextContent("key.created");
  });
});

describe("raw tab and reset", () => {
  it("shows the live gateway trace with a traceparent and a masked key", async () => {
    await seedKey(live.api);
    await live.api("POST", "/api/registry/grants", { keyName: "travel-agent", app: "flights-mcp" });
    const full = (await live.api("GET", "/api/registry/keys/travel-agent")).data.response.spec.VirtualKey;
    await open("Gateway");
    await userEvent.click(screen.getByRole("button", { name: "Send call" }));
    await screen.findByText(/200 OK: call allowed/);
    await userEvent.click(screen.getByRole("tab", { name: "Raw" }));
    expect(await screen.findByTestId("raw-request")).toHaveTextContent(/traceparent: 00-[0-9a-f]{32}-[0-9a-f]{16}-01/);
    expect(screen.getByTestId("raw-request")).toHaveTextContent(/authorization: Bearer sk-MOCK-[A-Z0-9-]{4}\.\.\.[A-Z0-9]{4}/);
    expect(document.body.textContent).not.toContain(full);
  });
  it("Reset forgets every key and clears the screen", async () => {
    await seedKey(live.api);
    await open();
    await screen.findByRole("button", { name: "Open travel-agent" });
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(await screen.findByTestId("empty")).toBeInTheDocument();
    expect((await live.api("GET", "/api/registry/keys")).data.response.items).toHaveLength(0);
  });
});
