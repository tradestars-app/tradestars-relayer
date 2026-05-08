import { start } from "workflow/api";
import {
  assertValidSolanaSignature,
  getWithdrawRequestedEvents,
} from "@/lib/p2p/withdrawal-events";
import { verifyAlchemyWebhookSignature } from "@/lib/p2p/alchemy";
import { getP2PWithdrawalWebhookConfig } from "@/lib/p2p/config";
import { processP2PWithdrawal } from "@/workflows/p2p-withdrawal";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-alchemy-signature") ?? "";
  const { signingKey } = getP2PWithdrawalWebhookConfig();

  if (!verifyAlchemyWebhookSignature(rawBody, signatureHeader, signingKey)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON payload", { status: 400 });
  }

  let scheduled = 0;
  let ignored = 0;
  let failed = 0;

  for (const event of getWithdrawRequestedEvents(payload)) {
    try {
      assertValidSolanaSignature(event.signature);
      await start(processP2PWithdrawal, [
        {
          signature: event.signature,
          user: event.user,
          amount: event.amount,
          nonce: event.nonce,
        },
      ]);
      scheduled += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to schedule P2P withdrawal workflow", {
        error: message,
        event,
      });
    }
  }

  ignored = scheduled === 0 && failed === 0 ? 1 : 0;

  return Response.json(
    {
      scheduled,
      ignored,
      failed,
    },
    { status: failed > 0 ? 500 : 200 },
  );
}
