import {
  decodeDepositLog,
  getWebhookLogs,
  type AlchemyWebhookPayload,
  verifyAlchemyWebhookSignature,
} from "@/lib/p2p/alchemy";
import { getP2PWebhookConfig } from "@/lib/p2p/config";
import { upsertP2PDepositOperation } from "@/lib/store/p2p-deposit-ops-store";
import { start } from "workflow/api";
import { processP2PDeposit } from "@/workflows/p2p-deposit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-alchemy-signature") ?? "";
  const { signingKey, depositTopic0, depositContractAddress } =
    getP2PWebhookConfig();

  if (!verifyAlchemyWebhookSignature(rawBody, signatureHeader, signingKey)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: AlchemyWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as AlchemyWebhookPayload;
  } catch {
    return new Response("Invalid JSON payload", { status: 400 });
  }

  let scheduled = 0;
  let ignored = 0;
  let failed = 0;

  for (const log of getWebhookLogs(payload)) {
    let operation:
      | {
          orderId: string;
          wallet: string;
          amount: string;
          txHash: string;
          logIndex: number;
        }
      | undefined;

    try {
      const decoded = decodeDepositLog(
        log,
        depositTopic0,
        depositContractAddress,
      );
      if (!decoded) {
        ignored += 1;
        continue;
      }

      operation = {
        orderId: decoded.orderId,
        wallet: decoded.user.toBase58(),
        amount: decoded.amount.toString(),
        txHash: decoded.baseTxHash,
        logIndex: decoded.logIndex,
      };

      await upsertP2PDepositOperation({
        ...operation,
        webhookEventId: payload.id,
        status: "webhook_received",
        message: "Alchemy webhook received and verified",
      });

      const run = await start(processP2PDeposit, [{ ...operation }]);

      await upsertP2PDepositOperation({
        ...operation,
        webhookEventId: payload.id,
        workflowRunId:
          typeof run === "object" && run !== null && "id" in run
            ? String((run as { id: string }).id)
            : undefined,
        status: "workflow_started",
        message: "Deposit workflow scheduled",
      });

      scheduled += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);

      if (operation) {
        await upsertP2PDepositOperation({
          ...operation,
          webhookEventId: payload.id,
          status: "failed",
          lastError: message,
          message: "Failed to schedule deposit workflow",
        });
      }

      console.error("Failed to process Base deposit webhook log", {
        error: message,
        webhookEventId: payload.id,
        log,
      });
    }
  }

  const status = failed > 0 ? 500 : 200;
  return Response.json(
    {
      scheduled,
      ignored,
      failed,
    },
    { status },
  );
}
