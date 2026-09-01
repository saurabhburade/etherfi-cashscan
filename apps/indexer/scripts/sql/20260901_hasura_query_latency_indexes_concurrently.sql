-- Online alternative to 20260901_hasura_query_latency_indexes.sql.
--
-- Target: the `etherfi_enriched` PostgreSQL schema configured by ENVIO_PG_SCHEMA.
-- Run this variant while Envio remains a writer only when avoiding writer
-- blocking matters more than build time. PostgreSQL forbids CREATE INDEX
-- CONCURRENTLY inside a transaction block, so execute the whole file directly
-- with psql and ON_ERROR_STOP enabled; do not add BEGIN/COMMIT around it.
--
-- Do not run this file and the stopped-writer variant together. If an online
-- build is interrupted, use the verification query in the stopped-writer file;
-- an invalid index must be dropped before rerunning its CREATE INDEX CONCURRENTLY.
-- The names and definitions are Envio 3.6.1-compatible, so a future normal
-- restart recognizes the manually created indexes without a reset or reindex.

-- This DDL is intentionally not wrapped in BEGIN/COMMIT. ALTER TABLE briefly
-- locks Token; the subsequent backfill writes Token rows while the indexer may
-- continue writing. Run the stopped-writer variant when that coordination is
-- unacceptable.
ALTER TABLE "etherfi_enriched"."Token"
  ADD COLUMN IF NOT EXISTS "hasSpend" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "hasTopUp" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "hasRepayment" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "hasDebt" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "hasBalance" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "latestSpendPriceUsdE18" numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "latestSpendPriceStatus" text NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS "latestSpendAt" timestamptz NOT NULL DEFAULT TIMESTAMPTZ 'epoch',
  ADD COLUMN IF NOT EXISTS "latestSpendBlockNumber" numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "latestSpendLogIndex" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "latestSpendValuationId" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "analyticsUpdatedAt" timestamptz NOT NULL DEFAULT TIMESTAMPTZ 'epoch';

ALTER TABLE "etherfi_enriched"."envio_history_Token"
  ADD COLUMN IF NOT EXISTS "hasSpend" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "hasTopUp" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "hasRepayment" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "hasDebt" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "hasBalance" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "latestSpendPriceUsdE18" numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "latestSpendPriceStatus" text NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS "latestSpendAt" timestamptz NOT NULL DEFAULT TIMESTAMPTZ 'epoch',
  ADD COLUMN IF NOT EXISTS "latestSpendBlockNumber" numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "latestSpendLogIndex" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "latestSpendValuationId" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "analyticsUpdatedAt" timestamptz NOT NULL DEFAULT TIMESTAMPTZ 'epoch';

WITH source_flags AS (
  SELECT "chainId", "tokenAddress", true AS "hasSpend", false AS "hasTopUp", false AS "hasRepayment", false AS "hasDebt", false AS "hasBalance", "timestamp" AS observed_at FROM "etherfi_enriched"."SpendTokenValuation"
  UNION ALL
  SELECT "chainId", "tokenAddress", false, true, false, false, false, "timestamp" FROM "etherfi_enriched"."TopUp"
  UNION ALL
  SELECT "chainId", "tokenAddress", false, false, true, false, false, "timestamp" FROM "etherfi_enriched"."Repayment"
  UNION ALL
  SELECT "chainId", "tokenAddress", false, false, false, true, false, "timestamp" FROM "etherfi_enriched"."DebtEvent"
  UNION ALL
  SELECT "chainId", "tokenAddress", false, false, false, false, true, "updatedAt" FROM "etherfi_enriched"."AccountTokenBalance"
), flags AS (
  SELECT "chainId", "tokenAddress", bool_or("hasSpend") AS "hasSpend", bool_or("hasTopUp") AS "hasTopUp",
         bool_or("hasRepayment") AS "hasRepayment", bool_or("hasDebt") AS "hasDebt", bool_or("hasBalance") AS "hasBalance",
         max(observed_at) AS "analyticsUpdatedAt"
  FROM source_flags
  GROUP BY "chainId", "tokenAddress"
), latest_spend AS (
  SELECT DISTINCT ON ("chainId", "tokenAddress")
         "chainId", "tokenAddress", "priceUsdE18", "priceStatus", "timestamp", "blockNumber", "logIndex", "id"
  FROM "etherfi_enriched"."SpendTokenValuation"
  ORDER BY "chainId", "tokenAddress", "timestamp" DESC, "blockNumber" DESC, "logIndex" DESC, "id"
), token_state AS (
  SELECT t."id", f."hasSpend", f."hasTopUp", f."hasRepayment", f."hasDebt", f."hasBalance", f."analyticsUpdatedAt",
         s."priceUsdE18", s."priceStatus", s."timestamp", s."blockNumber", s."logIndex", s."id" AS "valuationId"
  FROM "etherfi_enriched"."Token" t
  LEFT JOIN flags f ON f."chainId" = t."chainId" AND f."tokenAddress" = t."address"
  LEFT JOIN latest_spend s ON s."chainId" = t."chainId" AND s."tokenAddress" = t."address"
)
UPDATE "etherfi_enriched"."Token" t
SET "hasSpend" = COALESCE(state."hasSpend", false),
    "hasTopUp" = COALESCE(state."hasTopUp", false),
    "hasRepayment" = COALESCE(state."hasRepayment", false),
    "hasDebt" = COALESCE(state."hasDebt", false),
    "hasBalance" = COALESCE(state."hasBalance", false),
    "latestSpendPriceUsdE18" = COALESCE(state."priceUsdE18", 0),
    "latestSpendPriceStatus" = COALESCE(state."priceStatus", 'unavailable'),
    "latestSpendAt" = COALESCE(state."timestamp", TIMESTAMPTZ 'epoch'),
    "latestSpendBlockNumber" = COALESCE(state."blockNumber", 0),
    "latestSpendLogIndex" = COALESCE(state."logIndex", 0),
    "latestSpendValuationId" = COALESCE(state."valuationId", ''),
    "analyticsUpdatedAt" = COALESCE(state."analyticsUpdatedAt", TIMESTAMPTZ 'epoch')
