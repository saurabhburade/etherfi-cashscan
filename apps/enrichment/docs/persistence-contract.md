# Cash Explorer enrichment persistence contract

`20260901_cash_explorer_additive.sql` is a transactional, idempotent migration
for the new `cash_explorer` schema only. It has no Envio dependency and neither
reads nor modifies Envio-generated tables. It contains no reset, truncate,
drop, reindex, or backfill operation.

Apply only after selecting the intended database explicitly:

```sh
DATABASE_URL='postgresql://…' pnpm --dir apps/enrichment migration:apply
```

The canonical event identifier is `chainId:transactionHash:logIndex`; event
feeds always order by `timestamp DESC, chain_id ASC, block_number DESC,
log_index DESC, id ASC`. `scanner_event_global_keyset_idx` implements that
order, and the validation SQL contains the matching mixed-direction cursor
predicate.

Each `scanner_event` retains its actor, source contract/event/entity provenance,
price/USD status, and an `accounting_role` of `canonical`, `audit`, or
`duplicate`. It remains unique on `chainId:transactionHash:logIndex`; audit
rows may stand alone, while duplicate rows link to their canonical group.
`block_hash` is nullable for historical Envio GraphQL imports and can be filled
later using `source_provenance` and finalization data. Accounting is explicit:
`mode = 0` is recorded by the writer as a `credit`;
every other spend mode is a `debit`. `lend_borrowed_amount` is separate from
card credit. The three repayment counters retain `Repay`, `RepayDebtManager`,
and `RepayLendTokenAmount` independently. Events flagged as audit duplicates
must link to the canonical event through `audit_duplicate_of_id` and must be
excluded from aggregate writes.

USD units are explicit. `amount_usd_raw` is the exact integer amount paired
with `usd_decimals` (default `6`); `amount_usd` is the normalized human-USD
numeric exposed to GraphQL. `price_usd_e18` is the exact E18 price and
`price_usd`/`implied_price_usd` are normalized human prices. Consumers must
format `amount_usd` and never render the raw field directly—for example,
`155160000` with six decimals is `$155.16`, not `$155,160,000`.
`unpriced`, `pending`, and `anomalous` rows are constrained to have a NULL USD
value rather than a synthetic zero. Price-source and observation provenance
retain source, block, hash, transaction, event and payload data. Both price
observation and current-cache rows retain normalized `price_usd` alongside
exact `price_usd_e18`. Token daily metrics include event count plus
credit/debit/volume USD, so bounded daily UI queries do not recompute history.
The price current cache enforces a maximum 15-minute expiry and
a five-minute refresh threshold. Candidates with more than 50% deviation are
retained in `price_anomaly` for independent verification.

This schema deliberately does **not** expose an authoritative active-debt
position. Accurate debt requires borrow-index history and price provenance
beyond a spend/repayment ledger. Such index history may be added later as a
separate, source-provenanced contract; current metric fields are accounting
totals, not debt positions.

## Hasura

The metadata payload tracks every canonical table with UI-facing custom names
(`ScannerEvent`, `ScannerEventTokenLeg`, `Token`, `AccountTokenMetric`,
`TokenDailyMetric`, and `TokenPriceCurrent`), camelCase key columns, anonymous
read permissions, and FK-backed object/array relationships including
`ScannerEvent.tokenLegs`, `ScannerEventTokenLeg.scannerEvent`,
`ScannerEventTokenLeg.token`, metric `account`/`token`, and `dailyMetrics`.
Each requested UI type has exact `select`, `select_by_pk`, and
`select_aggregate` roots. The static validator asserts those roots, required
camelCase web fields, and relationship names—not merely an operation count. It
is deliberately additive and does not use
`replace_metadata`.

```sh
HASURA_GRAPHQL_ENDPOINT='https://hasura.example' HASURA_SOURCE=default \
  pnpm --dir apps/enrichment hasura:apply
```

Hasura reports an error if a table or relationship is already tracked; inspect
metadata first or omit existing operations from the supplied payload before a
repeat call. That is intentional: the script never overwrites unrelated
metadata.

## Validation

Run the static contract check without a database:

```sh
pnpm --dir apps/enrichment migration:validate
```

Run `20260901_cash_explorer_validation.sql` only against a database after
apply. It is read-only and checks foreign keys, valid index definitions,
duplicate canonical IDs, and a keyset `EXPLAIN` plan.

## Lending and cross-source accounting

`20260902_lending_accounting.sql` adds the event-first lending model without
changing or repurposing legacy balances. `account_identity` is a lowercase,
cross-chain Safe identity; chain-scoped `account` records optionally point to
it through `identity_id`. Every deduplicated `economic_action` retains both
the chain-scoped account and cross-chain identity. Its `action_type` covers
Cash (`deposit`, `spend`, `withdrawal`, `cashback`, `fee`, `other`) and lending
actions. `economic_action_source` links exactly one canonical source: either
a `scanner_event` for Cash/Transfer provenance or a typed `lending_event`.

Markets model Aave V4 (`spoke_address`, `gateway_address`, `hub_address`, and
oracle), while reserves use the numeric `reserve_number`/`hub_asset_id` model.
Lending events retain one source log and typed `cash`/`gateway`/`spoke`
provenance; their legs retain token/reserve deltas. Composite foreign keys keep
market, reserve, token, and event chain IDs aligned.

Current positions and exact block snapshots expose wallet balance, supplied
balance/shares, drawn and premium shares, gross assets, authoritative protocol
debt, net worth, collateral use, valuation status, state source/status, and
price provenance. Account snapshots additionally expose market-level health
factor, collateral factor, available borrow, and collateral/borrow counts.
Unpriced valuation fields are NULL, never synthetic zero. `account_metric` and
`account_token_metric` receive additive explicit lending fields; legacy fields
keep their existing meaning.

For Aave V4 account aggregates, `risk_premium_ray`,
`total_collateral_value_raw`, and `total_debt_value_ray_raw` remain explicitly
raw numeric fields. They must not be displayed as USD; the normalized USD
aggregate fields remain NULL until pricing and scale are independently verified.

`account_daily_metric.token_id` is preserved for compatibility. The migration
creates `account_daily_metric_legacy_token_rows`, an auditable view of old
token rows, and only applies a partial uniqueness index to new account-only
rows. An operator can backfill those rows to `account_token_daily_metric` and
validate the later token-null constraint after reconciliation; this migration
does not strand, delete, or rewrite historical rows. Price provenance accepts
`aave_oracle_historical`, `aave_oracle_current`, and `price_provider_current`.
