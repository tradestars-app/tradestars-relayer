import { start } from "workflow/api";

import { getRelayerAdminApiKey } from "@/lib/p2p/config";
import { assertValidSolanaSignature } from "@/lib/p2p/withdrawal-events";
import { getP2PWithdrawalForEvent } from "@/lib/store/p2p-withdrawal-store";
import { processP2PWithdrawal } from "@/workflows/p2p-withdrawal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

type ReplayInput = {
  signature: string;
  user: string;
  amount: string;
  nonce: string;
};

function extractBearerToken(request: Request): string {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return "";
  return authHeader.slice(7).trim();
}

function parseStringField(
  body: Record<string, unknown>,
  field: keyof ReplayInput,
): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function parseBody(body: unknown): ReplayInput & { execute: boolean } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid replay payload");
  }

  const candidate = body as Record<string, unknown>;
  const input = {
    signature: parseStringField(candidate, "signature"),
    user: parseStringField(candidate, "user"),
    amount: parseStringField(candidate, "amount"),
    nonce: parseStringField(candidate, "nonce"),
  };

  assertValidSolanaSignature(input.signature);
  if (!/^\d+$/.test(input.amount) || BigInt(input.amount) <= 0n) {
    throw new Error("amount must be a positive integer string");
  }
  if (!/^\d+$/.test(input.nonce)) {
    throw new Error("nonce must be an integer string");
  }

  return {
    ...input,
    execute: candidate.execute === true,
  };
}

export async function POST(request: Request): Promise<Response> {
  const authToken = extractBearerToken(request);
  if (!authToken || authToken !== getRelayerAdminApiKey()) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const parsed = parseBody(await request.json());
    const record = await getP2PWithdrawalForEvent({
      signature: parsed.signature,
      wallet: parsed.user,
      nonce: parsed.nonce,
    });
    if (!record) {
      throw new Error("No matching P2P withdrawal record found");
    }
    if (record.payoutMethod !== "p2p") {
      throw new Error("Withdrawal is not a P2P cashout");
    }
    if (record.sourceWallet !== parsed.user) {
      throw new Error("Withdrawal wallet does not match replay input");
    }
    if (String(record.amountRaw) !== parsed.amount) {
      throw new Error("Withdrawal amount does not match replay input");
    }
    if (record.nonce !== parsed.nonce) {
      throw new Error("Withdrawal nonce does not match replay input");
    }

    const preview = {
      mode: parsed.execute ? "execute" : "dry-run",
      selected: {
        signature: parsed.signature,
        user: parsed.user,
        amount: parsed.amount,
        nonce: parsed.nonce,
      },
      existingWithdrawal: {
        status: record.status,
        baseAllocationId: record.baseAllocationId,
        baseAllocationTx: record.baseAllocationTx,
        failureReason: record.failureReason,
        updatedAt: record.updatedAt,
      },
    };

    if (!parsed.execute) {
      return Response.json(preview, { headers: NO_STORE_HEADERS });
    }

    const run = await start(processP2PWithdrawal, [
      {
        signature: parsed.signature,
        user: parsed.user,
        amount: parsed.amount,
        nonce: parsed.nonce,
      },
    ]);

    return Response.json(
      {
        ...preview,
        scheduled: true,
        workflowRunId:
          typeof run === "object" && run && "workflowRunId" in run
            ? run.workflowRunId
            : undefined,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
