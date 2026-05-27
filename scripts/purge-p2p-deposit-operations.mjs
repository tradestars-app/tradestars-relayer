#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";

function parseArgs(argv) {
  const args = {
    envFile: undefined,
    prefix: undefined,
    execute: false,
    limit: 20,
  };

  for (const arg of argv) {
    if (arg === "--execute") {
      args.execute = true;
    } else if (arg.startsWith("--env=")) {
      args.envFile = arg.slice("--env=".length);
    } else if (arg.startsWith("--prefix=")) {
      args.prefix = arg.slice("--prefix=".length);
    } else if (arg.startsWith("--limit=")) {
      args.limit = Number(arg.slice("--limit=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function loadEnvFile(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    const value = rawValue.trim().replace(/^(['"])(.*)\1$/, "$2");
    process.env[key] = value;
  }
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

const args = parseArgs(process.argv.slice(2));
if (args.envFile) loadEnvFile(args.envFile);

const prefix = args.prefix || process.env.TRADESTARS_REDIS_KEY_PREFIX?.trim();
if (!prefix) {
  throw new Error(
    "Pass --prefix=ts-relayer or set TRADESTARS_REDIS_KEY_PREFIX. Refusing to infer a production key prefix.",
  );
}

const redis = new Redis({
  url:
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    requireEnv("KV_REST_API_URL"),
  token:
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    requireEnv("KV_REST_API_TOKEN"),
});

const indexKey = `${prefix}:p2p:deposits:index`;
const ids = (await redis.zrange(indexKey, 0, -1)) ?? [];
const recordKeys = ids.map((id) => `${prefix}:p2p:deposit:${id}`);
const preview = ids.slice(0, Math.max(0, args.limit));

console.log(JSON.stringify({
  mode: args.execute ? "execute" : "dry-run",
  prefix,
  indexKey,
  operationCount: ids.length,
  preview,
}, null, 2));

if (!args.execute) {
  console.log("Dry run only. Re-run with --execute and CONFIRM_PURGE_P2P_DEPOSIT_OPERATIONS=<prefix> to delete these relayer operation logs.");
  process.exit(0);
}

if (process.env.CONFIRM_PURGE_P2P_DEPOSIT_OPERATIONS !== prefix) {
  throw new Error(
    `Set CONFIRM_PURGE_P2P_DEPOSIT_OPERATIONS=${prefix} to confirm deletion.`,
  );
}

for (const keys of chunk(recordKeys, 100)) {
  if (keys.length === 0) continue;
  const pipeline = redis.pipeline();
  for (const key of keys) pipeline.del(key);
  await pipeline.exec();
}
await redis.del(indexKey);

console.log(JSON.stringify({ deletedOperationRecords: recordKeys.length, deletedIndexKey: indexKey }, null, 2));
