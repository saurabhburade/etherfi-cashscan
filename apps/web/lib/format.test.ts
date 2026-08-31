import { describe, expect, it } from "vitest";
import { compactUsd, fixedPoint, shortAddress } from "./format";

describe("format", () => {
  it("normalizes contract USD fixed point values", () => {
    expect(fixedPoint("1234567", 6)).toBe(1.234567);
    expect(fixedPoint(BigInt(-105000000), 8)).toBe(-1.05);
    expect(fixedPoint("31906", 0)).toBe(31906);
  });

  it("shortens addresses", () => {
    expect(shortAddress("0x1234567890abcdef")).toBe("0x1234…cdef");
  });

  it("does not round small positive USD values to zero", () => {
    expect(compactUsd(0.009804)).toBe("<$0.01");
    expect(compactUsd(15.4772)).toBe("$15.48");
  });
});
