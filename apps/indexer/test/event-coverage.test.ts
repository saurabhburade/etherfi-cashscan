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

describe("Cash Lend Gateway / Aave V4 Spoke coverage", () => {
  const config = read("../config.yaml");
  const handlers = read("../src/handlers/index.ts");

  for (const [contract, abi, events] of [
    [
      "LendGateway",
      "../abis/lend-gateway.json",
      [
        "ReserveRegistered",
        "ReserveDeregistered",
        "PositionManagerApproved",
        "Supplied",
        "Withdrawn",
        "Borrowed",
        "Repaid",
        "CollateralUsageSet",
      ],
    ],
    [
      "AaveV4Spoke",
      "../abis/aave-v4-spoke.json",
      [
        "AddReserve",
        "Supply",
        "Withdraw",
        "Borrow",
        "Repay",
        "LiquidationCall",
        "ReportDeficit",
        "SetUsingAsCollateral",
        "SetUserPositionManager",
      ],
    ],
  ] as const) {
    it(`subscribes and preserves immutable provenance for ${contract}`, () => {
      const abiEvents = (JSON.parse(read(abi)) as AbiEntry[])
        .filter((entry) => entry.type === "event")
        .map((entry) => entry.name);
      expect(abiEvents).toEqual(events);
      expect(config).toContain(`- name: ${contract}`);
      for (const event of events) expect(config).toContain(`- event: ${event}`);
    });
  }

  it("uses chain:tx:log source IDs, preserves null absence semantics and signed deltas, and never folds V4 logs into DebtPosition", () => {
    const lendingSection = handlers.slice(handlers.indexOf("// Lend Gateway and Aave V4 Spoke handlers"));
    expect(handlers).toContain(
      "const lendingEventId = (event: BlockEvent) => eventId(event.chainId, event.transaction.hash, event.logIndex)",
    );
    expect(handlers).toContain("id: `${sourceEventId}:${legIndex}`");
    expect(handlers).toContain("premiumSharesDelta");
    expect(handlers).toContain("premiumOffsetRayDelta");
    expect(handlers).toContain("suppliedSharesDelta");
    expect(handlers).toContain('eventName === "Supply" ? shares : eventName === "Withdraw" ? -shares : 0n');
    expect(handlers).toContain('"debt_restored"');
    expect(handlers).toContain('"collateral_seized"');
    expect(handlers).toContain('"liquidation_fee"');
    expect(handlers).toMatch(/"liquidation_fee",\s+event\.params\.collateralReserveId[\s\S]*?"informational",?\s*\);/);
    expect(handlers).toContain('"deficit"');
    expect(handlers).toContain("context.LendingGatewayReserveLookup.set");
    expect(handlers).toContain("lendingGatewayReserve(context, event, event.params.asset)");
    expect(handlers).toContain("reserve?.active ? reserve.reserveId : undefined");
    expect(handlers).toContain("...(fields.safeAddress ? { safeAddress: lower(fields.safeAddress) } : {})");
    expect(handlers).toContain("...(tokenAddress ? { tokenAddress: lower(tokenAddress) } : {})");
    expect(handlers).toMatch(/if \(existing\?\.tokenAddress\)\s+await recordLendingLeg/);
    expect(lendingSection).not.toContain("safeAddress: fields.safeAddress ? lower(fields.safeAddress) : ZERO_ADDRESS");
    expect(handlers).toContain("active: false");
    expect(lendingSection).not.toContain("context.DebtPosition");
    expect(lendingSection).toContain("context.effect(lendingStateSnapshotEffect");
  });
});

