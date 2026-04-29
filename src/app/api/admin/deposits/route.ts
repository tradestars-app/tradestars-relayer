import { getRelayerAdminApiKey } from "@/lib/p2p/config";
import { listRecentP2PDepositOperations } from "@/lib/store/p2p-deposit-ops-store";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

function extractBearerToken(request: Request): string {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return "";
  return authHeader.slice(7).trim();
}

export async function GET(request: Request): Promise<Response> {
  const authToken = extractBearerToken(request);
  if (!authToken || authToken !== getRelayerAdminApiKey()) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "20") || 20, 1),
    100,
  );
  const operations = await listRecentP2PDepositOperations(limit);
  return Response.json({ operations }, { headers: NO_STORE_HEADERS });
}
