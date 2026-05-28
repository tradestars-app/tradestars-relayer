#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    envFile: undefined,
    relayerUrl: undefined,
    adminApiKey: undefined,
    signature: undefined,
    user: undefined,
    amount: undefined,
    nonce: undefined,
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
    } else if (arg.startsWith("--signature=")) {
      args.signature = arg.slice("--signature=".length);
    } else if (arg.startsWith("--user=")) {
      args.user = arg.slice("--user=".length);
    } else if (arg.startsWith("--amount=")) {
      args.amount = arg.slice("--amount=".length);
    } else if (arg.startsWith("--nonce=")) {
      args.nonce = arg.slice("--nonce=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  for (const field of ["signature", "user", "amount", "nonce"]) {
    if (!args[field]) throw new Error(`Missing required --${field}=...`);
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

  const relayerUrl = resolveRelayerUrl(args.relayerUrl);
  if (
    args.execute &&
    !args.confirmMainnet &&
    /tradestars-relayer\.vercel\.app\/?$/i.test(relayerUrl)
  ) {
    throw new Error(
      "Refusing to execute against the production relayer without --confirm-mainnet",
    );
  }

  const adminApiKey = requireValue(
    "--admin-api-key",
    args.adminApiKey,
    "RELAYER_ADMIN_API_KEY",
  );

  const response = await fetch(`${relayerUrl}/api/admin/withdrawals/replay`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      signature: args.signature,
      user: args.user,
      amount: args.amount,
      nonce: args.nonce,
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
