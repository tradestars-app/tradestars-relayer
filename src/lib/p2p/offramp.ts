import { createHash } from "crypto";
import bs58 from "bs58";
import { createPublicClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Offramp (voucher-attested, single user tx). The relayer is now a pure
 * ATTESTER: when a Solana burn is observed it SIGNS an EIP-712
 * `OfframpVoucher` off-chain and persists it on the withdrawal record — it
 * sends NO Base transaction (no gas, no nonces, no tx retries). The user's
 * single Base tx (`userRedeemAndStartOfframp`) verifies the voucher, releases
 * vault USDC into their own proxy, and places the SELL atomically. See
 * payment-integrators/docs/OFFRAMP-V2.md.
 */

const VOUCHER_DOMAIN_NAME = "TradeStarsOfframp";
const VOUCHER_DOMAIN_VERSION = "1";

export const OFFRAMP_VOUCHER_TYPES = {
  OfframpVoucher: [
    { name: "solanaBurnTx", type: "bytes32" },
    { name: "solanaUserPubkey", type: "bytes32" },
    { name: "user", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const INTEGRATOR_READ_ABI = [
  {
    name: "burnToAllocation",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "burnTx", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type P2POfframpConfig = {
  baseRpcUrl: string;
  chainId: number;
  integratorAddress: Address;
  diamondAddress: Address;
  /** The attester key — signs vouchers off-chain; never transacts. */
  relayerPrivateKey: `0x${string}`;
  /** Voucher validity window in seconds (attester re-signs after lapse). */
  voucherTtlSeconds: number;
};

/** The voucher exactly as the integrator hashes it (all uint256s as decimal strings). */
export type OfframpVoucher = {
  solanaBurnTx: `0x${string}`;
  solanaUserPubkey: `0x${string}`;
  user: Address;
  amount: string;
  deadline: string;
};

export function solanaSignatureToBurnBytes32(signature: string): `0x${string}` {
  const decoded = bs58.decode(signature);
  return `0x${createHash("sha256").update(decoded).digest("hex")}`;
}

export function solanaPubkeyToBytes32(pubkey: string): `0x${string}` {
  const bytes = bs58.decode(pubkey);
  if (bytes.length !== 32) {
    throw new Error("Invalid Solana public key");
  }
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

/**
 * Has this burn's voucher already been redeemed on-chain? Reads the
 * integrator's `burnToAllocation` dedupe map (non-zero ⇒ redeemed). Used for
 * idempotency/observability only — signing itself needs no RPC.
 */
export async function getAllocationIdForBurn(params: {
  config: P2POfframpConfig;
  burnTx: `0x${string}`;
}): Promise<string | null> {
  const publicClient = createPublicClient({
    transport: http(params.config.baseRpcUrl),
  });
  const allocationId = await publicClient.readContract({
    address: params.config.integratorAddress,
    abi: INTEGRATOR_READ_ABI,
    functionName: "burnToAllocation",
    args: [params.burnTx],
  });
  return allocationId === 0n ? null : allocationId.toString();
}

/**
 * Sign an `OfframpVoucher` for an observed burn. Pure off-chain — no RPC, no
 * transaction. `baseAddress` is the user's Base EOA (proxy owner) recorded on
 * the withdrawal by the product app; it becomes `voucher.user`, the ONLY
 * wallet that can redeem. Deadline = now + voucherTtlSeconds; if it lapses
 * before the user redeems, just call this again (same burn, fresh deadline —
 * the on-chain burn dedupe makes double-redemption impossible regardless).
 */
export async function signOfframpVoucher(params: {
  config: P2POfframpConfig;
  baseAddress: Address;
  amount: string;
  signature: string;
  solanaUser: string;
}): Promise<{ voucher: OfframpVoucher; voucherSignature: `0x${string}` }> {
  const account = privateKeyToAccount(params.config.relayerPrivateKey);
  const voucher: OfframpVoucher = {
    solanaBurnTx: solanaSignatureToBurnBytes32(params.signature),
    solanaUserPubkey: solanaPubkeyToBytes32(params.solanaUser),
    user: params.baseAddress,
    amount: params.amount,
    deadline: String(
      Math.floor(Date.now() / 1000) + params.config.voucherTtlSeconds,
    ),
  };

  const voucherSignature = await account.signTypedData({
    domain: {
      name: VOUCHER_DOMAIN_NAME,
      version: VOUCHER_DOMAIN_VERSION,
      chainId: params.config.chainId,
      verifyingContract: params.config.integratorAddress,
    },
    types: OFFRAMP_VOUCHER_TYPES,
    primaryType: "OfframpVoucher",
    message: {
      solanaBurnTx: voucher.solanaBurnTx,
      solanaUserPubkey: voucher.solanaUserPubkey,
      user: voucher.user,
      amount: BigInt(voucher.amount),
      deadline: BigInt(voucher.deadline),
    },
  });

  return { voucher, voucherSignature };
}

export function isVoucherExpired(
  voucher: Pick<OfframpVoucher, "deadline">,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  return BigInt(voucher.deadline) < BigInt(nowSeconds);
}
