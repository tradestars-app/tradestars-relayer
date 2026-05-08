import bs58 from "bs58";

const WITHDRAW_REQUESTED_DISCRIMINATOR = Buffer.from([
  114, 16, 240, 206, 93, 128, 151, 39,
]);
const WITHDRAW_REQUESTED_EVENT_LENGTH = 80;

export type DecodedWithdrawRequestedEvent = {
  signature: string;
  user: string;
  amount: string;
  nonce: string;
  remainingTotalBalance: string;
  availableToWithdraw: string;
  timestamp: string;
};

type SolanaLogBundle = {
  signature: string | null;
  logs: string[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSignature(value: Record<string, unknown>): string | null {
  if (typeof value.signature === "string") return value.signature;
  if (typeof value.transactionSignature === "string") {
    return value.transactionSignature;
  }
  if (isPlainObject(value.transaction)) {
    if (typeof value.transaction.signature === "string") {
      return value.transaction.signature;
    }
    if (
      Array.isArray(value.transaction.signatures) &&
      typeof value.transaction.signatures[0] === "string"
    ) {
      return value.transaction.signatures[0];
    }
  }
  if (
    isPlainObject(value.raw) &&
    isPlainObject(value.raw.transaction) &&
    Array.isArray(value.raw.transaction.signatures) &&
    typeof value.raw.transaction.signatures[0] === "string"
  ) {
    return value.raw.transaction.signatures[0];
  }

  return null;
}

function readLogs(value: Record<string, unknown>): string[] | null {
  if (Array.isArray(value.logs) && value.logs.every((log) => typeof log === "string")) {
    return value.logs;
  }
  if (
    Array.isArray(value.logMessages) &&
    value.logMessages.every((log) => typeof log === "string")
  ) {
    return value.logMessages;
  }
  if (
    isPlainObject(value.meta) &&
    Array.isArray(value.meta.logMessages) &&
    value.meta.logMessages.every((log) => typeof log === "string")
  ) {
    return value.meta.logMessages;
  }
  if (
    isPlainObject(value.raw) &&
    isPlainObject(value.raw.transaction) &&
    isPlainObject(value.raw.transaction.meta) &&
    Array.isArray(value.raw.transaction.meta.logMessages) &&
    value.raw.transaction.meta.logMessages.every((log) => typeof log === "string")
  ) {
    return value.raw.transaction.meta.logMessages;
  }

  return null;
}

function collectLogBundles(
  value: unknown,
  inheritedSignature: string | null,
  bundles: SolanaLogBundle[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectLogBundles(item, inheritedSignature, bundles);
    }
    return;
  }

  if (!isPlainObject(value)) return;

  const signature = readSignature(value) ?? inheritedSignature;
  const logs = readLogs(value);
  if (logs) {
    bundles.push({ signature, logs });
  }

  for (const child of Object.values(value)) {
    collectLogBundles(child, signature, bundles);
  }
}

function extractAnchorEventData(log: string): Buffer | null {
  const match = log.match(/^Program (?:data|log):\s+([A-Za-z0-9+/=]+)$/);
  if (!match) return null;

  try {
    return Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
}

function decodeWithdrawRequestedEvent(
  data: Buffer,
  signature: string,
): DecodedWithdrawRequestedEvent | null {
  if (data.length < WITHDRAW_REQUESTED_EVENT_LENGTH) return null;
  if (!data.subarray(0, 8).equals(WITHDRAW_REQUESTED_DISCRIMINATOR)) {
    return null;
  }

  return {
    signature,
    user: bs58.encode(data.subarray(8, 40)),
    amount: data.readBigUInt64LE(40).toString(),
    nonce: data.readBigUInt64LE(48).toString(),
    remainingTotalBalance: data.readBigUInt64LE(56).toString(),
    availableToWithdraw: data.readBigUInt64LE(64).toString(),
    timestamp: data.readBigInt64LE(72).toString(),
  };
}

export function encodeWithdrawRequestedEventForTest(params: {
  user: string;
  amount: bigint;
  nonce: bigint;
  remainingTotalBalance: bigint;
  availableToWithdraw: bigint;
  timestamp: bigint;
}): string {
  const data = Buffer.alloc(WITHDRAW_REQUESTED_EVENT_LENGTH);
  WITHDRAW_REQUESTED_DISCRIMINATOR.copy(data, 0);
  const userBytes = bs58.decode(params.user);
  if (userBytes.length !== 32) {
    throw new Error("Invalid Solana public key");
  }
  Buffer.from(userBytes).copy(data, 8);
  data.writeBigUInt64LE(params.amount, 40);
  data.writeBigUInt64LE(params.nonce, 48);
  data.writeBigUInt64LE(params.remainingTotalBalance, 56);
  data.writeBigUInt64LE(params.availableToWithdraw, 64);
  data.writeBigInt64LE(params.timestamp, 72);
  return data.toString("base64");
}

export function getWithdrawRequestedEvents(
  payload: unknown,
): DecodedWithdrawRequestedEvent[] {
  const bundles: SolanaLogBundle[] = [];
  collectLogBundles(payload, null, bundles);

  const events: DecodedWithdrawRequestedEvent[] = [];
  const seen = new Set<string>();
  for (const bundle of bundles) {
    if (!bundle.signature) continue;

    for (const log of bundle.logs) {
      const data = extractAnchorEventData(log);
      if (!data) continue;

      const event = decodeWithdrawRequestedEvent(data, bundle.signature);
      if (!event) continue;

      const key = `${event.signature}:${event.user}:${event.nonce}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }
  }

  return events;
}

export function assertValidSolanaSignature(signature: string): void {
  const decoded = bs58.decode(signature);
  if (decoded.length !== 64) {
    throw new Error("Invalid Solana transaction signature");
  }
}
