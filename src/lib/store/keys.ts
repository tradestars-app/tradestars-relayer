export const KEY_PREFIX =
  process.env.TRADESTARS_REDIS_KEY_PREFIX ||
  (process.env.NODE_ENV === "production" ? "ts-relayer" : "ts-relayer-dev");

export const p2pDepositOperationKey = (txHash: string, logIndex: number) =>
  `${KEY_PREFIX}:p2p:deposit:${txHash.toLowerCase()}:${logIndex}`;

export const p2pDepositOperationsIndexKey = () =>
  `${KEY_PREFIX}:p2p:deposits:index`;
