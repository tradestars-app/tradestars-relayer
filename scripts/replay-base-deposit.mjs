#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    envFile: undefined,
    relayerUrl: undefined,
    adminApiKey: undefined,
    network: undefined,
    tx: undefined,
    logIndex: undefined,
    execute: false,
    confirmMainnet: false,
  };

  for (const arg of argv) {
    if (arg === "--execute") {
      args.execute = true;
    } else if (arg === "--dry-run") {
      args.execute = false;
    } else if (arg === "--confirm-mainnet") {
      args.confirmMainnet = true;
    } else if (arg.startsWith("--env=")) {
      args.envFile = arg.slice("--env=".length);
    } else if (arg.startsWith("--relayer-url=")) {
      args.relayerUrl = arg.slice("--relayer-url=".length);
    } else if (arg.startsWith("--admin-api-key=")) {
      args.adminApiKey = arg.slice("--admin-api-key=".length);
    } else if (arg.startsWith("--network=")) {
      const network = arg.slice("--network=".length);
      if (network !== "base-mainnet" && network !== "base-sepolia") {
        throw new Error(
          "--network must be either base-mainnet or base-sepolia",
        );
      }
      args.network = network;
    } else if (arg.startsWith("--tx=")) {
      args.tx = arg.slice("--tx=".length);
    } else if (arg.startsWith("--log-index=")) {
      const logIndex = Number(arg.slice("--log-index=".length));
      if (!Number.isInteger(logIndex) || logIndex < 0) {
        throw new Error("--log-index must be a non-negative integer");
      }
      args.logIndex = logIndex;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.network) {
    throw new Error("Missing required --network=base-mainnet|base-sepolia");
  }
  if (!args.tx) {
    throw new Error("Missing required --tx=0x...");
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

    process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

function requireValue(name, explicitValue, envName) {
  const value = explicitValue || process.env[envName]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Pass it directly or set ${envName}.`);
  }

  return value;
}

function resolveRelayerUrl(explicitValue) {
  const value =
    explicitValue ||
    process.env.RELAYER_BASE_URL?.trim() ||
    process.env.RELAYER_ADMIN_API_URL?.trim();
  if (!value) {
    throw new Error(
      "Missing --relayer-url. Pass it directly or set RELAYER_BASE_URL / RELAYER_ADMIN_API_URL.",
    );
  }

  return value.replace(/\/$/, "");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.envFile) loadEnvFile(args.envFile);

  if (args.network === "base-mainnet" && args.execute && !args.confirmMainnet) {
    throw new Error(
      "Refusing to execute on base-mainnet without --confirm-mainnet",
    );
  }

  const relayerUrl = resolveRelayerUrl(args.relayerUrl);
  const adminApiKey = requireValue(
    "--admin-api-key",
    args.adminApiKey,
    "RELAYER_ADMIN_API_KEY",
  );

  const response = await fetch(`${relayerUrl}/api/admin/deposits/replay`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      network: args.network,
      txHash: args.tx,
      logIndex: args.logIndex,
      execute: args.execute,
    }),
  });
  const rawBody = await response.text();
  let payload = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    payload = {
      status: response.status,
      statusText: response.statusText,
      body: rawBody.slice(0, 500),
    };
  }

  console.log(JSON.stringify(payload, null, 2));

  if (!response.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
