import { FatalError, sleep } from "workflow";
import { getP2PWithdrawalWorkflowConfig } from "@/lib/p2p/config";
import { decryptP2PPayoutAddress } from "@/lib/p2p/payout-encryption";
import {
  deliverOfframpUpi,
  encryptPayoutForMerchant,
  getOrderIdForBurn,
  getP2POrder,
  P2P_ORDER_STATUS,
  placeSellOrderForBurn,
  reconcileOfframp,
  solanaSignatureToBurnBytes32,
  type P2POfframpConfig,
} from "@/lib/p2p/offramp";
import {
  getP2PWithdrawalForEvent,
  updateP2PWithdrawal,
  type WithdrawalRecord,
} from "@/lib/store/p2p-withdrawal-store";

export type P2PWithdrawalWorkflowInput = {
  signature: string;
  user: string;
  amount: string;
  nonce: string;
};

function getOfframpConfig(): P2POfframpConfig {
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
  record: WithdrawalRecord | null,
  input: P2PWithdrawalWorkflowInput,
): asserts record is WithdrawalRecord {
  if (!record) {
    throw new FatalError("No matching P2P withdrawal record found");
  }
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

  const record = await getP2PWithdrawalForEvent({
    signature: input.signature,
    wallet: input.user,
    nonce: input.nonce,
  });
  validateWithdrawalRecord(record, input);
  return record;
}

async function failWithdrawal(record: WithdrawalRecord, reason: string) {
  "use step";

  await updateP2PWithdrawal(record, {
    status: "failed",
    failureReason: reason,
  });
}

async function markStatus(
  record: WithdrawalRecord,
  update: Parameters<typeof updateP2PWithdrawal>[1],
) {
  "use step";

  return updateP2PWithdrawal(record, update);
}

async function ensureBaseOrder(
  record: WithdrawalRecord,
  input: P2PWithdrawalWorkflowInput,
) {
  "use step";

  const config = getOfframpConfig();
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

  return getP2POrder({
    config: getOfframpConfig(),
    orderId,
  });
}

async function deliverPayoutDetails(record: WithdrawalRecord, merchantPubkey: string) {
  "use step";

  const config = getOfframpConfig();
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

  const txHash = await reconcileOfframp({
    config: getOfframpConfig(),
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
  if (record.status === "paid" || record.status === "cancelled") {
    return record;
  }

  try {
    record = await ensureBaseOrder(record, input);

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
