import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ANSWER_UPDATED_TOPIC = "0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f";
const NEW_PRICE_UPDATE_TOPIC = "0x0b62719df03f34f9cd4469266344b26b09b76d94a1c2cc1a6a0f0d460cc8b7d1";
const BUCKET_SECONDS = 900n;
const USD_E18 = 10n ** 18n;

const sources = {
  optimismWeethEth: {
    chainId: 10,
    pair: "WEETH/ETH",
    address: "0x818e89b7fc0df4683a4d3768c4fdf2612a73277a",
    proxyAddress: "0xb4479d436dda5c1a79bd88d282725615202406e3",
    decimals: 18,
    maxStalenessSeconds: 172_800,
    event: "AnswerUpdated",
  },
  optimismEthUsd: {
    chainId: 10,
    pair: "ETH/USD",
    address: "0x02f5e9e9dcc66ba6392f6904d5fcf8625d9b19c9",
    proxyAddress: "0x13e3ee699d1909e989722e753853ae30b17e08c5",
    decimals: 8,
    maxStalenessSeconds: 172_800,
    event: "AnswerUpdated",
  },
  scrollUsdtUsd: {
    chainId: 534352,
    pair: "USDT/USD",
    address: "0xe863c747c127ef8cd543f3f8975e7a4ab7abb0f3",
    proxyAddress: "0xf376a91ae078927eb3686d6010a6f1482424954e",
    decimals: 8,
    maxStalenessSeconds: 15_552_000,
    event: "AnswerUpdated",
  },
  scrollScrUsd: {
    chainId: 534352,
    pair: "SCR/USD",
    address: "0x145234c9c1f1583e710bdc2926d6e97e4523ef93",
    proxyAddress: "0x145234c9c1f1583e710bdc2926d6e97e4523ef93",
    decimals: 8,
    maxStalenessSeconds: 15_552_000,
    event: "NewPriceUpdate",
  },
  binanceScrUsdt: {
    chainId: 0,
    pair: "SCR/USDT",
    address: "SCRUSDT",
    proxyAddress: "SCRUSDT",
    decimals: 18,
    maxStalenessSeconds: 900,
    event: "15m kline open",
  },
  binanceEthfiUsdt: {
    chainId: 0,
    pair: "ETHFI/USDT",
    address: "ETHFIUSDT",
    proxyAddress: "ETHFIUSDT",
    decimals: 18,
    maxStalenessSeconds: 900,
    event: "15m kline open",
  },
};

const outputRoutes = [
  {
    id: "534352:0x01f0a31698c4d065659b9bdc21b3610292a1c506",
    asset: "WEETH",
    validFrom: "2024-11-27T11:21:10Z",
    validUntilExclusive: "2025-03-24T18:15:34Z",
    source: "chainlink_cross_chain_historical_15m",
    sourceKeys: ["optimismWeethEth", "optimismEthUsd"],
  },
  {
    id: "534352:0xf55bec9cafdbe8730f096aa55dad6d22d44099df",
    asset: "USDT",
    validFrom: "2024-11-22T17:00:41Z",
    validUntilExclusive: "2025-03-24T18:15:34Z",
    source: "chainlink_same_chain_historical_15m",
    sourceKeys: ["scrollUsdtUsd"],
  },
  {
    id: "534352:0xd29687c813d741e2f938f4ac377128810e217b1b",
    asset: "SCR",
    validFrom: "2024-11-22T17:00:41Z",
    validUntilExclusive: "2025-03-24T18:15:34Z",
    source: "binance_then_chaos_oracle_historical_15m",
    sourceKeys: ["binanceScrUsdt", "scrollScrUsd"],
    calculationSourceKeys: ["scrollScrUsd"],
  },
];

