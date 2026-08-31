import { describe, expect, it } from "vitest";
import { tokenAssetIconUrl, tokenAssetIconUrls } from "./token-icons";

describe("tokenAssetIconUrl", () => {
  it("uses Sushi first and SmolDapp as fallback for Optimism", () => {
    expect(tokenAssetIconUrls(10, "0x5A7fACB970d094B6c7fF1dF0EA68D99E6e73CBfF")).toEqual([
      "https://cdn.sushi.com/tokens/10/0x5a7facb970d094b6c7ff1df0ea68d99e6e73cbff.jpg",
      "https://raw.githubusercontent.com/SmolDapp/tokenAssets/main/tokens/10/0x5a7facb970d094b6c7ff1df0ea68d99e6e73cbff/logo.svg",
    ]);
    expect(tokenAssetIconUrl(10, "0x5A7fACB970d094B6c7fF1dF0EA68D99E6e73CBfF")).toBe(
      "https://cdn.sushi.com/tokens/10/0x5a7facb970d094b6c7ff1df0ea68d99e6e73cbff.jpg",
    );
  });

  it("supports any valid chain id and rejects malformed inputs", () => {
    expect(tokenAssetIconUrls(534352, "0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4")).toEqual([
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/scroll/assets/0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4/logo.png",
      "https://raw.githubusercontent.com/SmolDapp/tokenAssets/main/tokens/534352/0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4/logo.svg",
    ]);
    expect(tokenAssetIconUrl(0, "0x5a7facb970d094b6c7ff1df0ea68d99e6e73cbff")).toBeNull();
    expect(tokenAssetIconUrl(10, "not-an-address")).toBeNull();
  });
});
