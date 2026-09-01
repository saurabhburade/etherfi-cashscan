# Envio-native Cash Explorer analytics

This document is the acceptance target for a fresh Envio deployment. The
canonical Cash Explorer GraphQL API must be produced by `schema.graphql` and
the Envio handlers/effects alone. A fresh deployment must not require a SQL
migration, Hasura metadata import, or the enrichment package to expose the
primary Cash Explorer path.

`test/envio-native-contract.test.ts` is the executable version of this
contract. It is intentionally stricter than raw-ledger compatibility: it
requires the canonical PascalCase entities, relation IDs, query indexes, and
materialization seams below.

## Canonical parity matrix

| Entity | Source of truth on a fresh deployment | Required population path | Legacy compatibility |
| --- | --- | --- | --- |
| `AccountIdentity` | Factory/Cash/lending addresses | Event-derived | Supersedes `cash_explorer.account_identity`; preserve raw Safe address reads. |
| `AccountTokenEvent` | Canonical Cash token legs | Event-derived; price link may use an effect | Supersedes worker projection of `scanner_event_token_leg`. |
| `AccountTokenMetric`, `AccountMetric`, `AccountDailyMetric` | Event ledger and indexed price state | Handler rollups; reprice through effects | Supersedes worker recomputation queries. |
| `EconomicAction`, `EconomicActionSource` | Cash/Gateway/Spoke event correlation | Event-derived | Supersedes migration-only reconciliation records. |
| `LendingMarket`, `LendingReserve`, `LendingEvent`, `LendingEventLeg` | Gateway and Aave V4 Spoke logs | Event-derived; event-priced USD preferred | Maps existing `LendingReserveState`/`LendingSourceEvent` without removing them. |
| `LendingPosition`, `LendingPositionSnapshot` | Lending logs plus exact block state | Handler state plus block-exact cached effect | Supersedes worker-created position snapshots. |
| `LendingAccountSnapshot` | Exact block lending aggregate | Effect-derived, chain-scoped and cached | Supersedes archive snapshot worker output. |
| `TokenPriceSource`, `TokenPriceObservation`, `TokenPriceCurrent`, `CanonicalTokenPriceBucket`, `PriceAnomaly` | Spend-implied prices first; same-chain oracle second; verified cross-chain event/oracle fallback last | Event-derived plus cached block-exact effect | Supersedes price backfill/refresh and anomaly worker tables. |

For every canonical event source, the ID is `chainId:transactionHash:logIndex`.
A token or lending leg appends its deterministic index. IDs and addresses are
lowercase and chain-qualified. A missing price, decimal, balance, or historic
RPC result is represented as null/unavailable; it must never be converted into
a zero-valued USD amount.

## Query surface and relations

The canonical types expose Envio relations (`account`, `token`) while retaining
explicit identity fields such as `accountIdentityId`, `accountAddress`,
`tokenAddress`, `economicActionId`, `marketId`, `reserveId`, `lendingEventId`,
and `observationId`. The required indexed fields are asserted by the contract
test and cover account/token/event feeds, keyset chronology, account rankings,
lending positions, and current/history price reads.

Existing raw entities remain compatibility inputs: `TopUp`, `Spend`,
`SpendTokenValuation`, `Repayment`, `Cashback`, `WithdrawalEvent`,
`SafeTokenBalance`, `Token`, `TokenAnalyticsMetric`, `LendingSourceEvent`, and
`LendingReserveState`. They may continue to be queried while clients migrate,
but are not substitutes for the canonical entity names above.

## Effects and unsupported off-chain work

Event-priced USD is preferred whenever the log supplies a value. Otherwise the
handler tries the same-chain PriceProvider at the event block. Only after that
fails may a registry-verified peer token supply either an event-implied price
from the preceding 15 minutes or a cross-chain PriceProvider observation. The
cross-chain block is resolved from the UTC price-bucket timestamp; a block
number from one chain is never reused on another. Every accepted cross-chain
observation retains its reference chain, token, block, and timestamp, and a
candidate that deviates by more than 50 percent cannot replace the prior valid
observation. Unavailable calls remain nullable.

RPC enrichment is allowed only through a cached Envio effect. Ordinary lending
activity is coalesced per Safe/market/bucket, while liquidation and deficit
events retain an exact-block snapshot.

The following are deliberately outside the primary fresh-deployment guarantee:

- data that exists only in an old `cash_explorer` database;
- unrecorded historical state before the configured index start block;
- third-party/off-chain price-provider results without reproducible chain-time
  provenance; and
- operational monitoring, one-off exports, and migration of legacy clients.

## Operations no longer required for a fresh deployment

Once this contract passes against the Envio implementation, a new deployment
does not run any of these primary-path commands:

- `pnpm --filter @etherfi/enrichment migration:apply`
- `pnpm --filter @etherfi/enrichment hasura:apply`
- `pnpm --filter @etherfi/enrichment backfill`
- `pnpm --filter @etherfi/enrichment worker`
- `pnpm --filter @etherfi/enrichment prices:backfill`
- `pnpm --filter @etherfi/enrichment prices:refresh`
- `pnpm --filter @etherfi/enrichment lending:snapshots`

Those commands can remain temporarily for existing installations that need to
preserve or migrate the legacy `cash_explorer` schema, backfill old rows, or
serve clients pinned to Hasura metadata. They are not part of fresh Envio
bootstrap and must not be a hidden requirement for the web application.
