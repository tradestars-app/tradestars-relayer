import {
  getP2PDepositEventConfig,
  getP2PDepositWorkflowConfig,
  getRelayerAdminApiKey,
} from "@/lib/p2p/config";
import {
  BASE_NETWORK_CHAIN_IDS,
  parseBaseNetwork,
} from "@/lib/p2p/base-networks";
import {
  callBaseRpc,
  decodeBaseDepositLogsFromReceipt,
  type P2PDepositWorkflowInput,
} from "@/lib/p2p/base";
import { getP2PDepositOperation } from "@/lib/store/p2p-deposit-ops-store";
import { recordAndScheduleP2PDepositWorkflow } from "@/lib/p2p/deposit-processing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

function extractBearerToken(request: Request): string {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return "";
  return authHeader.slice(7).trim();
}

function parseLogIndex(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("logIndex must be a non-negative integer");
  }

  return value;
}

function selectOperation(
  matches: { input: P2PDepositWorkflowInput; receiptBlockNumber: number }[],
  logIndex?: number,
) {
  if (matches.length === 0) {
    throw new Error("No matching Base deposit logs found in transaction receipt");
  }

  if (logIndex !== undefined) {
    const match = matches.find(
      (candidate) => candidate.input.logIndex === logIndex,
    );
    if (!match) {
      throw new Error(
        `No matching Base deposit log found at log index ${logIndex}`,
      );
    }
    return match;
  }

  if (matches.length > 1) {
    throw new Error(
      `Found ${matches.length} matching Base deposit logs. Retry with logIndex.`,
    );
  }

  return matches[0];
}

async function assertRpcNetwork(baseRpcUrl: string, network: string) {
  const expectedChainId =
    BASE_NETWORK_CHAIN_IDS[parseBaseNetwork(network)].toLowerCase();
  const chainId = await callBaseRpc<string>(baseRpcUrl, "eth_chainId", []);

  if (chainId.toLowerCase() !== expectedChainId) {
    throw new Error(
      `Configured BASE_RPC_URL chainId mismatch: expected ${expectedChainId}, got ${chainId}`,
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const authToken = extractBearerToken(request);
  if (!authToken || authToken !== getRelayerAdminApiKey()) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  let body: {
    network?: unknown;
    txHash?: unknown;
    logIndex?: unknown;
    execute?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json(
      { error: "Invalid JSON payload" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const network = parseBaseNetwork(body.network);
    if (typeof body.txHash !== "string") {
      throw new Error("txHash is required");
    }

    const execute = body.execute === true;
    const logIndex = parseLogIndex(body.logIndex);
    const { baseRpcUrl } = getP2PDepositWorkflowConfig();
    const { depositTopic0, depositContractAddress } = getP2PDepositEventConfig();

    await assertRpcNetwork(baseRpcUrl, network);

    const matches = await decodeBaseDepositLogsFromReceipt(body.txHash, {
      baseRpcUrl,
      expectedTopic0: depositTopic0,
      expectedContractAddress: depositContractAddress,
    });
    const selected = selectOperation(matches, logIndex);
    const existing = await getP2PDepositOperation(
      selected.input.txHash,
      selected.input.logIndex,
    );

    const preview = {
      mode: execute ? "execute" : "dry-run",
      network,
      receiptBlockNumber: selected.receiptBlockNumber,
      matchCount: matches.length,
      selected: selected.input,
      existingOperation: existing
        ? {
            lookup: "found",
            status: existing.status,
            updatedAt: existing.updatedAt,
          }
        : {
            lookup: "not-found",
          },
    };

    if (!execute) {
      return Response.json(preview, { headers: NO_STORE_HEADERS });
    }

    const result = await recordAndScheduleP2PDepositWorkflow(selected.input, {
      receivedMessage: "Manual Base deposit replay requested from receipt",
      workflowMessage: "Deposit workflow scheduled by manual replay",
      failedMessage: "Manual replay failed to schedule deposit workflow",
    });

    return Response.json(
      {
        ...preview,
        scheduled: true,
        workflowRunId: result.workflowRunId,
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
