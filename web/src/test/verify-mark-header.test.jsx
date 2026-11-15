import React from "react";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import App from "../App.jsx";
import { startLive } from "./liveServer.js";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy
// that call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
let live;
beforeAll(async () => { live = await startLive(); });
afterAll(async () => { await live.stop(); });
afterEach(() => { cleanup(); window.location.hash = ""; });

const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
function withShelf(payload) {
  const real = globalThis.fetch;
  globalThis.fetch = (url, init) => (url === "/api/shelf" ? Promise.resolve(new Response(JSON.stringify(payload))) : real(url, init));
  return () => { globalThis.fetch = real; };
}
const header = (container) => container.querySelector("header.shell-bar");

describe("verification mark in the header", () => {
  it("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    const restore = withShelf({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "agent-registry-demo", verification: mark("verified", "Verified", { note: "Every story run on the mock" }) }] });
    try {
      const { container } = render(<App />);
      await screen.findByRole("tablist");
      const bar = within(header(container));
      expect(await bar.findByText("Verified")).toBeInTheDocument();
      expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
      expect(bar.queryByText("In progress")).toBeNull();
      expect(container.querySelectorAll(".verify")).toHaveLength(1);
      expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every story run on the mock"));
    } finally { restore(); }
  });

  it("shows nothing when the lab is opened on its own port (its /api/shelf has no demos) or the shelf has no mark for it", async () => {
    for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "agent-registry-demo", verification: null }] }]) {
      const restore = withShelf(payload);
      try {
        const { container, unmount } = render(<App />);
        await screen.findByRole("tablist");
        expect(await within(header(container)).findByRole("link", { name: "Shelf" })).toBeInTheDocument(); // the shelf answered, and still no badge
        expect(container.querySelector(".verify")).toBeNull();
        unmount();
      } finally { restore(); }
    }
  });
});
