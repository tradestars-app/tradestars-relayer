import { FatalError, sleep } from "workflow";
import type { P2POfframpConfig } from "@/lib/p2p/offramp";
import type { WithdrawalRecord } from "@/lib/store/p2p-withdrawal-store";

/**
 * Offramp v2: the relayer's only job is a one-time on-chain allocation
 * (`allocateOfframp`) that moves vault USDC into the user's per-user proxy.
 * The end user drives the SELL (place / deliver UPI / retry) from the widget,
 * so this workflow no longer places orders, polls merchant/terminal status,
 * encrypts payout addresses, or reconciles. See OFFRAMP-V2.md.
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
    integratorAddress: config.integratorAddress,
    diamondAddress: config.diamondAddress,
    relayerPrivateKey: config.relayerPrivateKey,
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
  // Offramp v2 allocates to the user's Base proxy, so the product app must
  // record the user's Base EOA on the withdrawal. The user enters their payout
  // address in the widget (and encrypts it client-side), so we no longer need
  // payoutCurrency / payoutAddressEncrypted here.
  if (!record.baseAddress) {
    throw new FatalError(
      "Withdrawal record missing baseAddress — the product app must record the " +
        "user's Base address so the relayer can allocate to their proxy",
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

async function allocate(
  record: WithdrawalRecord,
  input: P2PWithdrawalWorkflowInput,
) {
  "use step";

  const { allocateOfframp, getAllocationIdForBurn, solanaSignatureToBurnBytes32 } =
    await import("@/lib/p2p/offramp");
  const { updateP2PWithdrawal } = await import(
    "@/lib/store/p2p-withdrawal-store"
  );
  const config = await getOfframpConfig();

  // Idempotent: if this burn was already allocated on-chain (or recorded),
  // resume that allocation instead of allocating again.
  const burnTx = solanaSignatureToBurnBytes32(input.signature);
  const existing =
    record.baseAllocationId ?? (await getAllocationIdForBurn({ config, burnTx }));
  if (existing) {
    return updateP2PWithdrawal(record, {
      status: "allocated",
      baseAllocationId: existing,
    });
  }

  const allocating = await updateP2PWithdrawal(record, { status: "allocating" });
  const result = await allocateOfframp({
    config,
    baseAddress: allocating.baseAddress as `0x${string}`,
    amount: input.amount,
    signature: input.signature,
    solanaUser: input.user,
  });

  return updateP2PWithdrawal(allocating, {
    status: "allocated",
    baseAllocationId: result.allocationId,
    baseAllocationTx: result.txHash,
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

  // Already allocated → nothing more for the relayer to do; the user drives
  // the rest from the widget.
  if (record.status === "allocated") {
    return record;
  }

  try {
    return await allocate(record, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failWithdrawal(record, message);
    throw error;
  }
}
