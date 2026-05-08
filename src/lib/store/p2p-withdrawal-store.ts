import { getRedis } from "@/store/upstash";
import {
  appWithdrawalKey,
  appWithdrawalNonceKey,
} from "@/lib/store/keys";

export type WithdrawalPayoutMethod = "solana_wallet" | "p2p";
export type WithdrawalPayoutCurrency = "INR" | "BRL" | "IDR";
export type WithdrawalStatus =
  | "submitted"
  | "pending_relayer"
  | "placing_order"
  | "waiting_for_merchant"
  | "delivering_payout_details"
  | "waiting_for_fiat_payment"
  | "processing"
  | "paid"
  | "cancelled"
  | "failed";

export type WithdrawalRecord = {
  id: string;
  userId: string;
  sourceWallet: string;
  destinationWallet?: string;
  payoutMethod: WithdrawalPayoutMethod;
  payoutCurrency?: WithdrawalPayoutCurrency;
  payoutAddressEncrypted?: string;
  payoutAddressPreview?: string;
  fiatAmountRaw?: string;
  circleId?: number;
  preferredPaymentChannelConfigId?: string;
  baseOrderId?: string;
  basePlaceTx?: string;
  baseDeliverTx?: string;
  baseReconcileTx?: string;
  failureReason?: string;
  claimedAt?: number;
  amountRaw: number;
  nonce: string;
  signature: string;
  status: WithdrawalStatus;
  createdAt: number;
  updatedAt: number;
};

export type WithdrawalUpdate = Partial<
  Pick<
    WithdrawalRecord,
    | "status"
    | "baseOrderId"
    | "basePlaceTx"
    | "baseDeliverTx"
    | "baseReconcileTx"
    | "failureReason"
    | "claimedAt"
  >
>;

export async function getWithdrawalBySignature(
  signature: string,
): Promise<WithdrawalRecord | null> {
  const redis = getRedis();
  return (await redis.get<WithdrawalRecord>(appWithdrawalKey(signature))) ?? null;
}

export async function getWithdrawalByWalletNonce(params: {
  wallet: string;
  nonce: string;
}): Promise<WithdrawalRecord | null> {
  const redis = getRedis();
  const id = await redis.get<string>(
    appWithdrawalNonceKey(params.wallet, params.nonce),
  );
  if (!id) return null;
  return (await redis.get<WithdrawalRecord>(appWithdrawalKey(id))) ?? null;
}

export async function getP2PWithdrawalForEvent(params: {
  signature: string;
  wallet: string;
  nonce: string;
}): Promise<WithdrawalRecord | null> {
  return (
    (await getWithdrawalBySignature(params.signature)) ??
    (await getWithdrawalByWalletNonce({
      wallet: params.wallet,
      nonce: params.nonce,
    }))
  );
}

export async function updateP2PWithdrawal(
  record: WithdrawalRecord,
  update: WithdrawalUpdate,
): Promise<WithdrawalRecord> {
  const redis = getRedis();
  const next: WithdrawalRecord = {
    ...record,
    ...update,
    updatedAt: Date.now(),
  };

  const pipeline = redis.pipeline();
  pipeline.set(appWithdrawalKey(next.id), next);
  pipeline.set(appWithdrawalKey(next.signature), next);
  pipeline.set(appWithdrawalNonceKey(next.sourceWallet, next.nonce), next.id);
  await pipeline.exec();

  return next;
}
