import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const endpoint = process.env.HASURA_GRAPHQL_ENDPOINT;
if (!endpoint) {
  console.error("HASURA_GRAPHQL_ENDPOINT is required. Metadata was not changed.");
  process.exit(1);
}
const source = process.env.HASURA_SOURCE || "default";
const payloadPath = fileURLToPath(new URL("../migrations/hasura-cash-explorer-metadata.json", import.meta.url));
const payload = JSON.parse(await readFile(payloadPath, "utf8"));
payload.args.forEach((operation) => {
  if (operation.args?.source === "__HASURA_SOURCE__") operation.args.source = source;
});

const headers = { "content-type": "application/json" };
if (process.env.HASURA_GRAPHQL_ADMIN_SECRET) headers["x-hasura-admin-secret"] = process.env.HASURA_GRAPHQL_ADMIN_SECRET;
const metadataEndpoint = `${endpoint.replace(/\/$/, "")}/v1/metadata`;

async function apply(operation) {
  const response = await fetch(metadataEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(operation),
  });
  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  if (response.ok) return;

  if (operation.type === "pg_track_table" && parsed?.code === "already-tracked") {
    if (!operation.args.configuration) return;
    await apply({ type: "pg_set_table_customization", args: operation.args });
    return;
  }
  if (parsed?.code === "already-exists") return;
  if (
    (operation.type === "pg_create_object_relationship" || operation.type === "pg_create_array_relationship") &&
    (parsed?.code === "already-exists" || /already exists/i.test(parsed?.error ?? ""))
  )
    return;

  throw new Error(body || `Hasura metadata request failed with HTTP ${response.status}`);
}

for (const operation of payload.args) await apply(operation);
console.log(`Applied ${payload.args.length} Hasura metadata operations.`);