FROM token_state state
WHERE t."id" = state."id";

UPDATE "etherfi_enriched"."envio_history_Token" history
SET "hasSpend" = token."hasSpend",
    "hasTopUp" = token."hasTopUp",
    "hasRepayment" = token."hasRepayment",
    "hasDebt" = token."hasDebt",
    "hasBalance" = token."hasBalance",
    "latestSpendPriceUsdE18" = token."latestSpendPriceUsdE18",
    "latestSpendPriceStatus" = token."latestSpendPriceStatus",
    "latestSpendAt" = token."latestSpendAt",
    "latestSpendBlockNumber" = token."latestSpendBlockNumber",
    "latestSpendLogIndex" = token."latestSpendLogIndex",
    "latestSpendValuationId" = token."latestSpendValuationId",
    "analyticsUpdatedAt" = token."analyticsUpdatedAt"
FROM "etherfi_enriched"."Token" token
WHERE history."id" = token."id";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProtocolEvent_timestamp_desc_chainId_blockNumber_des_3vpg6g0bo4"
  ON "etherfi_enriched"."ProtocolEvent" ("timestamp" DESC, "chainId", "blockNumber" DESC, "logIndex" DESC, "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProtocolEvent_chainId_timestamp_desc_blockNumber_des_438xlub8nc"
  ON "etherfi_enriched"."ProtocolEvent" ("chainId", "timestamp" DESC, "blockNumber" DESC, "logIndex" DESC, "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProtocolEvent_eventType_timestamp_desc_chainId_block_acykdnh0db"
  ON "etherfi_enriched"."ProtocolEvent" ("eventType", "timestamp" DESC, "chainId", "blockNumber" DESC, "logIndex" DESC, "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProtocolEvent_chainId_eventType_timestamp_desc_block_ewax7r9baw"
  ON "etherfi_enriched"."ProtocolEvent" ("chainId", "eventType", "timestamp" DESC, "blockNumber" DESC, "logIndex" DESC, "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProtocolEvent_transactionHash_1yzt1zio8y"
  ON "etherfi_enriched"."ProtocolEvent" ("transactionHash");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProtocolEvent_blockNumber_3uv6j0bne8"
  ON "etherfi_enriched"."ProtocolEvent" ("blockNumber");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProtocolEvent_actor_9hlahrfsms"
  ON "etherfi_enriched"."ProtocolEvent" ("actor");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProtocolEvent_contractAddress_anp91p3o3z"
  ON "etherfi_enriched"."ProtocolEvent" ("contractAddress");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProtocolEvent_tokenAddress_5tvsmpjvl3"
  ON "etherfi_enriched"."ProtocolEvent" ("tokenAddress");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "SpendTokenValuation_chainId_tokenAddress_timestamp_d_9k3274hnj8"
  ON "etherfi_enriched"."SpendTokenValuation" ("chainId", "tokenAddress", "timestamp" DESC, "blockNumber" DESC, "logIndex" DESC, "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "TopUpRecipientMetric_topUpCount_desc_recipient_ecetzl0njt"
  ON "etherfi_enriched"."TopUpRecipientMetric" ("topUpCount" DESC, "recipient");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "TopUpRecipientMetric_chainId_topUpCount_desc_recipie_bhcieh0iw1"
  ON "etherfi_enriched"."TopUpRecipientMetric" ("chainId", "topUpCount" DESC, "recipient");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "CashbackReceiverMetric_amountUsd_desc_recipient_dqxo0f8l2m"
  ON "etherfi_enriched"."CashbackReceiverMetric" ("amountUsd" DESC, "recipient");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "CashbackReceiverMetric_chainId_amountUsd_desc_recipi_gg0h3b3cht"
  ON "etherfi_enriched"."CashbackReceiverMetric" ("chainId", "amountUsd" DESC, "recipient");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "SafeTierChange_chainId_timestamp_desc_blockNumber_de_ekje64flgd"
  ON "etherfi_enriched"."SafeTierChange" ("chainId", "timestamp" DESC, "blockNumber" DESC, "logIndex" DESC, "id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "SafeModeChange_chainId_timestamp_desc_blockNumber_de_8ydv1e2cym"
  ON "etherfi_enriched"."SafeModeChange" ("chainId", "timestamp" DESC, "blockNumber" DESC, "logIndex" DESC, "id");
