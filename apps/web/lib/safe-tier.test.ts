import { describe, expect, it } from "vitest";
import { effectiveTierCounts, safeTierImageUrl, safeTierName } from "./safe-tier";

describe("Safe tier artwork", () => {
  it("maps indexed tier IDs to Ether.fi asset paths", () => {
    expect(safeTierImageUrl(0)).toBe("https://www.ether.fi/assets/core.avif");
    expect(safeTierImageUrl(1)).toBe("https://www.ether.fi/assets/luxe.avif");
    expect(safeTierImageUrl(2)).toBe("https://www.ether.fi/assets/pinnacle.avif");
    expect(safeTierImageUrl(3)).toBe("https://www.ether.fi/assets/vip.avif");
    expect(safeTierImageUrl(4)).toBe("https://www.ether.fi/assets/business/cards-section-mobile.avif");
  });

  it("defaults missing and unknown tier IDs to Core", () => {
    expect(safeTierName(null)).toBe("core");
    expect(safeTierName(undefined)).toBe("core");
    expect(safeTierName(99)).toBe("core");
  });

  it("counts Safes without tier state as Core", () => {
    expect(
      effectiveTierCounts(
        [
          { tierId: 0, safeCount: 2 },
          { tierId: 1, safeCount: 3 },
          { tierId: 2, safeCount: 1 },
        ],
        10,
      ),
    ).toEqual([
      { tierId: 0, safeCount: 6 },
      { tierId: 1, safeCount: 3 },
      { tierId: 2, safeCount: 1 },
    ]);
  });
});
