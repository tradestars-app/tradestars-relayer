import { getRelayerAdminApiKey } from "@/lib/p2p/config";
import { listRecentP2PDepositOperations } from "@/lib/store/p2p-deposit-ops-store";
import {
  listRecentP2PDepositSubmissions,
  upsertP2PDepositSubmission,
} from "@/lib/store/p2p-deposit-submissions-store";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

function extractBearerToken(request: Request): string {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return "";
  return authHeader.slice(7).trim();
}

function isAuthorized(request: Request): boolean {
  const authToken = extractBearerToken(request);
  return Boolean(authToken && authToken === getRelayerAdminApiKey());
}

function parseLimit(request: Request): number {
  const url = new URL(request.url);
  return Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "20") || 20, 1),
    100,
  );
}

function parseDepositSubmissionBody(body: unknown): {
  orderId: string;
  wallet: string;
  amount: string;
} {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid deposit submission");
  }

  const candidate = body as Record<string, unknown>;
  const orderId =
    typeof candidate.orderId === "string" ? candidate.orderId.trim() : "";
  const wallet =
    typeof candidate.wallet === "string" ? candidate.wallet.trim() : "";
  const amount =
    typeof candidate.amount === "string" ? candidate.amount.trim() : "";

  if (!orderId || orderId.length > 128) {
    throw new Error("Invalid orderId");
  }
  if (!wallet || wallet.length > 128) {
    throw new Error("Invalid wallet");
  }
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
    throw new Error("Invalid amount");
  }

  return { orderId, wallet, amount };
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const limit = parseLimit(request);
  const [operations, submissions] = await Promise.all([
    listRecentP2PDepositOperations(limit),
    listRecentP2PDepositSubmissions(limit),
  ]);
  return Response.json(
    { operations, submissions },
    { headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const input = parseDepositSubmissionBody(await request.json());
    const submission = await upsertP2PDepositSubmission(input);
    return Response.json({ submission }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid deposit submission";
    return Response.json(
      { error: message },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
}
