-- TokenAnalyticsMetric stopped-writer migration and historical backfill.
-- Run only while the Envio writer is stopped. Source entities, checkpoints,
-- and existing history tables are never changed.

BEGIN;

CREATE TABLE IF NOT EXISTS "etherfi_enriched"."TokenAnalyticsMetric" (
  "id" text PRIMARY KEY,
  "chainId" integer NOT NULL,
  "tokenAddress" text NOT NULL,
  "spendCount" numeric NOT NULL DEFAULT 0,
  "spendAmount" numeric NOT NULL DEFAULT 0,
  "spendUsd" numeric NOT NULL DEFAULT 0,
  "topUpCount" numeric NOT NULL DEFAULT 0,
  "topUpAmount" numeric NOT NULL DEFAULT 0,
  "withdrawalCount" numeric NOT NULL DEFAULT 0,
  "safeAccountCount" numeric NOT NULL DEFAULT 0,
  "safeBalance" numeric NOT NULL DEFAULT 0,
  "safeInflow" numeric NOT NULL DEFAULT 0,
  "safeOutflow" numeric NOT NULL DEFAULT 0,
  "destinationCount" numeric NOT NULL DEFAULT 0,
  "destinationBalance" numeric NOT NULL DEFAULT 0,
  "destinationInflow" numeric NOT NULL DEFAULT 0,
  "destinationOutflow" numeric NOT NULL DEFAULT 0,
  "suppliedCount" numeric NOT NULL DEFAULT 0,
  "suppliedAmount" numeric NOT NULL DEFAULT 0,
  "borrowedCount" numeric NOT NULL DEFAULT 0,
  "borrowedAmount" numeric NOT NULL DEFAULT 0,
  "borrowedUsd" numeric NOT NULL DEFAULT 0,
  "repaidCount" numeric NOT NULL DEFAULT 0,
  "repaidAmount" numeric NOT NULL DEFAULT 0,
  "repaidUsd" numeric NOT NULL DEFAULT 0,
  "latestSpendPriceUsdE18" numeric NOT NULL DEFAULT 0,
  "latestSpendPriceStatus" text NOT NULL DEFAULT 'unavailable',
  "latestSpendAt" timestamptz NOT NULL DEFAULT TIMESTAMPTZ 'epoch',
  "latestSpendBlockNumber" numeric NOT NULL DEFAULT 0,
  "latestSpendLogIndex" integer NOT NULL DEFAULT 0,
  "latestSpendValuationId" text NOT NULL DEFAULT '',
  "updatedAt" timestamptz NOT NULL DEFAULT TIMESTAMPTZ 'epoch',
  "updatedBlock" numeric NOT NULL DEFAULT 0,
  "updatedTransactionHash" text NOT NULL DEFAULT '',
  "updatedLogIndex" integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "etherfi_enriched"."envio_history_TokenAnalyticsMetric" (
  "id" text NOT NULL,
  "chainId" integer,
  "tokenAddress" text,
  "spendCount" numeric,
  "spendAmount" numeric,
  "spendUsd" numeric,
  "topUpCount" numeric,
  "topUpAmount" numeric,
  "withdrawalCount" numeric,
  "safeAccountCount" numeric,
  "safeBalance" numeric,
  "safeInflow" numeric,
  "safeOutflow" numeric,
  "destinationCount" numeric,
  "destinationBalance" numeric,
  "destinationInflow" numeric,
  "destinationOutflow" numeric,
  "suppliedCount" numeric,
  "suppliedAmount" numeric,
  "borrowedCount" numeric,
  "borrowedAmount" numeric,
  "borrowedUsd" numeric,
  "repaidCount" numeric,
  "repaidAmount" numeric,
  "repaidUsd" numeric,
  "latestSpendPriceUsdE18" numeric,
  "latestSpendPriceStatus" text,
  "latestSpendAt" timestamptz,
  "latestSpendBlockNumber" numeric,
  "latestSpendLogIndex" integer,
  "latestSpendValuationId" text,
  "updatedAt" timestamptz,
  "updatedBlock" numeric,
  "updatedTransactionHash" text,
  "updatedLogIndex" integer,
  "envio_checkpoint_id" bigint NOT NULL,
  "envio_change" "etherfi_enriched"."envio_history_change" NOT NULL,
  PRIMARY KEY ("id", "envio_checkpoint_id")
);

CREATE INDEX IF NOT EXISTS "TokenAnalyticsMetric_chainId_31v359q17n5ws"
  ON "etherfi_enriched"."TokenAnalyticsMetric" ("chainId");
CREATE INDEX IF NOT EXISTS "TokenAnalyticsMetric_tokenAddress_2pw784siynxib"
  ON "etherfi_enriched"."TokenAnalyticsMetric" ("tokenAddress");

-- Each large source is grouped once. Latest spend valuation is reused from
-- Token, where it was already backfilled with deterministic event tie-breakers.
WITH
spend AS (
  SELECT "chainId", lower("tokenAddress") AS "tokenAddress",
         count(*) AS "spendCount", COALESCE(sum("amount"), 0) AS "spendAmount",
         COALESCE(sum("amountUsd"), 0) AS "spendUsd"
  FROM "etherfi_enriched"."SpendTokenValuation"
  GROUP BY "chainId", lower("tokenAddress")
),
top_up AS (
  SELECT "chainId", lower("tokenAddress") AS "tokenAddress",
         count(*) AS "topUpCount", COALESCE(sum("amount"), 0) AS "topUpAmount"
  FROM "etherfi_enriched"."TopUp"
  GROUP BY "chainId", lower("tokenAddress")
),
withdrawal_token AS (
  SELECT DISTINCT w."id", w."chainId", lower(token_address) AS "tokenAddress"
  FROM "etherfi_enriched"."WithdrawalEvent" w
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN w."tokens" ~* '^\s*\[\s*("0x[0-9a-f]{40}"\s*(,\s*"0x[0-9a-f]{40}"\s*)*)?\]\s*$'
        THEN w."tokens"::jsonb
      ELSE '[]'::jsonb
    END
  ) AS token_address
  WHERE w."status" = 'requested'
),
withdrawal AS (
  SELECT "chainId", "tokenAddress", count(*) AS "withdrawalCount"
  FROM withdrawal_token
  GROUP BY "chainId", "tokenAddress"
),
safe_balance AS (
  SELECT "chainId", lower("tokenAddress") AS "tokenAddress", count(*) AS "safeAccountCount",
         COALESCE(sum("amount"), 0) AS "safeBalance", COALESCE(sum("inflow"), 0) AS "safeInflow",
         COALESCE(sum("outflow"), 0) AS "safeOutflow"
  FROM "etherfi_enriched"."SafeTokenBalance"
  GROUP BY "chainId", lower("tokenAddress")
),
destination_balance AS (
  SELECT "chainId", lower("tokenAddress") AS "tokenAddress", count(*) AS "destinationCount",
         COALESCE(sum("amount"), 0) AS "destinationBalance", COALESCE(sum("inflow"), 0) AS "destinationInflow",
         COALESCE(sum("outflow"), 0) AS "destinationOutflow"
  FROM "etherfi_enriched"."AccountTokenBalance"
  GROUP BY "chainId", lower("tokenAddress")
),
debt AS (
  SELECT "chainId", lower("tokenAddress") AS "tokenAddress",
         count(*) FILTER (WHERE "eventType" = 'supplied') AS "suppliedCount",
         COALESCE(sum("amount") FILTER (WHERE "eventType" = 'supplied'), 0) AS "suppliedAmount",
         count(*) FILTER (WHERE "eventType" IN ('borrowed', 'lend_borrowed')) AS "borrowedCount",
         COALESCE(sum("amount") FILTER (WHERE "eventType" IN ('borrowed', 'lend_borrowed')), 0) AS "borrowedAmount",
         COALESCE(sum("amountUsd") FILTER (WHERE "eventType" IN ('borrowed', 'lend_borrowed')), 0) AS "borrowedUsd",
         count(*) FILTER (WHERE "eventType" IN ('repaid', 'repay_lend_token_amount')) AS "repaidCount",
         COALESCE(sum("amount") FILTER (WHERE "eventType" IN ('repaid', 'repay_lend_token_amount')), 0) AS "repaidAmount",
         COALESCE(sum("amountUsd") FILTER (WHERE "eventType" IN ('repaid', 'repay_lend_token_amount')), 0) AS "repaidUsd"
  FROM "etherfi_enriched"."DebtEvent"
  GROUP BY "chainId", lower("tokenAddress")
),
repayment AS (
  SELECT "chainId", lower("tokenAddress") AS "tokenAddress", count(*) AS "repaidCount",
         COALESCE(sum("amount"), 0) AS "repaidAmount", COALESCE(sum("amountUsd"), 0) AS "repaidUsd"
  FROM "etherfi_enriched"."Repayment"
  GROUP BY "chainId", lower("tokenAddress")
),
keys AS (
  SELECT "chainId", "tokenAddress" FROM spend UNION
  SELECT "chainId", "tokenAddress" FROM top_up UNION
  SELECT "chainId", "tokenAddress" FROM withdrawal UNION
  SELECT "chainId", "tokenAddress" FROM safe_balance UNION
  SELECT "chainId", "tokenAddress" FROM destination_balance UNION
  SELECT "chainId", "tokenAddress" FROM debt UNION
  SELECT "chainId", "tokenAddress" FROM repayment
)
INSERT INTO "etherfi_enriched"."TokenAnalyticsMetric" (
  "id", "chainId", "tokenAddress", "spendCount", "spendAmount", "spendUsd", "topUpCount", "topUpAmount",
  "withdrawalCount", "safeAccountCount", "safeBalance", "safeInflow", "safeOutflow", "destinationCount",
  "destinationBalance", "destinationInflow", "destinationOutflow", "suppliedCount", "suppliedAmount",
  "borrowedCount", "borrowedAmount", "borrowedUsd", "repaidCount", "repaidAmount", "repaidUsd",
  "latestSpendPriceUsdE18", "latestSpendPriceStatus", "latestSpendAt", "latestSpendBlockNumber",
  "latestSpendLogIndex", "latestSpendValuationId", "updatedAt", "updatedBlock", "updatedTransactionHash",
  "updatedLogIndex"
)
SELECT
  k."chainId"::text || ':' || k."tokenAddress", k."chainId", k."tokenAddress",
  COALESCE(s."spendCount", 0), COALESCE(s."spendAmount", 0), COALESCE(s."spendUsd", 0),
  COALESCE(t."topUpCount", 0), COALESCE(t."topUpAmount", 0), COALESCE(w."withdrawalCount", 0),
  COALESCE(sb."safeAccountCount", 0), COALESCE(sb."safeBalance", 0), COALESCE(sb."safeInflow", 0),
  COALESCE(sb."safeOutflow", 0), COALESCE(db."destinationCount", 0), COALESCE(db."destinationBalance", 0),
  COALESCE(db."destinationInflow", 0), COALESCE(db."destinationOutflow", 0), COALESCE(d."suppliedCount", 0),
  COALESCE(d."suppliedAmount", 0), COALESCE(d."borrowedCount", 0), COALESCE(d."borrowedAmount", 0),
  COALESCE(d."borrowedUsd", 0), COALESCE(d."repaidCount", 0) + COALESCE(r."repaidCount", 0),
  COALESCE(d."repaidAmount", 0) + COALESCE(r."repaidAmount", 0),
  COALESCE(d."repaidUsd", 0) + COALESCE(r."repaidUsd", 0),
  COALESCE(tok."latestSpendPriceUsdE18", 0), COALESCE(tok."latestSpendPriceStatus", 'unavailable'),
  COALESCE(tok."latestSpendAt", TIMESTAMPTZ 'epoch'), COALESCE(tok."latestSpendBlockNumber", 0),
  COALESCE(tok."latestSpendLogIndex", 0), COALESCE(tok."latestSpendValuationId", ''),
  COALESCE(tok."analyticsUpdatedAt", TIMESTAMPTZ 'epoch'), COALESCE(tok."latestSpendBlockNumber", 0), '',
  COALESCE(tok."latestSpendLogIndex", 0)
