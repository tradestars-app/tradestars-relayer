import { createHash } from "crypto";
import bs58 from "bs58";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  http,
  stringToHex,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  encryptPaymentAddress,
  type RelayIdentity,
} from "@p2pdotme/sdk/orders";
import { PublicKey } from "@solana/web3.js";

const ORDER_TUPLE = {
  name: "",
  type: "tuple",
  components: [
    { name: "amount", type: "uint256" },
    { name: "fiatAmount", type: "uint256" },
    { name: "placedTimestamp", type: "uint256" },
    { name: "completedTimestamp", type: "uint256" },
    { name: "userCompletedTimestamp", type: "uint256" },
    { name: "acceptedMerchant", type: "address" },
    { name: "user", type: "address" },
    { name: "recipientAddr", type: "address" },
    { name: "pubkey", type: "string" },
    { name: "encUpi", type: "string" },
    { name: "userCompleted", type: "bool" },
    { name: "status", type: "uint8" },
    { name: "orderType", type: "uint8" },
    {
      name: "disputeInfo",
      type: "tuple",
      components: [
        { name: "raisedBy", type: "uint8" },
        { name: "status", type: "uint8" },
        { name: "redactTransId", type: "uint256" },
        { name: "accountNumber", type: "uint256" },
      ],
    },
    { name: "id", type: "uint256" },
    { name: "userPubKey", type: "string" },
    { name: "encMerchantUpi", type: "string" },
    { name: "acceptedAccountNo", type: "uint256" },
    { name: "assignedAccountNos", type: "uint256[]" },
    { name: "currency", type: "bytes32" },
    { name: "preferredPaymentChannelConfigId", type: "uint256" },
    { name: "circleId", type: "uint256" },
  ],
} as const;

const OFFRAMP_INITIATED_EVENT = {
  type: "event",
  name: "OfframpInitiated",
  inputs: [
    { name: "orderId", type: "uint256", indexed: true },
    { name: "solanaBurnTx", type: "bytes32", indexed: true },
    { name: "solanaUserPubkey", type: "bytes32", indexed: true },
    { name: "usdcAmount", type: "uint256", indexed: false },
  ],
} as const;

const INTEGRATOR_ABI = [
  {
    name: "placeSellOrderForBurn",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "solanaBurnTx", type: "bytes32" },
      { name: "solanaUserPubkey", type: "bytes32" },
      { name: "usdcAmount", type: "uint256" },
      { name: "currency", type: "bytes32" },
      { name: "fiatAmount", type: "uint256" },
      { name: "circleId", type: "uint256" },
      { name: "preferredPaymentChannelConfigId", type: "uint256" },
      { name: "userPubKey", type: "string" },
    ],
    outputs: [{ name: "orderId", type: "uint256" }],
  },
  {
    name: "deliverOfframpUpi",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "uint256" },
      { name: "encUpi", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "reconcile",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "uint256" },
      { name: "currentStatus", type: "uint8" },
    ],
    outputs: [],
  },
  {
    name: "solanaBurnToOrderId",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "burnTx", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  OFFRAMP_INITIATED_EVENT,
] as const;

const DIAMOND_ABI = [
  {
    name: "getOrdersById",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [ORDER_TUPLE],
  },
] as const;

export const P2P_ORDER_STATUS = {
  placed: 0,
  accepted: 1,
  paid: 2,
  completed: 3,
  cancelled: 4,
} as const;

export type P2POfframpConfig = {
  baseRpcUrl: string;
  chainId: number;
  integratorAddress: Address;
  diamondAddress: Address;
  relayerPrivateKey: `0x${string}`;
  p2pRelayAddress: Address;
  p2pRelayPublicKey: string;
  p2pRelayPrivateKey: `0x${string}`;
};

type P2POrder = {
  status: number;
  pubkey: string;
};

function getChain(chainId: number) {
  return defineChain({
    id: chainId,
    name: chainId === 84532 ? "Base Sepolia" : "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: [] },
    },
  });
}

function getClients(config: P2POfframpConfig) {
  const chain = getChain(config.chainId);
  const transport = http(config.baseRpcUrl);
  const account = privateKeyToAccount(config.relayerPrivateKey);
  return {
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account, chain, transport }),
    account,
  };
}

