# Ether.fi Cash on-chain coverage

This indexer intentionally maintains a narrow Ether.fi Cash ledger rather than
reconstructing every wallet or protocol balance.

## Included

| Ledger operation | Event | Effect |
| --- | --- | --- |
| Destination top-up | `TopUpDest.TopUp` | Credits `AccountTokenBalance` for the destination safe and token |
| Legacy Scroll top-up | `LegacyTopUpDest.TopUp` / `TopUpBatch` | Credits the same balance ledger |
| Settled spend | current and legacy `Spend` | Debits each token amount from the destination safe |
| Spend token valuation | current and legacy `Spend` | Stores one event-implied USD price observation per token-array index |
| Safe ERC-20 movement | wildcard `Transfer`, topic-filtered to factory-discovered Safes | Credits/debits `SafeTokenBalance` from the token contract's logs |
| Top-up recipient ranking | destination top-up events | Increments `TopUpRecipientMetric` by Safe and network |
| Cashback receiver ranking | paid `Cashback` and `PendingCashbackCleared` | Increments received reward count and event USD in `CashbackReceiverMetric` |

For each `(chain, safe, token)` tuple:

```text
amount = total destination top-ups - total settled spend
```

`inflow` stores cumulative top-ups and `outflow` stores cumulative spend. A
negative `amount` is allowed when spend uses borrowed funds or when an earlier
credit is outside the configured history.

## Networks

- Optimism: current destination top-ups and settled spend.
- Scroll: current destination top-ups/spend plus the legacy destination and
  legacy emitter history.

## Cash event coverage

All 26 events in the checked-in upstream `CashEventEmitter` ABI are subscribed
on both configured networks. Configuration and Safe state are reconstructed
strictly from logs (no state reads): tiers, lend lifecycle, scheduled modes,
spending-limit tuples, pending withdrawals, cashback balances, and whitelists
all retain current state plus event history.

| Event | Dedicated entity | Activity event type |
| --- | --- | --- |
| `Spend` | `Spend` | `spend` |
| `RepayDebtManager` | `Repayment` | `repay_debt_manager` |
| `Repay` | `Repayment` | `repay` |
| `RepayLendTokenAmount` | `DebtEvent` (unpriced) | `repay_lend_token_amount` |
| `LendBorrowed` | `DebtEvent` (event-priced volume) | `lend_borrowed` |
| `Cashback` | `Cashback` | `cashback` |
| `PendingCashbackCleared` | unified activity only | `pending_cashback_cleared` |
| `WithdrawalRequested` | `WithdrawalEvent` | `withdrawal_requested` |
| `WithdrawalCancelled` | `WithdrawalEvent` | `withdrawal_cancelled` |
| `WithdrawalProcessed` | `WithdrawalEvent` | `withdrawal_processed` |
| Remaining 16 Safe/config events | state/history entities | event-specific activity |

Repayment, cashback, and withdrawal events are also copied into
`ProtocolEvent` for the unified activity feed. Their token metadata comes from
the verified registry or cached ERC-20 metadata effect, but they do not change
`AccountTokenBalance`; that entity remains the narrow top-up-minus-spend ledger
described above.

## Separate Safe wallet ledger

`SafeTokenBalance` reconstructs ERC-20 balances per factory-discovered Safe from
all matching `Transfer` logs. Envio dynamically registers Safe addresses from
the current and legacy factories, then applies indexed `from`/`to` topic filters
to the wildcard ERC-20 event signature. Safe-to-Safe transfers update both
accounts. This balance reconstruction requires no `eth_call`.

This ledger does not cover native ETH, non-standard tokens that change balances
without compliant `Transfer` logs, or activity before the configured factory
start block. A Safe is the on-chain card account; mapping it to a person's
off-chain cardholder profile still requires Ether.fi/provider data.

`TopUpRecipientMetric` deliberately ranks destination accounts by top-up count.
It is not labeled as a source-wallet depositor ranking because the destination
events do not consistently expose that wallet, and raw amounts from different
tokens cannot be compared as USD without historical pricing.

`CashbackReceiverMetric` ranks rewards actually received. A `Cashback` with
`paid = false` is excluded until its `PendingCashbackCleared` settlement appears,
preventing pending issuance and later receipt from being counted twice.

`PendingCashbackBalance` separately retains unpaid token and USD amounts by
recipient/token. Settlement subtracts both values and clamps at zero because
the clearing event is not linked to a specific issuance. `DailyCashMetric`
retains total spend as well as `creditSpendUsd` and `debitSpendUsd` from the
event's numeric `Mode` (0 and 1 respectively).

## Deliberately excluded

- Unfiltered global ERC-20 `Transfer` storage. Only transfers involving a
  dynamically registered Ether.fi Safe are retained.
- Source-chain top-up factories and routing events.
- Unrelated standalone protocol events outside the verified Cash, debt, ramp,
  oracle, and safe-factory surfaces listed below.
