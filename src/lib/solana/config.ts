import { type Commitment, Keypair, PublicKey } from "@solana/web3.js";
import { requireEnv } from "@/lib/env-utils";

export function getSolanaRpcUrl(): string {
  return requireEnv("SOLANA_RPC", process.env.SOLANA_RPC);
}

export function getProgramId(): PublicKey {
  return new PublicKey(
    requireEnv("NEXT_PUBLIC_PROGRAM_ID", process.env.NEXT_PUBLIC_PROGRAM_ID),
  );
}

export function getMintingAuthorityKeypair(): Keypair {
  const raw = requireEnv(
    "SOLANA_MINTING_AUTHORITY_KEYPAIR",
    process.env.SOLANA_MINTING_AUTHORITY_KEYPAIR,
  );
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

export function getSolanaMintComputeUnitPriceMicroLamports(): number {
  const raw = process.env.SOLANA_MINT_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS ?? "10000";
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("SOLANA_MINT_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS must be a non-negative number");
  }
  return value;
}

export function getSolanaMintConfirmationCommitment(): Commitment {
  const raw = process.env.SOLANA_MINT_CONFIRMATION_COMMITMENT ?? "confirmed";
  if (raw !== "processed" && raw !== "confirmed" && raw !== "finalized") {
    throw new Error(
      "SOLANA_MINT_CONFIRMATION_COMMITMENT must be processed, confirmed, or finalized",
    );
  }
  return raw;
}
