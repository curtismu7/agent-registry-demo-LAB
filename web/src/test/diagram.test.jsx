import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiagramTab, { DEMO_STEPS, START_BOXES } from "../tabs/DiagramTab.jsx";

vi.mock("../tabs/LifecycleTab.jsx", () => ({ ScenarioBar: () => null, StoryPlayer: () => null }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

function Harness({ initial = START_BOXES, spy }) {
  const [cursor, setCursor] = useState(-1);
  const [boxes, setBoxes] = useState(initial);
  spy.boxes = boxes; spy.cursor = cursor;
  return <DiagramTab app={{ run: null, cursor, setCursor, boxes, setBoxes, theme: "light" }} />;
}

describe("lifecycle diagram", () => {
  it("has five boxes: register, grant, call, rotate, retire", () => {
    expect(START_BOXES.map((b) => b.id)).toEqual(["register", "grant", "call", "rotate", "retire"]);
    render(<Harness spy={{}} />);
    expect(screen.getByText("4 Rotate by replacement")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Lifecycle diagram/ })).toBeInTheDocument();
  });
  it("has a speed control with 0.5x to 4x", () => {
    render(<Harness spy={{}} />);
    const opts = [...screen.getByLabelText("Speed").querySelectorAll("option")].map((o) => o.textContent);
    expect(opts).toEqual(["0.5x", "1x", "2x", "4x"]);
  });
  it("Reset restores the box positions AND the simulation", async () => {
    const spy = {};
    const moved = START_BOXES.map((b) => ({ ...b, position: { x: 1, y: 1 } }));
    render(<Harness initial={moved} spy={spy} />);
    await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
    expect(spy.cursor).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(spy.boxes).toEqual(START_BOXES);
    expect(spy.cursor).toBe(-1);
    expect(screen.getByTestId("caption")).toHaveTextContent("Press Simulate");
  });
  it("Simulate walks the built-in path and marks the refused call in words", async () => {
    vi.useFakeTimers();
    const spy = {};
    render(<Harness spy={spy} />);
    await act(async () => { screen.getByRole("button", { name: "Simulate" }).click(); });
    for (let i = 0; i < DEMO_STEPS.length; i++) await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
    expect(spy.cursor).toBe(DEMO_STEPS.length - 1);
    expect(screen.getByTestId("caption")).toHaveTextContent("REFUSED 401");
    expect(screen.getByTestId("caption")).toHaveClass("caption--deny");
  });
});