const SCR_ROUTE_ID = "534352:0xd29687c813d741e2f938f4ac377128810e217b1b";
const SCR_ORACLE_BUCKET_START = BigInt(Math.floor(Date.parse("2025-02-06T09:45:00Z") / 1000));
const binanceOnlyRoutes = [
  {
    id: "534352:0x056a5fa5da84ceb7f93d36e545c5905607d8bd81",
    asset: "ETHFI",
    validFrom: "2025-04-30T16:11:30Z",
    validUntilExclusive: "2025-05-08T15:53:24Z",
    source: "binanceEthfiUsdt",
    sourceKeys: ["binanceEthfiUsdt"],
    symbol: "ETHFIUSDT",
  },
];
const priceRouteAliases = [
  {
    id: "534352:0xca0bfd5f735924e34cc567146989e467ffbbce1a",
    asset: "WEETH",
    priceRouteRef: "534352:0x01f0a31698c4d065659b9bdc21b3610292a1c506",
  },
];

const fetchPlans = [
  {
    rpcUrl: process.env.OPTIMISM_ARCHIVE_RPC_URL ?? "https://optimism-rpc.publicnode.com",
    fromBlock: 128_400_000,
    toBlock: 133_620_679,
    addresses: [sources.optimismWeethEth.address, sources.optimismEthUsd.address],
    topics: [ANSWER_UPDATED_TOPIC],
  },
  {
    rpcUrl: process.env.SCROLL_ARCHIVE_RPC_URL ?? "https://scroll-rpc.publicnode.com",
    fromBlock: 11_200_000,
    toBlock: 14_206_946,
    addresses: [sources.scrollUsdtUsd.address, sources.scrollScrUsd.address],
    topics: [ANSWER_UPDATED_TOPIC, NEW_PRICE_UPDATE_TOPIC],
  },
];

const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "../src/historical-price-buckets.json");

function blockHex(value) {
  return `0x${value.toString(16)}`;
}

function words(data) {
  const payload = data.slice(2);
  return Array.from({ length: payload.length / 64 }, (_, index) => `0x${payload.slice(index * 64, (index + 1) * 64)}`);
}

function signedWord(value) {
  const parsed = BigInt(value);
  return parsed >= 1n << 255n ? parsed - (1n << 256n) : parsed;
}

function decodeObservation(log) {
  const topic = log.topics[0].toLowerCase();
  if (topic === ANSWER_UPDATED_TOPIC) {
    return {
      answer: signedWord(log.topics[1]),
      updatedAt: BigInt(words(log.data)[0]),
      blockNumber: Number(BigInt(log.blockNumber)),
      logIndex: Number(BigInt(log.logIndex)),
    };
  }
  if (topic === NEW_PRICE_UPDATE_TOPIC) {
    const dataWords = words(log.data);
    return {
      answer: signedWord(dataWords[0]),
      updatedAt: BigInt(dataWords[2]),
      blockNumber: Number(BigInt(log.blockNumber)),
      logIndex: Number(BigInt(log.logIndex)),
    };
  }
  throw new Error(`Unsupported oracle topic ${topic}`);
}

async function rpc(url, method, params, attempt = 0) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
    return body.result;
  } catch (error) {
    if (attempt >= 8) throw error;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * 2 ** attempt));
    return rpc(url, method, params, attempt + 1);
  }
}

async function fetchPlanLogs(plan) {
  const ranges = [];
  for (let fromBlock = plan.fromBlock; fromBlock <= plan.toBlock; fromBlock += 10_000) {
    ranges.push([fromBlock, Math.min(fromBlock + 9_999, plan.toBlock)]);
  }
  const results = new Array(ranges.length);
  let nextRange = 0;
  async function worker() {
    while (nextRange < ranges.length) {
      const index = nextRange;
      nextRange += 1;
      const [fromBlock, toBlock] = ranges[index];
      results[index] = await rpc(plan.rpcUrl, "eth_getLogs", [
        {
          address: plan.addresses,
          topics: [plan.topics],
          fromBlock: blockHex(fromBlock),
          toBlock: blockHex(toBlock),
        },
      ]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, ranges.length) }, () => worker()));
  return results.flat();
}

