import assert from "node:assert/strict";
import { encodeFunctionResult, parseAbi } from "viem";
import { describe, it } from "vitest";
import {
  blockTag,
  fetchHistoricalPriceProviderPrices,
  priceUsdE6ToE18,
  tokenAmountUsdE6,
} from "../src/price-provider-rpc.js";

const multicall3Abi = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)",
]);
const priceProviderAbi = parseAbi(["function price(address token) view returns (uint256)"]);
const TOKEN_A = "0x0000000000000000000000000000000000000001" as const;
const TOKEN_B = "0x0000000000000000000000000000000000000002" as const;
const TOKEN_C = "0x0000000000000000000000000000000000000003" as const;

describe("PriceProvider RPC", () => {
  it("uses exact hex block tags and multicalls tokens sharing a historical block", async () => {
    let requestBody: Array<{ id: number; params: [{ to: string; data: string }, string] }> = [];
    const priceResult = (price: bigint) =>
      encodeFunctionResult({ abi: priceProviderAbi, functionName: "price", result: price });
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      const responses = requestBody.map((request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result:
          request.params[1] === "0x64"
            ? encodeFunctionResult({
                abi: multicall3Abi,
                functionName: "aggregate3",
                result: [
                  { success: true, returnData: priceResult(1_000_000n) },
                  { success: true, returnData: priceResult(2_000_000n) },
                ],
              })
            : priceResult(3_000_000n),
      }));
      return new Response(JSON.stringify(responses), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const result = await fetchHistoricalPriceProviderPrices({
      rpcUrl: "https://archive.invalid",
      fetcher,
      calls: [
        { chainId: 10, tokenAddress: TOKEN_A, blockNumber: 100n },
        { chainId: 10, tokenAddress: TOKEN_B, blockNumber: 100n },
        { chainId: 10, tokenAddress: TOKEN_C, blockNumber: 101n },
      ],
    });

    assert.equal(requestBody.length, 2, "different block states must remain separate RPC requests");
    assert.equal(requestBody[0].params[1], "0x64");
    assert.equal(requestBody[1].params[1], "0x65");
    assert.match(requestBody[0].params[0].data, /^0x82ad56cb/, "same-block calls use Multicall3.aggregate3");
    assert.deepEqual(
      result.map((row) => row.priceUsdE6),
      [1_000_000n, 2_000_000n, 3_000_000n],
    );
  });

  it("keeps all valuation arithmetic exact with bigint", () => {
    assert.equal(blockTag(155_900_500n), "0x94ada54");
    assert.equal(priceUsdE6ToE18(2_446_503_700n), 2_446_503_700_000_000_000_000n);
    assert.equal(tokenAmountUsdE6(2n * 10n ** 18n, 18, 2_446_503_700n), 4_893_007_400n);
  });

  it("retains a failed token as unpriced instead of substituting latest", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify([{ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "missing trie node" } }]), {
        status: 200,
      })) as typeof fetch;
    const [result] = await fetchHistoricalPriceProviderPrices({
      rpcUrl: "https://non-archive.invalid",
      fetcher,
      calls: [{ chainId: 10, tokenAddress: TOKEN_A, blockNumber: 1n }],
    });
    assert.equal(result.priceUsdE6, null);
    assert.equal(result.error, "missing trie node");
  });
});
