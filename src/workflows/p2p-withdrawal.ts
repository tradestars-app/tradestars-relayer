import { FatalError, sleep } from "workflow";
import type { P2POfframpConfig } from "@/lib/p2p/offramp";
import type { WithdrawalRecord } from "@/lib/store/p2p-withdrawal-store";

const P2P_ORDER_STATUS = {
  placed: 0,
  accepted: 1,
  paid: 2,
  completed: 3,
  cancelled: 4,
} as const;

const WITHDRAWAL_RECORD_LOOKUP_DELAYS_SECONDS = [1, 2, 3, 5, 8, 13] as const;

export type P2PWithdrawalWorkflowInput = {
  signature: string;
  user: string;
  amount: string;
  nonce: string;
};

async function getOfframpConfig(): Promise<P2POfframpConfig> {
  const { getP2PWithdrawalWorkflowConfig } = await import("@/lib/p2p/config");
  const config = getP2PWithdrawalWorkflowConfig();
  return {
    baseRpcUrl: config.baseRpcUrl,
    integratorAddress: config.integratorAddress,
    diamondAddress: config.diamondAddress,
    relayerPrivateKey: config.relayerPrivateKey,
    p2pRelayAddress: config.p2pRelayAddress,
    p2pRelayPublicKey: config.p2pRelayPublicKey,
    p2pRelayPrivateKey: config.p2pRelayPrivateKey,
  };
}

function validateWithdrawalRecord(
  record: WithdrawalRecord,
  input: P2PWithdrawalWorkflowInput,
): asserts record is WithdrawalRecord {
  if (record.payoutMethod !== "p2p") {
    throw new FatalError("Withdrawal is not a P2P cashout");
  }
  if (record.sourceWallet !== input.user) {
    throw new FatalError("Withdrawal wallet does not match Solana event");
  }
  if (String(record.amountRaw) !== input.amount) {
    throw new FatalError("Withdrawal amount does not match Solana event");
  }
  if (record.nonce !== input.nonce) {
    throw new FatalError("Withdrawal nonce does not match Solana event");
  }
  if (!record.payoutCurrency) {
    throw new FatalError("P2P withdrawal is missing payout currency");
  }
  if (!record.payoutAddressEncrypted) {
    throw new FatalError("P2P withdrawal is missing encrypted payout address");
  }
}

async function loadWithdrawal(input: P2PWithdrawalWorkflowInput) {
  "use step";

  const { getP2PWithdrawalForEvent } = await import(
    "@/lib/store/p2p-withdrawal-store"
  );
  const record = await getP2PWithdrawalForEvent({
    signature: input.signature,
    wallet: input.user,
    nonce: input.nonce,
  });
  if (!record) return null;

  validateWithdrawalRecord(record, input);
  return record;
}

async function failWithdrawal(record: WithdrawalRecord, reason: string) {
  "use step";

  const { updateP2PWithdrawal } = await import(
    "@/lib/store/p2p-withdrawal-store"
  );
  await updateP2PWithdrawal(record, {
    status: "failed",
    failureReason: reason,
  });
}

async function markStatus(
  record: WithdrawalRecord,
  update: Partial<Pick<WithdrawalRecord, "status" | "failureReason">>,
) {
  "use step";

  const { updateP2PWithdrawal } = await import(
    "@/lib/store/p2p-withdrawal-store"
  );
  return updateP2PWithdrawal(record, update);
}

async function ensureBaseOrder(
  record: WithdrawalRecord,
  input: P2PWithdrawalWorkflowInput,
) {
  "use step";

  const {
    getOrderIdForBurn,
    placeSellOrderForBurn,
    solanaSignatureToBurnBytes32,
  } = await import("@/lib/p2p/offramp");
  const { updateP2PWithdrawal } = await import(
    "@/lib/store/p2p-withdrawal-store"
  );
  const config = await getOfframpConfig();
  const existingOrderId =
    record.baseOrderId ??
    (await getOrderIdForBurn({
      config,
      burnTx: solanaSignatureToBurnBytes32(input.signature),
    }));
  if (existingOrderId) {
    return updateP2PWithdrawal(record, {
      status: "waiting_for_merchant",
      baseOrderId: existingOrderId,
      claimedAt: record.claimedAt ?? Date.now(),
    });
  }

  const placing = await updateP2PWithdrawal(record, {
    status: "placing_order",
    claimedAt: record.claimedAt ?? Date.now(),
  });
  const placed = await placeSellOrderForBurn({
    config,
    signature: input.signature,
    user: input.user,
    amount: input.amount,
    currency: placing.payoutCurrency!,
    fiatAmount: placing.fiatAmountRaw ?? "0",
    circleId: placing.circleId ?? 1,
    preferredPaymentChannelConfigId:
      placing.preferredPaymentChannelConfigId ?? "0",
  });

  return updateP2PWithdrawal(placing, {
    status: "waiting_for_merchant",
    baseOrderId: placed.orderId,
    basePlaceTx: placed.txHash,
  });
}

