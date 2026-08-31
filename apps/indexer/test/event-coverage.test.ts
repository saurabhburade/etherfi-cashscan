import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type AbiEntry = { type: string; name?: string };

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("CashEventEmitter coverage", () => {
  const abi = JSON.parse(read("../abis/cash-event-emitter.json")) as AbiEntry[];
  const eventNames = abi.filter((entry) => entry.type === "event" && entry.name).map((entry) => entry.name as string);
  const config = read("../config.yaml");
  const handlers = read("../src/handlers/index.ts");

  it("subscribes to every event declared by the ABI", () => {
    expect(eventNames).toEqual([
      "WithdrawalRequested",
      "WithdrawalAmountUpdated",
      "WithdrawalCancelled",
      "WithdrawalProcessed",
      "RepayDebtManager",
      "Repay",
      "RepayLendTokenAmount",
      "LendOptOutRequested",
      "LendOptOutExecuted",
      "LendOptedIn",
      "SpendingLimitChanged",
      "ModeSet",
      "Spend",
      "CollateralResupplied",
      "LendSupplyFailed",
      "LendBorrowed",
      "Cashback",
      "PendingCashbackCleared",
      "SafeTiersSet",
      "TierCashbackPercentageSet",
      "CashbackSplitToSafeBpsSet",
      "DelaysSet",
      "SettlementDispatcheUpdated",
      "LendGatewaySet",
      "WithdrawTokensConfigured",
      "ModulesCanRequestWithdrawConfigured",
    ]);
    for (const eventName of eventNames) {
      expect(config).toContain(`- event: ${eventName}`);
    }
  });

  it("registers a handler for every subscribed event", () => {
    for (const eventName of eventNames) {
      // Some mechanically identical lifecycle handlers are registered through
      // a typed event-name loop; all names must still be present in source.
      expect(handlers).toContain(`"${eventName}"`);
    }
  });

  it("uses upstream tuple fields and indexed topics", () => {
    const limit = abi.find((entry: any) => entry.name === "SpendingLimitChanged") as any;
    expect(limit.inputs[0].indexed).toBe(true);
    expect(limit.inputs[1].components).toHaveLength(11);
    expect(limit.inputs[1].components.at(-1)).toMatchObject({ name: "timezoneOffset", type: "int256" });
    expect((abi.find((entry: any) => entry.name === "SafeTiersSet") as any).inputs[1]).toMatchObject({
      type: "uint8[]",
    });
  });

  it("keeps state transitions and paired-array guards event-backed", () => {
    expect(handlers).toContain("if (rawSafe === undefined || rawTier === undefined) continue");
    expect(handlers).toContain("if (rawTier === undefined || percentage === undefined) continue");
    expect(handlers).toContain("if (subject === undefined || whitelisted === undefined) continue");
    expect(handlers).toContain("const previousTierId = previous?.tierId");
    expect(handlers).toContain("currentModeId: previousModeId");
    expect(handlers).toContain("pendingModeId: modeId");
    expect(handlers).toContain('status: "requested"');
    expect(handlers).toContain('event: "WithdrawalAmountUpdated"');
    expect(handlers).toContain('status: "amount_updated"');
  });

  it("tracks credit/debit spending and pending cashback settlement without double counting", () => {
    expect(handlers).toContain("creditSpendUsd: amountUsd");
    expect(handlers).toContain("debitSpendUsd: amountUsd");
    expect(handlers).toMatch(/event\.params\.cashbackAmountInToken,\s+event\.params\.cashbackInUsd/);
    expect(handlers).toMatch(/-event\.params\.cashbackAmount,\s+-event\.params\.cashbackInUsd/);
    expect(handlers).toContain("current.amount + amountDelta < 0n ? 0n");
  });
});

describe("Dune-parity event coverage", () => {
  const config = read("../config.yaml");
  const handlers = read("../src/handlers/index.ts");

  for (const [contract, abi, events] of [
    [
      "DebtManager",
      "../abis/debt-manager.json",
      ["Supplied", "Borrowed", "Repaid", "Liquidated", "InterestIndexUpdated"],
    ],
    ["RampVolumeEmitter", "../abis/ramp-volume.json", ["RampVolume"]],
    ["EurUsdOracle", "../abis/chainlink-aggregator.json", ["AnswerUpdated"]],
    ["EtherFiSafeFactory", "../abis/beacon-factory.json", ["BeaconProxyDeployed"]],
    ["UserSafeFactory", "../abis/legacy-safe-factory.json", ["UserSafeDeployed"]],
  ] as const) {
    it(`subscribes and handles ${contract} ABI events`, () => {
      const abiEvents = (JSON.parse(read(abi)) as AbiEntry[])
        .filter((entry) => entry.type === "event")
        .map((entry) => entry.name);
      expect(abiEvents).toEqual(events);
      for (const event of events) {
        expect(config).toContain(`- event: ${event}`);
        expect(handlers).toContain(`event: "${event}"`);
      }
    });
  }

  it("registers discovered Safes and topic-filters wildcard ERC-20 transfers", () => {
    expect(config).toContain("- name: TrackedSafeTransfer");
    expect(config).toContain("abi_file_path: ./abis/erc20.json");
    expect(handlers).toContain("context.chain.TrackedSafeTransfer.add(event.params.deployed)");
    expect(handlers).toContain("context.chain.TrackedSafeTransfer.add(event.params.safe)");
    expect(handlers).toContain('contract: "TrackedSafeTransfer"');
    expect(handlers).toContain("wildcard: true");
    expect(handlers).toContain("from: chain.TrackedSafeTransfer.addresses");
    expect(handlers).toContain("to: chain.TrackedSafeTransfer.addresses");
  });
});
