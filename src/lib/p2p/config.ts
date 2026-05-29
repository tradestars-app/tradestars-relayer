import { requireEnv } from "@/lib/env-utils";

export function getP2PDepositEventConfig() {
  return {
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

export function getP2PWebhookConfig() {
  return {
    signingKey: requireEnv(
      "ALCHEMY_P2P_WEBHOOK_SIGNING_KEY",
      process.env.ALCHEMY_P2P_WEBHOOK_SIGNING_KEY,
    ),
    ...getP2PDepositEventConfig(),
  };
}

export function getP2PWithdrawalWebhookConfig() {
  return {
    authorizationSecret: requireEnv(
      "HELIUS_WEBHOOK_SECRET",
      process.env.HELIUS_WEBHOOK_SECRET,
    ),
  };
}

export function getP2PDepositWorkflowConfig() {
  const baseFinality = process.env.BASE_P2P_DEPOSIT_FINALITY || "safe";
  if (baseFinality !== "safe" && baseFinality !== "receipt") {
    throw new Error("BASE_P2P_DEPOSIT_FINALITY must be safe or receipt");
  }
  const parsedBaseFinality: "safe" | "receipt" = baseFinality;

  return {
    baseRpcUrl: requireEnv("BASE_RPC_URL", process.env.BASE_RPC_URL),
    baseFinality: parsedBaseFinality,
    safeRecheckDelaysSeconds: (
      process.env.BASE_SAFE_RECHECK_DELAYS_SECONDS ||
      "3,5,8,10,10,10,10,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15"
    )
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value) && value >= 0),
  };
}

export function getP2PWithdrawalWorkflowConfig() {
  // Offramp v2 (allocate-only): the relayer only needs to call allocateOfframp.
  // The payout-encryption relay keys (P2P_OFFRAMP_RELAY_*) and the merchant /
  // terminal poll delays are gone — the user drives place / deliver / retry
  // from the widget and encrypts their payout address client-side.
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
  };
}

export function getRelayerAdminApiKey(): string {
  return requireEnv("RELAYER_ADMIN_API_KEY", process.env.RELAYER_ADMIN_API_KEY);
}
