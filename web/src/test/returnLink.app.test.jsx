// Opened from Customer Agent LAB: strip right below the simulation banner, Back in the header tools, the mapped story and persona preselected.
import React from "react";
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../App.jsx";
import ReturnLink from "../return-link/ReturnLink.jsx";
import { returnLinkFor } from "../return-link/returnTargets.js";
import { UC_SCENARIO, VERTICAL_MAP, scenarioFor, verticalFor } from "../handoffMap.js";
import { SCENARIOS, VERTICALS } from "../../../server/src/stories.js";
import { startLive } from "./liveServer.js";

let live;
beforeAll(async () => { live = await startLive(); });
afterAll(async () => { await live.stop(); });
beforeEach(async () => { await live.api("POST", "/api/reset"); });
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

const NOTE = { name: "Opened from Customer Agent LAB" };

describe("return link", () => {
  it("the vendored files match return-link.sha256, which names the parent commit", () => {
    const dir = path.join(process.cwd(), "src", "return-link") + path.sep; // vitest runs in web/
    const text = fs.readFileSync(`${dir}return-link.sha256`, "utf8");
    expect(text.split("\n")[0]).toMatch(/^# vendored byte for byte from curtismu7\/AI-DEMO-Standalone shared\/return-link at [0-9a-f]{7,40}/);
    const pins = text.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(/\s+/));
    expect(pins.map(([, f]) => f).sort()).toEqual(["ReturnLink.jsx", "ReturnLink.test.jsx", "returnTargets.js"]);
    for (const [h, f] of pins) expect(createHash("sha256").update(fs.readFileSync(dir + f)).digest("hex"), f).toBe(h);
  });

  it("every mapped use case names a real story, every mapped vertical a real persona", () => {
    for (const s of Object.values(UC_SCENARIO)) expect(SCENARIOS.map((x) => x.id)).toContain(s);
    for (const v of Object.values(VERTICAL_MAP)) expect(VERTICALS.map((x) => x.id)).toContain(v);
    expect(scenarioFor({ uc: "UC-NHI2" })).toBeNull();
    expect(scenarioFor({ uc: "toString" })).toBeNull();
    expect(verticalFor({ vertical: "constructor" })).toBeNull();
  });

  it("UC39 in banking: banner then strip, header Back, Lifecycle tab with S02 and the banking persona", async () => {
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC39&vertical=banking");
    render(<App />);
    const strip = screen.getByRole("note", NOTE);
    expect(strip.textContent).toContain("UC39");
    expect(screen.getByTestId("banner").nextElementSibling).toBe(strip);
    await screen.findByRole("tablist");
    expect(screen.getAllByRole("button", { name: /Back to Customer Agent LAB/ })).toHaveLength(2);
    expect(document.querySelector("header.shell-bar .tools-right > button.return-link--header")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Lifecycle" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByLabelText("Story")).toHaveValue("S02"));
    expect(screen.getByTestId("vertical-select")).toHaveValue("banking");
  });

  it("UC-NHI2 (no matching story): strip only, defaults kept", async () => {
    window.history.replaceState(null, "", "/?from=customer-agent&uc=UC-NHI2&vertical=healthcare");
    render(<App />);
    expect(screen.getByRole("note", NOTE)).toBeTruthy();
    await screen.findByRole("tablist");
    expect(screen.getByRole("tab", { name: "Registry" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("vertical-select")).toHaveValue(VERTICALS[0].id);
  });
  it("?from=ai-demo-standalone: the strip names AI Demo Standalone; Back goes to /ai-demo-standalone/", () => {
    window.history.replaceState(null, "", "/?from=ai-demo-standalone&uc=UC-NHI2");
    expect(returnLinkFor("agent-registry-demo").label).toBe("AI Demo Standalone");
    expect(returnLinkFor("agent-registry-demo").href).toBe("http://127.0.0.1:7810/?returned=agent-registry-demo&uc=UC-NHI2");
  });


  it("no from, an unknown from or a bad id: no strip, no button", async () => {
    for (const q of ["/", "/?from=elsewhere&uc=UC19", "/?from=customer-agent&uc=%3Cb%3E", "/?from=customer-agent&uc=UC19&vertical=a%20b"]) {
      window.history.replaceState(null, "", q);
      render(<App />);
      await screen.findByRole("tablist");
      expect(screen.queryByRole("note", NOTE)).toBeNull();
      expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
      cleanup();
    }
  });

  it("Back goes to the proxy path under /agent-registry-demo/, the direct URL at the root", () => {
    const navigate = vi.fn();
    const search = "?from=customer-agent&uc=UC19";
    render(<ReturnLink app="agent-registry-demo" navigate={navigate} location={{ pathname: "/agent-registry-demo/", search }} />);
    fireEvent.click(screen.getByRole("button", { name: /Back to/ }));
    expect(navigate).toHaveBeenLastCalledWith("/customer-agent/?returned=agent-registry-demo&uc=UC19");
    cleanup();
    render(<ReturnLink app="agent-registry-demo" navigate={navigate} location={{ pathname: "/", search }} />);
    fireEvent.click(screen.getByRole("button", { name: /Back to/ }));
    expect(navigate).toHaveBeenLastCalledWith("http://127.0.0.1:5603/?returned=agent-registry-demo&uc=UC19");
  });
});
