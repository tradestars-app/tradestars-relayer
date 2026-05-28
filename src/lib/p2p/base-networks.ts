export type BaseNetwork = "base-mainnet" | "base-sepolia";

export const BASE_NETWORK_CHAIN_IDS: Record<BaseNetwork, string> = {
  "base-mainnet": "0x2105",
  "base-sepolia": "0x14a34",
};

export function parseBaseNetwork(value: unknown): BaseNetwork {
  if (value === "base-mainnet" || value === "base-sepolia") {
    return value;
  }

  throw new Error("network must be base-mainnet or base-sepolia");
}

