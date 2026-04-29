import { Keypair, PublicKey } from "@solana/web3.js";
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
