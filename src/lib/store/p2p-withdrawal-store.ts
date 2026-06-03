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
  // Offramp v2 (allocate-only): the relayer moves vault USDC into the user's
  // proxy, then the user drives the SELL from the widget.
  | "allocating"
  | "allocated"
  // Legacy (relayer-driven offramp v1) — retained for back-compat with old records.
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
  payoutAddressPreview?: string;
  fiatAmountRaw?: string;
  circleId?: number;
  preferredPaymentChannelConfigId?: string;
  /** User's Base EOA (proxy owner) — the allocation target. Product app must set it. */
  baseAddress?: string;
  /** Offramp v2 allocation id from the integrator's OfframpAllocated event. */
  baseAllocationId?: string;
  /** Tx hash of the allocateOfframp call. */
  baseAllocationTx?: string;
  baseOrderId?: string;
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
    | "baseAddress"
    | "baseAllocationId"
    | "baseAllocationTx"
    | "baseOrderId"
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