FROM keys k
LEFT JOIN spend s USING ("chainId", "tokenAddress")
LEFT JOIN top_up t USING ("chainId", "tokenAddress")
LEFT JOIN withdrawal w USING ("chainId", "tokenAddress")
LEFT JOIN safe_balance sb USING ("chainId", "tokenAddress")
LEFT JOIN destination_balance db USING ("chainId", "tokenAddress")
LEFT JOIN debt d USING ("chainId", "tokenAddress")
LEFT JOIN repayment r USING ("chainId", "tokenAddress")
LEFT JOIN "etherfi_enriched"."Token" tok
  ON tok."chainId" = k."chainId" AND lower(tok."address") = k."tokenAddress"
ON CONFLICT ("id") DO UPDATE SET
  "spendCount" = EXCLUDED."spendCount", "spendAmount" = EXCLUDED."spendAmount",
  "spendUsd" = EXCLUDED."spendUsd", "topUpCount" = EXCLUDED."topUpCount",
  "topUpAmount" = EXCLUDED."topUpAmount", "withdrawalCount" = EXCLUDED."withdrawalCount",
  "safeAccountCount" = EXCLUDED."safeAccountCount", "safeBalance" = EXCLUDED."safeBalance",
  "safeInflow" = EXCLUDED."safeInflow", "safeOutflow" = EXCLUDED."safeOutflow",
  "destinationCount" = EXCLUDED."destinationCount", "destinationBalance" = EXCLUDED."destinationBalance",
  "destinationInflow" = EXCLUDED."destinationInflow", "destinationOutflow" = EXCLUDED."destinationOutflow",
  "suppliedCount" = EXCLUDED."suppliedCount", "suppliedAmount" = EXCLUDED."suppliedAmount",
  "borrowedCount" = EXCLUDED."borrowedCount", "borrowedAmount" = EXCLUDED."borrowedAmount",
  "borrowedUsd" = EXCLUDED."borrowedUsd", "repaidCount" = EXCLUDED."repaidCount",
  "repaidAmount" = EXCLUDED."repaidAmount", "repaidUsd" = EXCLUDED."repaidUsd",
  "latestSpendPriceUsdE18" = EXCLUDED."latestSpendPriceUsdE18",
  "latestSpendPriceStatus" = EXCLUDED."latestSpendPriceStatus", "latestSpendAt" = EXCLUDED."latestSpendAt",
  "latestSpendBlockNumber" = EXCLUDED."latestSpendBlockNumber",
  "latestSpendLogIndex" = EXCLUDED."latestSpendLogIndex",
  "latestSpendValuationId" = EXCLUDED."latestSpendValuationId", "updatedAt" = EXCLUDED."updatedAt",
  "updatedBlock" = EXCLUDED."updatedBlock", "updatedTransactionHash" = EXCLUDED."updatedTransactionHash",
  "updatedLogIndex" = EXCLUDED."updatedLogIndex";

COMMIT;

-- Validation:
-- SELECT count(*) FROM "etherfi_enriched"."TokenAnalyticsMetric";