async function readOrderStatus(orderId: string) {
  "use step";

  const { getP2POrder } = await import("@/lib/p2p/offramp");
  return getP2POrder({
    config: await getOfframpConfig(),
    orderId,
  });
}

async function deliverPayoutDetails(record: WithdrawalRecord, merchantPubkey: string) {
  "use step";

  const { decryptP2PPayoutAddress } = await import(
    "@/lib/p2p/payout-encryption"
  );
  const {
    deliverOfframpUpi,
    encryptPayoutForMerchant,
  } = await import("@/lib/p2p/offramp");
  const { updateP2PWithdrawal } = await import(
    "@/lib/store/p2p-withdrawal-store"
  );
  const config = await getOfframpConfig();
  const payoutAddress = decryptP2PPayoutAddress(record.payoutAddressEncrypted!);
  const encryptedPayoutAddress = await encryptPayoutForMerchant({
    config,
    paymentAddress: payoutAddress,
    merchantPublicKey: merchantPubkey,
  });
  const txHash = await deliverOfframpUpi({
    config,
    orderId: record.baseOrderId!,
    encryptedPayoutAddress,
  });

  return updateP2PWithdrawal(record, {
    status: "waiting_for_fiat_payment",
    baseDeliverTx: txHash,
  });
}

async function reconcileTerminal(record: WithdrawalRecord, status: number) {
  "use step";

  const { reconcileOfframp } = await import("@/lib/p2p/offramp");
  const { updateP2PWithdrawal } = await import(
    "@/lib/store/p2p-withdrawal-store"
  );
  const txHash = await reconcileOfframp({
    config: await getOfframpConfig(),
    orderId: record.baseOrderId!,
    status,
  });
  return updateP2PWithdrawal(record, {
    status: status === P2P_ORDER_STATUS.completed ? "paid" : "cancelled",
    baseReconcileTx: txHash,
  });
}

export async function processP2PWithdrawal(input: P2PWithdrawalWorkflowInput) {
  "use workflow";

  let record = await loadWithdrawal(input);
  for (const delaySeconds of WITHDRAWAL_RECORD_LOOKUP_DELAYS_SECONDS) {
    if (record) break;
    await sleep(`${delaySeconds}s`);
    record = await loadWithdrawal(input);
  }
  if (!record) {
    throw new FatalError("No matching P2P withdrawal record found");
  }

  if (record.status === "paid" || record.status === "cancelled") {
    return record;
  }

  try {
    record = await ensureBaseOrder(record, input);

    const { getP2PWithdrawalWorkflowConfig } = await import(
      "@/lib/p2p/config"
    );
    const { merchantPollDelaysSeconds, terminalPollDelaysSeconds } =
      getP2PWithdrawalWorkflowConfig();

    let order = await readOrderStatus(record.baseOrderId!);
    if (order.status === P2P_ORDER_STATUS.cancelled) {
      return reconcileTerminal(record, order.status);
    }

    for (const delaySeconds of merchantPollDelaysSeconds) {
      if (order.status === P2P_ORDER_STATUS.accepted) break;
      await sleep(`${delaySeconds}s`);
      order = await readOrderStatus(record.baseOrderId!);
      if (order.status === P2P_ORDER_STATUS.cancelled) {
        return reconcileTerminal(record, order.status);
      }
    }

    if (order.status !== P2P_ORDER_STATUS.accepted) {
      throw new Error("Merchant did not accept the P2P sell order in time");
    }

    if (!record.baseDeliverTx) {
      if (!order.pubkey) {
        throw new Error("Accepted order is missing merchant public key");
      }
      record = await markStatus(record, {
        status: "delivering_payout_details",
      });
      record = await deliverPayoutDetails(record, order.pubkey);
    }

    order = await readOrderStatus(record.baseOrderId!);
    for (const delaySeconds of terminalPollDelaysSeconds) {
      if (
        order.status === P2P_ORDER_STATUS.completed ||
        order.status === P2P_ORDER_STATUS.cancelled
      ) {
        return reconcileTerminal(record, order.status);
      }
      await sleep(`${delaySeconds}s`);
      order = await readOrderStatus(record.baseOrderId!);
    }

    throw new Error("P2P sell order did not reach a terminal status in time");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failWithdrawal(record, message);
    throw error;
  }
}
