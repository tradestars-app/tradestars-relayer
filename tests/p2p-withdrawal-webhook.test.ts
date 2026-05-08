import crypto from "crypto";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeWithdrawRequestedEventForTest,
  getWithdrawRequestedEvents,
} from "@/lib/p2p/withdrawal-events";
import { POST } from "@/app/api/webhooks/p2p-withdrawals/route";
import { start } from "workflow/api";

vi.mock("workflow/api", () => ({
  start: vi.fn(),
}));

const user = new PublicKey("5J7a1Qf7kbbfCkyw8vZczvCN4F7w4KPgsLo2w74H5hWQ");

function createSignature() {
  return bs58.encode(Buffer.alloc(64, 7));
}

function createPayload() {
  return {
    webhookId: "wh_solana",
    id: "whevt_withdrawal",
    event: {
      data: {
        block: {
          transactions: [
            {
              transaction: {
                signatures: [createSignature()],
              },
              meta: {
                logMessages: [
                  "Program log: Instruction: WithdrawRequest",
                  `Program data: ${encodeWithdrawRequestedEventForTest({
                    user: user.toBase58(),
                    amount: 25_000_000n,
                    nonce: 3n,
                    remainingTotalBalance: 100_000_000n,
                    availableToWithdraw: 75_000_000n,
                    timestamp: 1_778_200_000n,
                  })}`,
                ],
              },
            },
          ],
        },
      },
    },
  };
}

function signBody(body: string): string {
  return crypto
    .createHmac(
      "sha256",
      process.env.ALCHEMY_SOLANA_WITHDRAWAL_WEBHOOK_SIGNING_KEY!,
    )
    .update(Buffer.from(body, "utf8"))
    .digest("hex");
}

describe("p2p withdrawal webhook helpers", () => {
  beforeEach(() => {
    process.env.ALCHEMY_SOLANA_WITHDRAWAL_WEBHOOK_SIGNING_KEY =
      "alchemy-solana-secret";
    vi.clearAllMocks();
  });

  it("decodes Anchor WithdrawRequested events from Solana logs", () => {
    const events = getWithdrawRequestedEvents(createPayload());

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      user: user.toBase58(),
      amount: "25000000",
      nonce: "3",
      remainingTotalBalance: "100000000",
      availableToWithdraw: "75000000",
      timestamp: "1778200000",
    });
  });

  it("schedules a withdrawal workflow for valid signed webhooks", async () => {
    const mockedStart = vi.mocked(start);
    mockedStart.mockResolvedValueOnce({ id: "run_withdrawal" } as never);

    const body = JSON.stringify(createPayload());
    const response = await POST(
      new Request("http://localhost/api/webhooks/p2p-withdrawals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-alchemy-signature": signBody(body),
        },
        body,
      }),
    );

    expect(response.status).toBe(200);
    expect(mockedStart).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({
      scheduled: 1,
      ignored: 0,
      failed: 0,
    });
  });

  it("rejects invalid webhook signatures", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/p2p-withdrawals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-alchemy-signature": "bad-signature",
        },
        body: JSON.stringify(createPayload()),
      }),
    );

    expect(response.status).toBe(401);
    expect(vi.mocked(start)).not.toHaveBeenCalled();
  });
});
