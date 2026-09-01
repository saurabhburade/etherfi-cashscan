#!/usr/bin/env node

// Envio stores the public configuration beside its checkpoint and rejects a
// resume when that snapshot differs. Render a single SQL statement so a
// physical no-reset migration can acknowledge the matching schema/config.
import { getPublicConfigJson } from "../node_modules/envio/src/Config.res.mjs";

const schemaFlag = process.argv.indexOf("--schema");
const schema = (schemaFlag >= 0 ? process.argv[schemaFlag + 1] : undefined) ?? process.env.ENVIO_PG_SCHEMA ?? "public";

if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
  throw new Error(`Invalid PostgreSQL schema identifier: ${schema}`);
}

const encodedConfig = Buffer.from(JSON.stringify(getPublicConfigJson()), "utf8").toString("base64");
const quotedSchema = `"${schema}"`;
process.stdout.write(
  `UPDATE ${quotedSchema}."envio_info" SET config = convert_from(decode('${encodedConfig}', 'base64'), 'UTF8') WHERE id = 1;\n`,
);
