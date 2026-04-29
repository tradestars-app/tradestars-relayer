import { FatalError, sleep } from "workflow";
import {
  getP2PDepositWorkflowConfig,
  getP2PWebhookConfig,
} from "@/lib/p2p/config";
import {
  type P2PDepositWorkflowInput,
  verifySafeBaseDeposit,
} from "@/lib/p2p/base";

async function verifyBaseDeposit(input: P2PDepositWorkflowInput) {
  "use step";

  const { baseRpcUrl, expectedTopic0, expectedContractAddress } = {
    baseRpcUrl: getP2PDepositWorkflowConfig().baseRpcUrl,
    expectedTopic0: getP2PWebhookConfig().depositTopic0,
    expectedContractAddress: getP2PWebhookConfig().depositContractAddress,
  };

  return verifySafeBaseDeposit(input, {
    baseRpcUrl,
    expectedTopic0,
    expectedContractAddress,
  });
}

async function recordDepositStatus(
  input: P2PDepositWorkflowInput,
  status: {
    status:
      | "waiting_for_safe"
      | "safe_verified"
      | "minted"
      | "duplicate"
      | "invalid"
      | "failed";
    message: string;
    baseReceiptBlockNumber?: number;
    baseSafeBlockNumber?: number;
    solanaSignature?: string;
    lastError?: string;
  },
) {
  "use step";

  const { upsertP2PDepositOperation } = await import(
    "@/lib/store/p2p-deposit-ops-store"
  );

  await upsertP2PDepositOperation({
    orderId: input.orderId,
    wallet: input.wallet,
    amount: input.amount,
    txHash: input.txHash,
    logIndex: input.logIndex,
    ...status,
  });
}

async function mintSafeDeposit(input: P2PDepositWorkflowInput) {
  "use step";

  const [{ PublicKey }, { depositCollateral }] = await Promise.all([
    import("@solana/web3.js"),
    import("@/lib/solana/deposit-collateral"),
  ]);

  return depositCollateral({
    user: new PublicKey(input.wallet),
    amount: BigInt(input.amount),
    baseTxHashBytes: Array.from(Buffer.from(input.txHash.slice(2), "hex")),
    logIndex: input.logIndex,
  });
}

export async function processP2PDeposit(input: P2PDepositWorkflowInput) {
  "use workflow";

  const { safeRecheckDelaysSeconds } = getP2PDepositWorkflowConfig();

  const verifyAndMaybeMint = async () => {
    const verification = await verifyBaseDeposit(input);
    if (verification.status === "invalid") {
      await recordDepositStatus(input, {
        status: "invalid",
        message: "Base receipt verification failed",
        lastError: verification.reason,
      });
      throw new FatalError(verification.reason);
    }

    if (verification.status === "safe") {
      await recordDepositStatus(input, {
        status: "safe_verified",
        message: "Base deposit verified at safe block",
        baseReceiptBlockNumber: verification.receiptBlockNumber,
        baseSafeBlockNumber: verification.safeBlockNumber,
      });

      let mintResult: Awaited<ReturnType<typeof mintSafeDeposit>>;
      try {
        mintResult = await mintSafeDeposit(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordDepositStatus(input, {
          status: "failed",
          message: "Solana collateral mint failed",
          baseReceiptBlockNumber: verification.receiptBlockNumber,
          baseSafeBlockNumber: verification.safeBlockNumber,
          lastError: message,
        });
        throw error;
      }

      await recordDepositStatus(input, {
        status: mintResult.status,
        message:
          mintResult.status === "minted"
            ? "Solana collateral mint succeeded"
            : "Deposit was already minted on Solana",
        baseReceiptBlockNumber: verification.receiptBlockNumber,
        baseSafeBlockNumber: verification.safeBlockNumber,
        solanaSignature:
          mintResult.status === "minted" ? mintResult.signature : undefined,
      });
      return {
        ...mintResult,
        safeBlockNumber: verification.safeBlockNumber,
        receiptBlockNumber: verification.receiptBlockNumber,
      };
    }

    await recordDepositStatus(input, {
      status: "waiting_for_safe",
      message: verification.reason,
    });
    return null;
  };

  const immediateResult = await verifyAndMaybeMint();
  if (immediateResult) {
    return immediateResult;
  }

  for (const delaySeconds of safeRecheckDelaysSeconds) {
    await sleep(`${delaySeconds}s`);

    const result = await verifyAndMaybeMint();
    if (result) {
      return result;
    }
  }

  const timeoutMessage = `Timed out waiting for Base transaction ${input.txHash}#${input.logIndex} to become safe`;
  await recordDepositStatus(input, {
    status: "failed",
    message: timeoutMessage,
    lastError: timeoutMessage,
  });
  throw new Error(timeoutMessage);
}