describe("Envio-owned Cash Explorer projection contract", () => {
  const schema = read("../schema.graphql");
  const handlers = read("../src/handlers/index.ts");

  it("defines the canonical account, lending, and price roots used by the explorer", () => {
    for (const entity of [
      "AccountIdentity",
      "AccountTokenEvent",
      "AccountTokenMetric",
      "AccountMetric",
      "AccountDailyMetric",
      "EconomicAction",
      "EconomicActionSource",
      "LendingMarket",
      "LendingReserve",
      "LendingEvent",
      "LendingEventLeg",
      "LendingPosition",
      "LendingPositionSnapshot",
      "LendingAccountSnapshot",
      "TokenPriceSource",
      "TokenPriceObservation",
      "TokenPriceCurrent",
      "PriceAnomaly",
    ])
      expect(schema).toContain(`type ${entity}`);
    expect(schema).toContain("account: Account");
    expect(schema).toContain("token: Token");
    expect(schema).toContain('account_metrics: [AccountTokenMetric!]! @derivedFrom(field: "token")');
    expect(schema).toContain('tokenLegs: [ScannerEventTokenLeg!]! @derivedFrom(field: "scannerEvent")');
  });

  it("projects one canonical token row per leg and routes enrichment through cached Envio effects", () => {
    expect(handlers).toContain("const id = `${actionId}:${legIndex}`");
    expect(handlers).toContain("canonicalTokenLeg(");
    const canonical = handlers.slice(
      handlers.indexOf("async function canonicalAccount"),
      handlers.indexOf("async function bumpTopUpRecipient"),
    );
    expect(canonical).toContain("context.effect(currentTokenPriceEffect");
    expect(handlers).toContain("context.effect(lendingStateSnapshotEffect");
    expect(canonical).not.toContain("ZERO_ADDRESS, token");
    expect(handlers).toContain('event.params.paid ? "cashback_received" : "cashback_generated"');
    expect(handlers).toContain("context.ScannerEvent.set");
    expect(handlers).toContain("context.ScannerEventTokenLeg.set");
    expect(handlers).toContain("materializeScannerEventTypeMetric(context, event, actionType)");
    expect(handlers).toContain("return { id, accountAddress, scannerEventType: actionType }");
    expect(handlers).toContain(
      "materializeScannerTokenEventTypeMetric(context, event, tokenAddress, scannerEventType)",
    );
    expect(handlers).toContain('eventType.startsWith("topup")');
    expect(handlers).toContain('status: options.status ?? "completed"');
  });

  it("materializes deterministic scanner event-type availability metrics", () => {
    const schema = read("../schema.graphql");
    expect(schema).toContain("type ScannerEventTypeMetric");
    expect(schema).toContain('[["chainId", "ASC"], ["eventType", "ASC"]]');
    expect(schema).toContain("type ScannerTokenEventTypeMetric");
    expect(schema).toContain('[["chainId", "ASC"], ["tokenAddress", "ASC"], ["eventType", "ASC"]]');
    expect(handlers).toContain(["id: `", "${event.chainId}", ":", "${eventType}", "`"].join(""));
    expect(handlers).toContain(
      ["id: `", "${event.chainId}", ":", "${normalizedTokenAddress}", ":", "${eventType}", "`"].join(""),
    );
    expect(handlers).toContain(
      ["materializeScannerEventTypeMetric(context, event as BlockEvent, `lending_", "${eventType}", "`)"].join(""),
    );
    expect(handlers).toContain(["`lending_", "${lendingEvent.eventType}", "`"].join(""));
  });

  it("uses the parent ScannerEvent type for withdrawal and debt token availability", () => {
    expect(handlers).toContain("`withdrawal_${status}`");
    expect(handlers).toContain('"withdrawal",');
    expect(handlers).toContain("`debt_${eventType}`");
    expect(handlers).toContain('eventType === "borrowed" ? "borrow" : eventType === "repaid" ? "repay" : "supplied"');
    expect(handlers).toContain("canonical.scannerEventType");
  });

  it("declares explorer timeline indexes in the Envio schema", () => {
    const schema = read("../schema.graphql");
    expect(schema).toContain('["chainId", "ASC"]\n      ["accountAddress", "ASC"]');
    expect(schema).toContain('["accountAddress", "ASC"]\n      ["timestamp", "DESC"]\n      ["chainId", "ASC"]');
    expect(schema).toContain('["eventType", "ASC"]\n      ["timestamp", "DESC"]\n      ["chainId", "ASC"]');
    expect(schema).toContain('["chainId", "ASC"]\n      ["eventType", "ASC"]\n      ["timestamp", "DESC"]');
    expect(schema.match(/type SafeTierChange[\s\S]*?type TierDailyMetric/)?.[0]).toContain(
      '[["timestamp", "DESC"], ["chainId", "ASC"]',
    );
    expect(schema.match(/type SafeModeChange[\s\S]*?type SafeSpendingLimitState/)?.[0]).toContain(
      '[["timestamp", "DESC"], ["chainId", "ASC"]',
    );
    expect(schema).toContain('[["tokenAddress", "ASC"], ["scannerEvent", "ASC"]]');
    expect(schema).toContain('[["scannerEvent", "ASC"], ["legIndex", "ASC"]]');
    expect(schema).toContain('[["isPositive", "ASC"], ["amount", "DESC"]]');
    expect(schema).toContain(
      '[["isPositive", "ASC"], ["updatedAt", "DESC"], ["safeAddress", "ASC"], ["tokenAddress", "ASC"]]',
    );
    expect(handlers).toContain("isPositive: nextAmount > 0n");
  });
});
