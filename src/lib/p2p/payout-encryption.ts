import {
  createDecipheriv,
  createHash,
} from "crypto";
import { requireEnv } from "@/lib/env-utils";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const raw = requireEnv(
    "P2P_WITHDRAWAL_ENCRYPTION_KEY",
    process.env.P2P_WITHDRAWAL_ENCRYPTION_KEY,
  ).trim();

  if (/^[a-fA-F0-9]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  if (/^[A-Za-z0-9+/=]{44}$/.test(raw)) return Buffer.from(raw, "base64");

  return createHash("sha256").update(raw).digest();
}

export function decryptP2PPayoutAddress(encryptedValue: string): string {
  const [version, iv, tag, encrypted] = encryptedValue.split(".");
  if (version !== VERSION || !iv || !tag || !encrypted) {
    throw new Error("Invalid encrypted P2P payout address");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
