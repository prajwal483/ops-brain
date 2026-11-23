import { describe, it, expect } from "vitest";
import { findCycle } from "../src/graph";

describe("findCycle", () => {
  it("returns null for a chain", () => {
    expect(findCycle(new Map([["A", ["B"]], ["B", ["C"]], ["C", []]]))).toBeNull();
  });

  it("returns the loop path", () => {
    expect(findCycle(new Map([["A", ["B"]], ["B", ["C"]], ["C", ["A"]]]))).toEqual(["A", "B", "C", "A"]);
  });

  it("detects a self-loop", () => {
    expect(findCycle(new Map([["A", ["A"]]]))).toEqual(["A", "A"]);
  });
});
