import {
  decodeDepositLog,
  getWebhookLogs,
  type AlchemyWebhookPayload,
  verifyAlchemyWebhookSignature,
} from "@/lib/p2p/alchemy";
import { getP2PWebhookConfig } from "@/lib/p2p/config";
import { recordAndScheduleP2PDepositWorkflow } from "@/lib/p2p/deposit-processing";

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
  const logs = getWebhookLogs(payload);

  for (const log of logs) {
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

      await recordAndScheduleP2PDepositWorkflow(operation, {
        webhookEventId: payload.id,
        receivedMessage: "Alchemy webhook received and verified",
        workflowMessage: "Deposit workflow scheduled",
        failedMessage: "Failed to schedule deposit workflow",
      });

      scheduled += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to process Base deposit webhook log", {
        error: message,
        webhookEventId: payload.id,
        log,
      });
    }
  }

  const status = failed > 0 ? 500 : 200;
  console.info("Processed Base P2P deposit webhook", {
    webhookEventId: payload.id,
    logCount: logs.length,
    scheduled,
    ignored,
    failed,
  });
  if (scheduled === 0 && failed === 0 && logs.length > 0) {
    const firstLog = logs[0];
    console.warn("Base P2P deposit webhook contained no matching logs", {
      webhookEventId: payload.id,
      expectedTopic0: depositTopic0,
      expectedContractAddress: depositContractAddress,
      firstLogAddress: firstLog?.address,
      firstLogTopic0: firstLog?.topics?.[0],
    });
  }

  return Response.json(
    {
      scheduled,
      ignored,
      failed,
    },
    { status },
  );
}