function decimalToE18(value) {
  const [whole, fractional = ""] = value.split(".");
  return BigInt(whole) * USD_E18 + BigInt(fractional.padEnd(18, "0").slice(0, 18));
}

async function fetchBinanceBuckets(symbol, validFrom, validUntilExclusive) {
  const pricesByBucketId = {};
  let startTime = Math.floor(Date.parse(validFrom) / 900_000) * 900_000;
  const endTimeExclusive = Math.ceil(Date.parse(validUntilExclusive) / 900_000) * 900_000;
  while (startTime < endTimeExclusive) {
    const url = new URL("https://api.binance.com/api/v3/klines");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", "15m");
    url.searchParams.set("startTime", String(startTime));
    url.searchParams.set("endTime", String(endTimeExclusive - 1));
    url.searchParams.set("limit", "1000");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Binance historical price request failed with HTTP ${response.status}`);
    const klines = await response.json();
    if (!Array.isArray(klines) || klines.length === 0) break;
    for (const kline of klines) {
      const bucketId = BigInt(Math.floor(Number(kline[0]) / 1000)) / BUCKET_SECONDS;
      if (bucketId * BUCKET_SECONDS * 1000n >= BigInt(endTimeExclusive)) continue;
      pricesByBucketId[bucketId.toString()] = decimalToE18(String(kline[1])).toString();
    }
    startTime = Number(klines.at(-1)[0]) + Number(BUCKET_SECONDS) * 1000;
  }
  return pricesByBucketId;
}

function normalizeObservations(logs) {
  const byAddress = new Map();
  for (const log of logs) {
    const address = log.address.toLowerCase();
    const observation = decodeObservation(log);
    if (observation.answer <= 0n) continue;
    const current = byAddress.get(address) ?? [];
    current.push(observation);
    byAddress.set(address, current);
  }
  for (const observations of byAddress.values()) {
    observations.sort(
      (left, right) =>
        Number(left.updatedAt - right.updatedAt) ||
        left.blockNumber - right.blockNumber ||
        left.logIndex - right.logIndex,
    );
  }
  return byAddress;
}

function observationAtBucketStart(observations, cursor, bucketStart) {
  while (cursor.index + 1 < observations.length && observations[cursor.index + 1].updatedAt <= bucketStart) {
    cursor.index += 1;
  }
  return cursor.index >= 0 ? observations[cursor.index] : null;
}

function isFresh(source, observation, bucketStart) {
  return (
    observation &&
    observation.updatedAt <= bucketStart &&
    bucketStart - observation.updatedAt <= BigInt(source.maxStalenessSeconds)
  );
}

function buildRoute(route, observationsByAddress) {
  const calculationSourceKeys = route.calculationSourceKeys ?? route.sourceKeys;
  const routeSources = calculationSourceKeys.map((sourceKey) => sources[sourceKey]);
  const observations = routeSources.map((source) => observationsByAddress.get(source.address) ?? []);
  const cursors = observations.map(() => ({ index: -1 }));
  const from = BigInt(Math.floor(Date.parse(route.validFrom) / 1000));
  const until = BigInt(Math.floor(Date.parse(route.validUntilExclusive) / 1000));
  const firstBucket = from / BUCKET_SECONDS;
  const lastBucket = (until - 1n) / BUCKET_SECONDS;
  const pricesByBucketId = {};

  for (let bucketId = firstBucket; bucketId <= lastBucket; bucketId += 1n) {
    const bucketStart = bucketId * BUCKET_SECONDS;
    const current = observations.map((items, index) => observationAtBucketStart(items, cursors[index], bucketStart));
    if (!current.every((item, index) => isFresh(routeSources[index], item, bucketStart))) continue;

    const priceUsdE18 =
      route.asset === "WEETH"
        ? (current[0].answer * current[1].answer * USD_E18) /
          (10n ** BigInt(routeSources[0].decimals) * 10n ** BigInt(routeSources[1].decimals))
        : (current[0].answer * USD_E18) / 10n ** BigInt(routeSources[0].decimals);
    if (priceUsdE18 > 0n) pricesByBucketId[bucketId.toString()] = priceUsdE18.toString();
  }

  return {
    asset: route.asset,
    validFrom: route.validFrom,
    validUntilExclusive: route.validUntilExclusive,
    source: route.source,
    sourceKeys: route.sourceKeys,
    pricesByBucketId,
  };
}

let routes;
if (process.env.REGENERATE_ORACLE_BUCKETS === "1") {
  const allLogs = (await Promise.all(fetchPlans.map(fetchPlanLogs))).flat();
  const observationsByAddress = normalizeObservations(allLogs);
  routes = Object.fromEntries(outputRoutes.map((route) => [route.id, buildRoute(route, observationsByAddress)]));
} else {
  const checkedIn = JSON.parse(await readFile(outputPath, "utf8"));
  routes = Object.fromEntries(
    outputRoutes.map((route) => {
      const existing = checkedIn.routes?.[route.id];
      if (!existing) throw new Error(`Missing checked-in oracle buckets for ${route.id}`);
      return [
        route.id,
        {
          asset: route.asset,
          validFrom: route.validFrom,
          validUntilExclusive: route.validUntilExclusive,
          source: route.source,
          sourceKeys: route.sourceKeys,
          pricesByBucketId: existing.pricesByBucketId,
        },
      ];
    }),
  );
}
const binanceScrPrices = await fetchBinanceBuckets(
  "SCRUSDT",
  outputRoutes.find((route) => route.id === SCR_ROUTE_ID).validFrom,
  new Date(Number(SCR_ORACLE_BUCKET_START) * 1000).toISOString(),
);
const scrRoute = routes[SCR_ROUTE_ID];
const combinedScrEntries = [...Object.entries(binanceScrPrices), ...Object.entries(scrRoute.pricesByBucketId)].sort(
  ([left], [right]) => Number(BigInt(left) - BigInt(right)),
);
scrRoute.pricesByBucketId = Object.fromEntries(combinedScrEntries);
scrRoute.sourceKeyByBucketId = Object.fromEntries(
  combinedScrEntries.map(([bucketId]) => [
    bucketId,
    BigInt(bucketId) * BUCKET_SECONDS < SCR_ORACLE_BUCKET_START ? "binanceScrUsdt" : "scrollScrUsd",
  ]),
);
for (const route of binanceOnlyRoutes) {
  routes[route.id] = {
    asset: route.asset,
    validFrom: route.validFrom,
    validUntilExclusive: route.validUntilExclusive,
    source: route.source,
    sourceKeys: route.sourceKeys,
    pricesByBucketId: await fetchBinanceBuckets(route.symbol, route.validFrom, route.validUntilExclusive),
  };
}
for (const alias of priceRouteAliases) {
  const target = routes[alias.priceRouteRef];
  if (!target) throw new Error(`Missing historical price route ${alias.priceRouteRef}`);
  routes[alias.id] = {
    asset: alias.asset,
    validFrom: target.validFrom,
    validUntilExclusive: target.validUntilExclusive,
    source: target.source,
    sourceKeys: target.sourceKeys,
    priceRouteRef: alias.priceRouteRef,
  };
}
const output = {
  schemaVersion: 1,
  bucketSeconds: Number(BUCKET_SECONDS),
  lookupMode: "bucket_start_snapshot",
  sources,
  routes,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
for (const [id, route] of Object.entries(routes)) {
  const priceRoute = route.priceRouteRef ? routes[route.priceRouteRef] : route;
  console.log(`${id}: ${Object.keys(priceRoute.pricesByBucketId).length} priced 15-minute buckets`);
}
console.log(`Wrote ${outputPath}`);
