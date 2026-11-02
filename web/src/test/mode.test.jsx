import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { TABS } from "../App.jsx";
import { startLive } from "./liveServer.js";

// The real server app, two flavours: a normal build (Mock only) and a build with Real configured (test seam).
let live;
beforeEach(() => { window.location.hash = "#/registry"; try { localStorage.clear(); } catch { /* none */ } });
afterEach(async () => { cleanup(); await live?.stop(); live = null; });
const header = (container) => container.querySelector("header.top");
const counting = () => { const calls = []; const f = globalThis.fetch; globalThis.fetch = (u, i = {}) => { calls.push(`${i.method || "GET"} ${u}`); return f(u, i); }; return calls; };

describe("Mock/Real toggle", () => {
  it("is in the header on every tab: Mock pressed, Real disabled with the server's reason as its tooltip", async () => {
    live = await startLive();
    const { container } = render(<App />);
    for (const [, label] of TABS) {
      await screen.findByRole("tablist");
      await userEvent.click(screen.getByRole("tab", { name: label }));
      await waitFor(() => expect(screen.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true"));
      const mock = await within(header(container)).findByRole("button", { name: "Mock" });
      await waitFor(() => expect(mock).toHaveAttribute("aria-pressed", "true"));
      const real = within(header(container)).getByRole("button", { name: "Real" });
      expect(real).toHaveAttribute("aria-pressed", "false");
      expect(real).toBeDisabled();
      expect(real).toHaveAttribute("title", expect.stringMatching(/no real server to call/));
    }
  });

  it("clicking the toggle POSTs the mode, refetches info and the page's data, and the pressed button follows (both directions)", async () => {
    live = await startLive({ realAvailable: true });
    const calls = counting();
    render(<App />);
    const real = await screen.findByRole("button", { name: "Real" });
    await waitFor(() => expect(real).toHaveAttribute("aria-pressed", "true"));
    await screen.findByRole("tablist");
    const count = (c) => calls.filter((x) => x === c).length;
    const before = { keys: count("GET /api/registry/keys"), catalog: count("GET /api/catalog"), info: count("GET /api/info") };

    await userEvent.click(screen.getByRole("button", { name: "Mock" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Mock" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "Real" })).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(count("GET /api/registry/keys")).toBe(before.keys + 1));
    expect(count("POST /api/mode")).toBe(1);
    expect(count("GET /api/catalog")).toBe(before.catalog + 1);
    expect((await live.api("GET", "/api/info")).data.source).toBe("mock");

    await userEvent.click(screen.getByRole("button", { name: "Real" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Real" })).toHaveAttribute("aria-pressed", "true"));
    await waitFor(() => expect(count("GET /api/registry/keys")).toBe(before.keys + 2));
    expect(count("POST /api/mode")).toBe(2);
    expect((await live.api("GET", "/api/info")).data.source).toBe("real");
  });

  it("a refused switch shows the server's message and leaves the pressed button alone", async () => {
    live = await startLive({ realAvailable: true });
    render(<App />);
    const real = await screen.findByRole("button", { name: "Real" });
    await waitFor(() => expect(real).toBeEnabled());
    const f = globalThis.fetch;
    globalThis.fetch = (u, i = {}) => (u === "/api/mode" ? Promise.resolve({ status: 409, json: async () => ({ message: "Real mode is not available: nothing to call." }) }) : f(u, i));
    await userEvent.click(screen.getByRole("button", { name: "Mock" }));
    expect(await screen.findByTestId("mode-error")).toHaveTextContent("Real mode is not available: nothing to call.");
    expect(screen.getByRole("button", { name: "Real" })).toHaveAttribute("aria-pressed", "true");
  });
});
