import { timingSafeEqual } from "crypto";
import { start } from "workflow/api";
import {
  assertValidSolanaSignature,
  getWithdrawRequestedEvents,
} from "@/lib/p2p/withdrawal-events";
import { getP2PWithdrawalWebhookConfig } from "@/lib/p2p/config";
import { processP2PWithdrawal } from "@/workflows/p2p-withdrawal";

export const runtime = "nodejs";

function verifyHeliusAuthorization(
  authorizationHeader: string,
  expectedSecret: string,
): boolean {
  const receivedSecret = readAuthorizationSecret(authorizationHeader);
  if (!receivedSecret) return false;

  const received = Buffer.from(receivedSecret, "utf8");
  const target = Buffer.from(expectedSecret, "utf8");
  return received.length === target.length && timingSafeEqual(received, target);
}

function readAuthorizationSecret(authorizationHeader: string): string | null {
  const trimmed = authorizationHeader.trim();
  if (!trimmed) return null;

  const [scheme, ...rest] = trimmed.split(/\s+/);
  if (scheme.toLowerCase() === "bearer" && rest.length > 0) {
    return rest.join(" ");
  }

  return trimmed;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const authorizationHeader = request.headers.get("authorization") ?? "";
  const { authorizationSecret } = getP2PWithdrawalWebhookConfig();

  if (!verifyHeliusAuthorization(authorizationHeader, authorizationSecret)) {
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
