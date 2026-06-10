import { FatalError, sleep } from "workflow";
import type { P2POfframpConfig } from "@/lib/p2p/offramp";
import type { WithdrawalRecord } from "@/lib/store/p2p-withdrawal-store";

/**
 * Offramp (voucher-attested): the relayer's only job is to SIGN an EIP-712
 * `OfframpVoucher` off-chain and persist it on the withdrawal record — it
 * sends NO Base transaction. The end user's single Base tx
 * (`userRedeemAndStartOfframp`) redeems the voucher (vault → their proxy) and
 * places the SELL atomically; deliver-UPI / retry stay user-driven from the
 * widget. See OFFRAMP-V2.md.
 */

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
    chainId: config.chainId,
    integratorAddress: config.integratorAddress,
    diamondAddress: config.diamondAddress,
    relayerPrivateKey: config.relayerPrivateKey,
    voucherTtlSeconds: config.voucherTtlSeconds,
  };
}

function validateWithdrawalRecord(
  record: WithdrawalRecord,
  input: P2PWithdrawalWorkflowInput,
): void {
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
  // The voucher is bound to the user's Base EOA (voucher.user is the only
  // wallet that can redeem), so the product app must record it on the
  // withdrawal. The user enters their payout address in the widget and
  // encrypts it client-side, so the relayer never handles or stores it.
  if (!record.baseAddress) {
    throw new FatalError(
      "Withdrawal record missing baseAddress — the product app must record the " +
        "user's Base address; it becomes voucher.user, the only wallet that can redeem",
    );
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

async function signVoucher(
  record: WithdrawalRecord,
  input: P2PWithdrawalWorkflowInput,
) {
  "use step";

  const {
    signOfframpVoucher,
    getAllocationIdForBurn,
    solanaSignatureToBurnBytes32,
    isVoucherExpired,
  } = await import("@/lib/p2p/offramp");
  const { updateP2PWithdrawal } = await import(
    "@/lib/store/p2p-withdrawal-store"
  );
  const config = await getOfframpConfig();

  // Already redeemed on-chain? (burnToAllocation is the integrator's dedupe
  // map — non-zero means the user's redeem tx landed.) Terminal for us.
  const burnTx = solanaSignatureToBurnBytes32(input.signature);
  const redeemedAllocationId = await getAllocationIdForBurn({ config, burnTx });
  if (redeemedAllocationId) {
    return updateP2PWithdrawal(record, {
      status: "redeemed",
      baseAllocationId: redeemedAllocationId,
    });
  }

  // A live unexpired voucher is already on the record → idempotent no-op.
  // (An expired one falls through to a re-sign: same burn, fresh deadline —
  // harmless, the on-chain burn dedupe prevents double redemption.)
  if (
    record.status === "signed" &&
    record.voucher &&
    record.voucherSignature &&
    !isVoucherExpired(record.voucher)
  ) {
    return record;
  }

  const signing = await updateP2PWithdrawal(record, { status: "signing" });
  const { voucher, voucherSignature } = await signOfframpVoucher({
    config,
    baseAddress: signing.baseAddress as `0x${string}`,
    amount: input.amount,
    signature: input.signature,
    solanaUser: input.user,
  });

  return updateP2PWithdrawal(signing, {
    status: "signed",
    voucher,
    voucherSignature,
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

  // Terminal for the relayer: the user already redeemed the voucher on-chain.
  if (record.status === "redeemed") {
    return record;
  }

  try {
    // signVoucher is idempotent: keeps a live voucher, re-signs an expired
    // one, and flips to `redeemed` if the burn is already consumed on-chain.
    return await signVoucher(record, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failWithdrawal(record, message);
    throw error;
  }
}
