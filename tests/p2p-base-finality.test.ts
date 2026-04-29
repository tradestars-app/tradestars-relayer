import { PublicKey } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifySafeBaseDeposit } from "@/lib/p2p/base";

const wallet = new PublicKey(Uint8Array.from(Array(32).fill(17))).toBase58();
const txHash = `0x${"12".repeat(32)}`;
const topic0 = `0x${"ab".repeat(32)}`;
const contract = "0xabc123";

function toUint256Hex(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function createFetchMock(receiptBlock: bigint, safeBlock: bigint) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      method: string;
    };

    if (body.method === "eth_getTransactionReceipt") {
      return Response.json({
        result: {
          status: "0x1",
          blockNumber: `0x${receiptBlock.toString(16)}`,
          logs: [
            {
              address: contract,
              transactionHash: txHash,
              logIndex: "0x7",
              topics: [
                topic0,
                toUint256Hex(42n),
                `0x${Buffer.from(new PublicKey(wallet).toBytes()).toString("hex")}`,
              ],
              data: toUint256Hex(10_000_000n),
            },
          ],
        },
      });
    }

    if (body.method === "eth_getBlockByNumber") {
      return Response.json({
        result: {
          number: `0x${safeBlock.toString(16)}`,
        },
      });
    }

    return Response.json({ result: null });
  });
}

describe("verifySafeBaseDeposit", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts matching Base deposits when the receipt block is safe", async () => {
    vi.stubGlobal("fetch", createFetchMock(100n, 101n));

    await expect(
      verifySafeBaseDeposit(
        {
          orderId: "42",
          wallet,
          amount: "10000000",
          txHash,
          logIndex: 7,
        },
        {
          baseRpcUrl: "https://base.example",
          expectedTopic0: topic0,
          expectedContractAddress: contract,
        },
      ),
    ).resolves.toEqual({
      status: "safe",
      receiptBlockNumber: 100,
      safeBlockNumber: 101,
    });
  });

  it("returns pending when the receipt block is not safe yet", async () => {
    vi.stubGlobal("fetch", createFetchMock(102n, 101n));

    await expect(
      verifySafeBaseDeposit(
        {
          orderId: "42",
          wallet,
          amount: "10000000",
          txHash,
          logIndex: 7,
        },
        {
          baseRpcUrl: "https://base.example",
          expectedTopic0: topic0,
          expectedContractAddress: contract,
        },
      ),
    ).resolves.toEqual({
      status: "pending",
      reason: "Base transaction is not safe yet",
    });
  });
});
