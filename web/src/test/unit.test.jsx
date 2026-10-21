import React from "react";
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { reveal, Inert } from "../lib/Inert.jsx";
import { fill } from "../lib/fill.js";
import { maskKey, maskDeep } from "../lib/mask.js";

afterEach(cleanup);

describe("inert text", () => {
  it("shows markup as text, never as elements", () => {
    const { container } = render(<Inert text={'<img src=x onerror="alert(1)"><script>boom()</script>'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>boom()</script>");
  });
  it("turns control and bidi characters into visible chips", () => {
    expect(reveal("a‮b\u0000c").filter((p) => p.chip).map((p) => p.chip)).toEqual(["[U+202E]", "[U+0000]"]);
    render(<Inert text={"x‮y"} />);
    expect(screen.getByTitle(/Invisible or look-alike/)).toHaveTextContent("[U+202E]");
  });
});

describe("cast tokens", () => {
  it("fills known tokens and leaves an unknown one visible", () => {
    expect(fill("{{custodian}} grants {{agent}} {{nope}}", { custodian: "Mark", agent: "travel-agent" })).toBe("Mark grants travel-agent {{nope}}");
  });
});

describe("key masking", () => {
  const full = "sk-MOCK-ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";
  it("never leaves a whole key in text", () => {
    expect(maskKey(`Bearer ${full}`)).toBe("Bearer sk-MOCK-ABCD...STUV");
    expect(JSON.stringify(maskDeep({ spec: { VirtualKey: full } }))).not.toContain(full);
  });
});
