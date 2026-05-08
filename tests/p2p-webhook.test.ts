import crypto from "crypto";
import { PublicKey } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeDepositLog,
  verifyAlchemyWebhookSignature,
} from "@/lib/p2p/alchemy";
import { POST } from "@/app/api/webhooks/p2p/route";
import { upsertP2PDepositOperation } from "@/lib/store/p2p-deposit-ops-store";
import { start } from "workflow/api";

vi.mock("workflow/api", () => ({
  start: vi.fn(),
}));

vi.mock("@/lib/store/p2p-deposit-ops-store", () => ({
  upsertP2PDepositOperation: vi.fn(),
}));

function toBytes32Hex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function toUint256Hex(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function createPayload(user: PublicKey) {
  return {
    webhookId: "wh_test",
    id: "whevt_test",
    createdAt: "2026-04-25T12:00:00Z",
    event: {
      data: {
        block: {
          logs: [
            {
              address: "0xabc123",
              transaction: {
                hash: `0x${"12".repeat(32)}`,
              },
              topics: [
                process.env.ALCHEMY_P2P_DEPOSIT_TOPIC0!,
                toUint256Hex(42n),
                toBytes32Hex(user.toBytes()),
              ],
              data: toUint256Hex(10_000_000n),
              index: 7,
            },
          ],
        },
      },
    },
  };
}

function signBody(body: string): string {
  return crypto
    .createHmac("sha256", process.env.ALCHEMY_P2P_WEBHOOK_SIGNING_KEY!)
    .update(Buffer.from(body, "utf8"))
    .digest("hex");
}

describe("p2p webhook helpers", () => {
  const user = new PublicKey("5J7a1Qf7kbbfCkyw8vZczvCN4F7w4KPgsLo2w74H5hWQ");

  beforeEach(() => {
    process.env.ALCHEMY_P2P_WEBHOOK_SIGNING_KEY = "alchemy-secret";
    process.env.ALCHEMY_P2P_DEPOSIT_TOPIC0 = `0x${"ab".repeat(32)}`;
    process.env.BASE_P2P_INTEGRATOR_ADDRESS = "0xabc123";
    vi.clearAllMocks();
  });

  it("verifies valid alchemy webhook signatures", () => {
    const body = JSON.stringify({ ok: true });
    const signature = signBody(body);

    expect(
      verifyAlchemyWebhookSignature(
        body,
        signature,
        process.env.ALCHEMY_P2P_WEBHOOK_SIGNING_KEY!,
      ),
    ).toBe(true);
    expect(
      verifyAlchemyWebhookSignature(
        body,
        "deadbeef",
        process.env.ALCHEMY_P2P_WEBHOOK_SIGNING_KEY!,
      ),
    ).toBe(false);
  });

  it("decodes matching deposit logs", () => {
    const payload = createPayload(user);
    const decoded = decodeDepositLog(
      payload.event.data.block.logs[0],
      process.env.ALCHEMY_P2P_DEPOSIT_TOPIC0!,
      process.env.BASE_P2P_INTEGRATOR_ADDRESS,
    );

    expect(decoded).not.toBeNull();
    expect(decoded?.orderId).toBe("42");
    expect(decoded?.user.toBase58()).toBe(user.toBase58());
    expect(decoded?.amount).toBe(10_000_000n);
    expect(decoded?.logIndex).toBe(7);
  });
});

describe("POST /api/webhooks/p2p", () => {
  const mockedStart = vi.mocked(start);
  const mockedUpsert = vi.mocked(upsertP2PDepositOperation);
  const user = new PublicKey("5J7a1Qf7kbbfCkyw8vZczvCN4F7w4KPgsLo2w74H5hWQ");

  beforeEach(() => {
    process.env.ALCHEMY_P2P_WEBHOOK_SIGNING_KEY = "alchemy-secret";
    process.env.ALCHEMY_P2P_DEPOSIT_TOPIC0 = `0x${"ab".repeat(32)}`;
    process.env.BASE_P2P_INTEGRATOR_ADDRESS = "0xabc123";
    vi.clearAllMocks();
  });

  it("rejects invalid webhook signatures", async () => {
    const body = JSON.stringify(createPayload(user));
    const response = await POST(
      new Request("http://localhost/api/webhooks/p2p", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-alchemy-signature": "bad-signature",
        },
        body,
      }),
    );

    expect(response.status).toBe(401);
    expect(mockedStart).not.toHaveBeenCalled();
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it("schedules a valid deposit workflow exactly once", async () => {
    const body = JSON.stringify(createPayload(user));
    mockedStart.mockResolvedValueOnce({ id: "run_123" } as never);

    const response = await POST(
      new Request("http://localhost/api/webhooks/p2p", {
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
    expect(mockedUpsert).toHaveBeenCalledTimes(2);
    expect(await response.json()).toEqual({
      scheduled: 1,
      ignored: 0,
      failed: 0,
    });
  });
});
