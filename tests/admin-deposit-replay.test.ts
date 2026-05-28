import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/deposits/replay/route";
import {
  callBaseRpc,
  decodeBaseDepositLogsFromReceipt,
} from "@/lib/p2p/base";
import { getP2PDepositOperation } from "@/lib/store/p2p-deposit-ops-store";
import { recordAndScheduleP2PDepositWorkflow } from "@/lib/p2p/deposit-processing";

vi.mock("@/lib/p2p/base", () => ({
  callBaseRpc: vi.fn(),
  decodeBaseDepositLogsFromReceipt: vi.fn(),
}));

vi.mock("@/lib/store/p2p-deposit-ops-store", () => ({
  getP2PDepositOperation: vi.fn(),
}));

vi.mock("@/lib/p2p/deposit-processing", () => ({
  recordAndScheduleP2PDepositWorkflow: vi.fn(),
}));

const operation = {
  orderId: "42",
  wallet: "5J7a1Qf7kbbfCkyw8vZczvCN4F7w4KPgsLo2w74H5hWQ",
  amount: "10000000",
  txHash: `0x${"12".repeat(32)}`,
  logIndex: 7,
};

describe("POST /api/admin/deposits/replay", () => {
  const mockedCallBaseRpc = vi.mocked(callBaseRpc);
  const mockedDecodeReceipt = vi.mocked(decodeBaseDepositLogsFromReceipt);
  const mockedGetOperation = vi.mocked(getP2PDepositOperation);
  const mockedSchedule = vi.mocked(recordAndScheduleP2PDepositWorkflow);

  beforeEach(() => {
    process.env.RELAYER_ADMIN_API_KEY = "relayer-secret";
    process.env.BASE_RPC_URL = "https://base.example";
    process.env.ALCHEMY_P2P_DEPOSIT_TOPIC0 = `0x${"ab".repeat(32)}`;
    process.env.BASE_P2P_INTEGRATOR_ADDRESS = "0xabc123";
    vi.clearAllMocks();
  });

  it("rejects missing admin api key", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/deposits/replay", {
        method: "POST",
        body: JSON.stringify({
          network: "base-sepolia",
          txHash: operation.txHash,
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mockedDecodeReceipt).not.toHaveBeenCalled();
  });

  it("decodes a dry-run replay without scheduling the workflow", async () => {
    mockedCallBaseRpc.mockResolvedValueOnce("0x14a34");
    mockedDecodeReceipt.mockResolvedValueOnce([
      {
        receiptBlockNumber: 100,
        input: operation,
      },
    ]);
    mockedGetOperation.mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/admin/deposits/replay", {
        method: "POST",
        headers: {
          Authorization: "Bearer relayer-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          network: "base-sepolia",
          txHash: operation.txHash,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockedDecodeReceipt).toHaveBeenCalledWith(operation.txHash, {
      baseRpcUrl: "https://base.example",
      expectedTopic0: process.env.ALCHEMY_P2P_DEPOSIT_TOPIC0,
      expectedContractAddress: process.env.BASE_P2P_INTEGRATOR_ADDRESS,
    });
    expect(mockedSchedule).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      mode: "dry-run",
      network: "base-sepolia",
      selected: operation,
      existingOperation: {
        lookup: "not-found",
      },
    });
  });

  it("schedules the deployed workflow when execute is true", async () => {
    mockedCallBaseRpc.mockResolvedValueOnce("0x14a34");
    mockedDecodeReceipt.mockResolvedValueOnce([
      {
        receiptBlockNumber: 100,
        input: operation,
      },
    ]);
    mockedGetOperation.mockResolvedValueOnce(null);
    mockedSchedule.mockResolvedValueOnce({ workflowRunId: "run_123" });

    const response = await POST(
      new Request("http://localhost/api/admin/deposits/replay", {
        method: "POST",
        headers: {
          Authorization: "Bearer relayer-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          network: "base-sepolia",
          txHash: operation.txHash,
          execute: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockedSchedule).toHaveBeenCalledWith(operation, {
      receivedMessage: "Manual Base deposit replay requested from receipt",
      workflowMessage: "Deposit workflow scheduled by manual replay",
      failedMessage: "Manual replay failed to schedule deposit workflow",
    });
    expect(await response.json()).toMatchObject({
      mode: "execute",
      scheduled: true,
      workflowRunId: "run_123",
    });
  });
});
