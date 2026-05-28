export const KEY_PREFIX =
  process.env.TRADESTARS_REDIS_KEY_PREFIX ||
  (process.env.NODE_ENV === "production" ? "ts-relayer" : "ts-relayer-dev");

export const p2pDepositOperationKey = (txHash: string, logIndex: number) =>
  `${KEY_PREFIX}:p2p:deposit:${txHash.toLowerCase()}:${logIndex}`;

export const p2pDepositOperationsIndexKey = () =>
  `${KEY_PREFIX}:p2p:deposits:index`;

export const p2pDepositSubmissionKey = (orderId: string) =>
  `${KEY_PREFIX}:p2p:deposit-submission:${orderId}`;

export const p2pDepositSubmissionsIndexKey = () =>
  `${KEY_PREFIX}:p2p:deposit-submissions:index`;

function resolveAppKeyPrefix() {
  const explicitPrefix =
    process.env.TRADESTARS_APP_STORE_NAMESPACE?.trim() ||
    process.env.TRADESTARS_APP_REDIS_KEY_PREFIX?.trim();
  if (explicitPrefix) return explicitPrefix;

  return process.env.NODE_ENV === "production" ? "ts-app" : "ts-app-dev";
}

export const APP_KEY_PREFIX = resolveAppKeyPrefix();

export const appWithdrawalKey = (withdrawalId: string) =>
  `${APP_KEY_PREFIX}:withdrawal:${withdrawalId}`;

export const appWithdrawalNonceKey = (walletAddress: string, nonce: string) =>
  `${APP_KEY_PREFIX}:wallet:${walletAddress}:withdrawal:${nonce}`;
