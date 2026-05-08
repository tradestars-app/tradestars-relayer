import { requireEnv } from "@/lib/env-utils";

export function getP2PWebhookConfig() {
  return {
    signingKey: requireEnv(
      "ALCHEMY_P2P_WEBHOOK_SIGNING_KEY",
      process.env.ALCHEMY_P2P_WEBHOOK_SIGNING_KEY,
    ),
    depositTopic0: requireEnv(
      "ALCHEMY_P2P_DEPOSIT_TOPIC0",
      process.env.ALCHEMY_P2P_DEPOSIT_TOPIC0,
    ).toLowerCase(),
    depositContractAddress: requireEnv(
      "BASE_P2P_INTEGRATOR_ADDRESS",
      process.env.BASE_P2P_INTEGRATOR_ADDRESS,
    ).toLowerCase(),
  };
}

export function getP2PWithdrawalWebhookConfig() {
  return {
    signingKey: requireEnv(
      "ALCHEMY_SOLANA_WITHDRAWAL_WEBHOOK_SIGNING_KEY",
      process.env.ALCHEMY_SOLANA_WITHDRAWAL_WEBHOOK_SIGNING_KEY,
    ),
  };
}

export function getP2PDepositWorkflowConfig() {
  return {
    baseRpcUrl: requireEnv("BASE_RPC_URL", process.env.BASE_RPC_URL),
    safeRecheckDelaysSeconds: (
      process.env.BASE_SAFE_RECHECK_DELAYS_SECONDS || "15,30,60,120"
    )
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value >= 0),
  };
}

export function getP2PWithdrawalWorkflowConfig() {
  return {
    baseRpcUrl: requireEnv("BASE_RPC_URL", process.env.BASE_RPC_URL),
    integratorAddress: requireEnv(
      "BASE_P2P_INTEGRATOR_ADDRESS",
      process.env.BASE_P2P_INTEGRATOR_ADDRESS,
    ) as `0x${string}`,
    diamondAddress: requireEnv(
      "BASE_P2P_DIAMOND_ADDRESS",
      process.env.BASE_P2P_DIAMOND_ADDRESS,
    ) as `0x${string}`,
    relayerPrivateKey: requireEnv(
      "BASE_OFFRAMP_RELAYER_PRIVATE_KEY",
      process.env.BASE_OFFRAMP_RELAYER_PRIVATE_KEY,
    ) as `0x${string}`,
    p2pRelayAddress: requireEnv(
      "P2P_OFFRAMP_RELAY_ADDRESS",
      process.env.P2P_OFFRAMP_RELAY_ADDRESS,
    ) as `0x${string}`,
    p2pRelayPublicKey: requireEnv(
      "P2P_OFFRAMP_RELAY_PUBLIC_KEY",
      process.env.P2P_OFFRAMP_RELAY_PUBLIC_KEY,
    ),
    p2pRelayPrivateKey: requireEnv(
      "P2P_OFFRAMP_RELAY_PRIVATE_KEY",
      process.env.P2P_OFFRAMP_RELAY_PRIVATE_KEY,
    ) as `0x${string}`,
    merchantPollDelaysSeconds: (
      process.env.P2P_OFFRAMP_MERCHANT_POLL_DELAYS_SECONDS ||
      "15,30,60,120,240,300"
    )
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value >= 0),
    terminalPollDelaysSeconds: (
      process.env.P2P_OFFRAMP_TERMINAL_POLL_DELAYS_SECONDS ||
      "30,60,120,240,300,300,300,300"
    )
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value >= 0),
  };
}

export function getRelayerAdminApiKey(): string {
  return requireEnv("RELAYER_ADMIN_API_KEY", process.env.RELAYER_ADMIN_API_KEY);
}
