import { beforeEach, describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";

import { POST } from "@/app/api/admin/withdrawals/replay/route";
import { getP2PWithdrawalForEvent } from "@/lib/store/p2p-withdrawal-store";

vi.mock("workflow/api", () => ({
  start: vi.fn(),
}));

vi.mock("@/lib/store/p2p-withdrawal-store", () => ({
  getP2PWithdrawalForEvent: vi.fn(),
}));

const withdrawalInput = {
  signature:
    "4asQniCBpdsa9giMFRxYVT1n6J3usATpns4tL3VwMABE9xXrafBrLviz2CteP1R6r5Ncstahw2EXJtXEbU3Bb4ta",
  user: "4i9vctcamCzMqELVQ7XABRBch69rpTyEniuduPocoHXy",
  amount: "5000000",
  nonce: "1",
};

const withdrawalRecord = {
  id: withdrawalInput.signature,
  userId: "did:privy:user",
  sourceWallet: withdrawalInput.user,
  payoutMethod: "p2p",
  payoutCurrency: "INR",
  amountRaw: 5000000,
  nonce: withdrawalInput.nonce,
  signature: withdrawalInput.signature,
  status: "failed",
  createdAt: 1,
  updatedAt: 2,
};

describe("POST /api/admin/withdrawals/replay", () => {
  const mockedStart = vi.mocked(start);
  const mockedGetWithdrawal = vi.mocked(getP2PWithdrawalForEvent);

  beforeEach(() => {
    process.env.RELAYER_ADMIN_API_KEY = "relayer-secret";
    vi.clearAllMocks();
  });

  it("rejects missing admin api key", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/withdrawals/replay", {
        method: "POST",
        body: JSON.stringify(withdrawalInput),
      }),
    );

    expect(response.status).toBe(401);
    expect(mockedGetWithdrawal).not.toHaveBeenCalled();
  });

  it("dry-runs a matching withdrawal without scheduling", async () => {
    mockedGetWithdrawal.mockResolvedValueOnce(withdrawalRecord as never);

    const response = await POST(
      new Request("http://localhost/api/admin/withdrawals/replay", {
        method: "POST",
        headers: {
          Authorization: "Bearer relayer-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(withdrawalInput),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockedGetWithdrawal).toHaveBeenCalledWith({
      signature: withdrawalInput.signature,
      wallet: withdrawalInput.user,
      nonce: withdrawalInput.nonce,
    });
    expect(mockedStart).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      mode: "dry-run",
      selected: withdrawalInput,
      existingWithdrawal: {
        status: "failed",
      },
    });
  });

  it("schedules the withdrawal workflow when execute is true", async () => {
    mockedGetWithdrawal.mockResolvedValueOnce(withdrawalRecord as never);
    mockedStart.mockResolvedValueOnce({ workflowRunId: "run_123" } as never);

    const response = await POST(
      new Request("http://localhost/api/admin/withdrawals/replay", {
        method: "POST",
        headers: {
          Authorization: "Bearer relayer-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...withdrawalInput,
          execute: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockedStart).toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      mode: "execute",
      scheduled: true,
      workflowRunId: "run_123",
    });
  });
});
