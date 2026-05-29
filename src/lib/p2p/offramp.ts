import { createHash } from "crypto";
import bs58 from "bs58";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  http,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Offramp v2 (user-driven). The relayer's ONLY on-chain job is a one-time
 * `allocateOfframp` that moves vault USDC into the user's per-user proxy. The
 * end user then drives the SELL (place / deliver UPI / retry) from the widget,
 * so this module no longer places orders, polls, encrypts payout addresses, or
 * reconciles. See payment-integrators/docs/OFFRAMP-V2.md.
 */

const OFFRAMP_ALLOCATED_EVENT = {
  type: "event",
  name: "OfframpAllocated",
  inputs: [
    { name: "allocationId", type: "uint256", indexed: true },
    { name: "user", type: "address", indexed: true },
    { name: "proxy", type: "address", indexed: false },
    { name: "amount", type: "uint256", indexed: false },
    { name: "solanaBurnTx", type: "bytes32", indexed: true },
    { name: "solanaUserPubkey", type: "bytes32", indexed: false },
  ],
} as const;

const INTEGRATOR_ABI = [
  {
    name: "allocateOfframp",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "solanaBurnTx", type: "bytes32" },
      { name: "solanaUserPubkey", type: "bytes32" },
    ],
    outputs: [{ name: "allocationId", type: "uint256" }],
  },
  {
    name: "burnToAllocation",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "burnTx", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  OFFRAMP_ALLOCATED_EVENT,
] as const;

export type P2POfframpConfig = {
  baseRpcUrl: string;
  integratorAddress: Address;
  diamondAddress: Address;
  relayerPrivateKey: `0x${string}`;
};

const BASE_SEPOLIA_CHAIN = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [] },
  },
});

function getClients(config: P2POfframpConfig) {
  const transport = http(config.baseRpcUrl);
  const account = privateKeyToAccount(config.relayerPrivateKey);
  return {
    publicClient: createPublicClient({ chain: BASE_SEPOLIA_CHAIN, transport }),
    walletClient: createWalletClient({
      account,
      chain: BASE_SEPOLIA_CHAIN,
      transport,
    }),
    account,
  };
}

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
 * Idempotency read: returns the existing allocationId for a burn (or null).
 * The on-chain `burnToAllocation` map dedupes burns, so a re-run resumes an
 * existing allocation instead of double-allocating.
 */
export async function getAllocationIdForBurn(params: {
  config: P2POfframpConfig;
  burnTx: `0x${string}`;
}): Promise<string | null> {
  const { publicClient } = getClients(params.config);
  const allocationId = await publicClient.readContract({
    address: params.config.integratorAddress,
    abi: INTEGRATOR_ABI,
    functionName: "burnToAllocation",
    args: [params.burnTx],
  });
  return allocationId === 0n ? null : allocationId.toString();
}

/**
 * Move vault USDC into the user's per-user proxy. `baseAddress` is the user's
 * Base EOA (the proxy owner) — the product app must record it on the
 * withdrawal so we can target the right proxy.
 */
export async function allocateOfframp(params: {
  config: P2POfframpConfig;
  baseAddress: Address;
  amount: string;
  signature: string;
  solanaUser: string;
}): Promise<{ allocationId: string; txHash: Hash }> {
  const { publicClient, walletClient, account } = getClients(params.config);
  const burnTx = solanaSignatureToBurnBytes32(params.signature);
  const txHash = await walletClient.writeContract({
    address: params.config.integratorAddress,
    abi: INTEGRATOR_ABI,
    functionName: "allocateOfframp",
    args: [
      params.baseAddress,
      BigInt(params.amount),
      burnTx,
      solanaPubkeyToBytes32(params.solanaUser),
    ],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: INTEGRATOR_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "OfframpAllocated") {
        return {
          allocationId: decoded.args.allocationId.toString(),
          txHash,
        };
      }
    } catch {
      // Ignore unrelated logs in the receipt.
    }
  }

  const existingAllocationId = await getAllocationIdForBurn({
    config: params.config,
    burnTx,
  });
  if (!existingAllocationId) {
    throw new Error("Offramp allocation succeeded but allocationId was not found");
  }

  return { allocationId: existingAllocationId, txHash };
}
