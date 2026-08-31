import { encodeAbiParameters, pad, stringToHex } from "viem";
import { describe, expect, it } from "vitest";

import { decodeErc20Text } from "../src/erc20-metadata-effect.js";

describe("ERC-20 metadata decoding", () => {
  it("decodes standard ABI strings", () => {
    expect(decodeErc20Text(encodeAbiParameters([{ type: "string" }], ["Scroll"]))).toBe("Scroll");
  });

  it("decodes legacy bytes32 symbols", () => {
    expect(decodeErc20Text(pad(stringToHex("SCR"), { size: 32 }))).toBe("SCR");
  });

  it("rejects empty metadata", () => {
    expect(decodeErc20Text(pad("0x", { size: 32 }))).toBeNull();
  });
});
