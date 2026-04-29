import crypto from "crypto";
import { PublicKey } from "@solana/web3.js";

const U64_MAX = 18_446_744_073_709_551_615n;

export type AlchemyWebhookLog = {
  address?: string;
  transaction?: {
    hash?: string;
  };
  topics?: string[];
  data?: string;
  index?: number;
};

export type AlchemyWebhookPayload = {
  webhookId?: string;
  id?: string;
  createdAt?: string;
  event?: {
    data?: {
      block?: {
        logs?: AlchemyWebhookLog[];
      };
    };
  };
};

export type DecodedDepositLog = {
  orderId: string;
  user: PublicKey;
  amount: bigint;
  baseTxHash: string;
  baseTxHashBytes: number[];
  logIndex: number;
};

function isHexString(value: string, byteLength?: number): boolean {
  if (!/^(0x)?[0-9a-fA-F]+$/.test(value)) {
    return false;
  }

  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (byteLength === undefined) {
    return normalized.length % 2 === 0;
  }

  return normalized.length === byteLength * 2;
}

function hexToBytes(value: string): Uint8Array {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

export function verifyAlchemyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  signingKey: string,
): boolean {
  if (!isHexString(signatureHeader)) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", signingKey)
    .update(Buffer.from(rawBody, "utf8"))
    .digest();
  const received = Buffer.from(
    signatureHeader.startsWith("0x")
      ? signatureHeader.slice(2)
      : signatureHeader,
    "hex",
  );

  return (
    expected.length === received.length &&
    crypto.timingSafeEqual(expected, received)
  );
}

export function getWebhookLogs(payload: AlchemyWebhookPayload): AlchemyWebhookLog[] {
  return payload.event?.data?.block?.logs ?? [];
}

export function decodeDepositLog(
  log: AlchemyWebhookLog,
  expectedTopic0: string,
  expectedContractAddress?: string | null,
): DecodedDepositLog | null {
  const topics = log.topics ?? [];
  if (topics.length < 3) {
    return null;
  }

  if (topics[0]?.toLowerCase() !== expectedTopic0.toLowerCase()) {
    return null;
  }

  if (
    expectedContractAddress &&
    log.address?.toLowerCase() !== expectedContractAddress
  ) {
    return null;
  }

  const txHash = log.transaction?.hash;
  const rawLogIndex = log.index;
  const amountHex = log.data;
  if (!txHash || !isHexString(txHash, 32)) {
    throw new Error("Alchemy deposit log is missing a valid transaction hash");
  }
  if (
    rawLogIndex === undefined ||
    !Number.isInteger(rawLogIndex) ||
    rawLogIndex < 0 ||
    rawLogIndex > 0xffff_ffff
  ) {
    throw new Error("Alchemy deposit log is missing a valid log index");
  }
  if (!amountHex || !isHexString(amountHex)) {
    throw new Error("Alchemy deposit log is missing a valid amount");
  }

  const orderIdHex = topics[1];
  const walletHex = topics[2];
  if (!isHexString(orderIdHex, 32)) {
    throw new Error("Alchemy deposit log is missing a valid order id");
  }
  if (!isHexString(walletHex, 32)) {
    throw new Error("Alchemy deposit log is missing a valid Solana wallet");
  }

  const amount = BigInt(amountHex);
  if (amount <= 0n || amount > U64_MAX) {
    throw new Error("Alchemy deposit log amount is out of bounds");
  }

  const user = new PublicKey(hexToBytes(walletHex));

  return {
    orderId: BigInt(orderIdHex).toString(),
    user,
    amount,
    baseTxHash: txHash.toLowerCase(),
    baseTxHashBytes: Array.from(hexToBytes(txHash)),
    logIndex: rawLogIndex,
  };
}
