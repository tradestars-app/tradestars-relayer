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
    depositContractAddress:
      process.env.BASE_P2P_DEPOSIT_CONTRACT_ADDRESS?.toLowerCase() || null,
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

export function getRelayerAdminApiKey(): string {
  return requireEnv("RELAYER_ADMIN_API_KEY", process.env.RELAYER_ADMIN_API_KEY);
}