- Exact wallet, lending-pool, collateral, or available-credit balances.

The resulting `AccountTokenBalance.amount` is a product ledger balance. It is
not an `ERC20.balanceOf` reconstruction and will not reflect direct transfers,
yield, borrowing, repayment, cashback, withdrawals, or other balance changes.

The configured chain start blocks remain conservative floors. Replace them with
independently verified contract-specific deployment blocks before production.

## Dune-parity event surfaces

The indexer subscribes only to addresses in `@etherfi/contracts` and only to
events declared by the checked-in ABIs. All entity writes use log-derived IDs
or stable business keys and are therefore reorg-safe under Envio rollback.

| Product | Contracts/events | Entity / derivation | USD semantics |
| --- | --- | --- | --- |
| Cashback | `CashEventEmitter.Cashback` | `Cashback`; daily `cashbackUsd` | Emitter's `cashbackInUsd`, 6 decimals |
| Cash repayment | `RepayDebtManager`, `Repay` | `Repayment`; daily `repaidUsd` | Emitter's `debtAmountInUsd`, 6 decimals |
| Withdrawals | withdrawal lifecycle events | `WithdrawalEvent` | Token amounts only; no price is inferred |
| Debt supply/borrow/repay/liquidation | Optimism current + legacy and Scroll current `DebtManager` | `DebtEvent`, `DebtInterestIndex`, per-manager/user/token `DebtPosition` | Raw token amounts; USD remains zero with `unpriced_event_only`; interest indexes are retained but not applied without per-user shares |
| Ramps | Optimism `RampVolumeEmitter.RampVolume` | latest chain/log-ordered `RampVolumeSnapshot` per label/token/day; query-time daily aggregation | Six-decimal USDC is already USD; six-decimal EURC is joined to indexed EUR/USD history |
| EUR/USD | Optimism Chainlink `AnswerUpdated` | append-only `PriceFeedUpdate`, latest `PriceFeedState`, and last observation per UTC day in `DailyFxRate` | Answer uses the verified 8-decimal feed convention |
| Safe discovery | current `BeaconProxyDeployed`, legacy `UserSafeDeployed` | `UserSafe` | Discovery only |

`combinedRampUsd` is `onrampUsd + offrampUsd` at query time. The snapshot key
means the last chain/log event for a `(label, token, dayTimestamp)` replaces
its prior value. The web adapter recalculates ramp daily/token totals from that
latest-state table. EURC uses the last indexed Chainlink observation for its
UTC day, falling back to the latest indexed observation only when the day has
no rate. This is event-only and deterministic, but will not be numerically
identical to Dune when Dune's `prices.fx_exchange_rates` source differs from
Chainlink.

## Determinism and pricing

Token writes prefer the checked-in verified registry. For every address absent
from that registry, a chain-scoped Envio Effect performs one cached ERC-20
`name()`, `symbol()`, and `decimals()` RPC lookup. Standard ABI strings and
legacy `bytes32` text are supported; partial and failed reads retain explicit
`rpc_partial` / `fallback_unverified` status, and `decimalsVerified` prevents a
display fallback from being treated as canonical. This metadata enrichment is
not a price source. EURC ramp values use the separately indexed eight-decimal
EUR/USD feed; other token and debt values still require an event-backed
asset/price mapping.

Each Spend token leg is joined by array index:

```text
tokens[i] -> amounts[i] -> amountInUsd[i]
priceUsd = (amountInUsd[i] / 10^6) / (amounts[i] / 10^tokenDecimals)
```

`SpendTokenValuation.priceUsdE18` retains that result with 18-decimal fixed
precision when token decimals are verified. It is a protocol settlement or
accounting price implied by the Spend event, not an independent Chainlink or
market price. Unknown token decimals produce an unavailable status instead of
an invented price.

## Known coverage limits

- Merchant name, MCC, country, authorization pending/declined state, and card
  profile attributes are provider/off-chain data and cannot be reconstructed
  from these logs.
- Safe ERC-20 balances require a fresh reindex so factory discoveries can drive
  dynamic topic filters from each Safe's creation. They remain separate from
  `AccountTokenBalance` and debt positions.
- `GlobalActiveSafe` and `GlobalDailyActiveSafe` deduplicate Spend safes across
  chains for Dune-style spend-active-safe counts. They are not issued-card or
  cardholder registries and exclude safes that have never emitted `Spend`.
- Debt liquidation amounts and interest-index changes are indexed, but exact
  per-user interest-accrued debt and historical USD/ETH AUM remain pending.
- Ramp labels/tokens are `bytes32` business identifiers. Unknown labels are
  retained as `other`; only labels containing `ONRAMP`/`OFFRAMP` contribute to
  the corresponding daily metric.
- The existing start blocks are conservative floors, so a fresh reindex from
  these configured floors is required to populate the new entities. An older
  generated runtime schema will not expose them until the parent runs codegen
  and performs that reindex.