export function solanaSignatureToBurnBytes32(signature: string): `0x${string}` {
  const decoded = bs58.decode(signature);
  return `0x${createHash("sha256").update(decoded).digest("hex")}`;
}

export function solanaPubkeyToBytes32(pubkey: string): `0x${string}` {
  return `0x${Buffer.from(new PublicKey(pubkey).toBytes()).toString("hex")}`;
}

export async function getOrderIdForBurn(params: {
  config: P2POfframpConfig;
  burnTx: `0x${string}`;
}): Promise<string | null> {
  const { publicClient } = getClients(params.config);
  const orderId = await publicClient.readContract({
    address: params.config.integratorAddress,
    abi: INTEGRATOR_ABI,
    functionName: "solanaBurnToOrderId",
    args: [params.burnTx],
  });
  return orderId === 0n ? null : orderId.toString();
}

export async function placeSellOrderForBurn(params: {
  config: P2POfframpConfig;
  signature: string;
  user: string;
  amount: string;
  currency: "INR" | "BRL" | "IDR";
  fiatAmount: string;
  circleId: number;
  preferredPaymentChannelConfigId: string;
}): Promise<{ orderId: string; txHash: Hash }> {
  const { publicClient, walletClient, account } = getClients(params.config);
  const burnTx = solanaSignatureToBurnBytes32(params.signature);
  const txHash = await walletClient.writeContract({
    address: params.config.integratorAddress,
    abi: INTEGRATOR_ABI,
    functionName: "placeSellOrderForBurn",
    args: [
      burnTx,
      solanaPubkeyToBytes32(params.user),
      BigInt(params.amount),
      stringToHex(params.currency, { size: 32 }),
      BigInt(params.fiatAmount),
      BigInt(params.circleId),
      BigInt(params.preferredPaymentChannelConfigId),
      params.config.p2pRelayPublicKey,
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
      if (decoded.eventName === "OfframpInitiated") {
        return {
          orderId: decoded.args.orderId.toString(),
          txHash,
        };
      }
    } catch {
      // Ignore unrelated logs in the receipt.
    }
  }

  const existingOrderId = await getOrderIdForBurn({
    config: params.config,
    burnTx,
  });
  if (!existingOrderId) {
    throw new Error("Offramp placement succeeded but order id was not found");
  }

  return { orderId: existingOrderId, txHash };
}

export async function getP2POrder(params: {
  config: P2POfframpConfig;
  orderId: string;
}): Promise<P2POrder> {
  const { publicClient } = getClients(params.config);
  const order = await publicClient.readContract({
    address: params.config.diamondAddress,
    abi: DIAMOND_ABI,
    functionName: "getOrdersById",
    args: [BigInt(params.orderId)],
  });

  return {
    status: Number(order.status),
    pubkey: order.pubkey,
  };
}

export async function encryptPayoutForMerchant(params: {
  config: P2POfframpConfig;
  paymentAddress: string;
  merchantPublicKey: string;
}): Promise<string> {
  const senderIdentity: RelayIdentity = {
    address: params.config.p2pRelayAddress,
    publicKey: params.config.p2pRelayPublicKey,
    privateKey: params.config.p2pRelayPrivateKey,
  };

  return encryptPaymentAddress({
    paymentAddress: params.paymentAddress,
    recipientPublicKey: params.merchantPublicKey,
    senderIdentity,
  }).match(
    (encrypted) => encrypted,
    (error) => {
      throw error;
    },
  );
}

export async function deliverOfframpUpi(params: {
  config: P2POfframpConfig;
  orderId: string;
  encryptedPayoutAddress: string;
}): Promise<Hash> {
  const { walletClient, account } = getClients(params.config);
  return walletClient.writeContract({
    address: params.config.integratorAddress,
    abi: INTEGRATOR_ABI,
    functionName: "deliverOfframpUpi",
    args: [BigInt(params.orderId), params.encryptedPayoutAddress],
    account,
  });
}

export async function reconcileOfframp(params: {
  config: P2POfframpConfig;
  orderId: string;
  status: number;
}): Promise<Hash> {
  const { walletClient, account } = getClients(params.config);
  return walletClient.writeContract({
    address: params.config.integratorAddress,
    abi: INTEGRATOR_ABI,
    functionName: "reconcile",
    args: [BigInt(params.orderId), params.status],
    account,
  });
}
