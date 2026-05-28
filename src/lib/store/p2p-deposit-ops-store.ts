import { getRedis } from "@/store/upstash";
import type {
  P2PDepositOperation,
  P2PDepositOperationStatus,
} from "@/lib/p2p/deposit-ops-types";
import {
  p2pDepositOperationKey,
  p2pDepositOperationsIndexKey,
} from "@/lib/store/keys";
import { linkP2PDepositSubmission } from "@/lib/store/p2p-deposit-submissions-store";

const MAX_HISTORY_EVENTS = 20;

export type UpsertP2PDepositOperationInput = {
  orderId: string;
  wallet: string;
  amount: string;
  txHash: string;
  logIndex: number;
  status: P2PDepositOperationStatus;
  webhookEventId?: string;
  workflowRunId?: string;
  baseReceiptBlockNumber?: number;
  baseSafeBlockNumber?: number;
  solanaSignature?: string;
  lastError?: string;
  message?: string;
  at?: number;
};

function getOperationId(txHash: string, logIndex: number): string {
  return `${txHash.toLowerCase()}:${logIndex}`;
}

export async function getP2PDepositOperation(
  txHash: string,
  logIndex: number,
): Promise<P2PDepositOperation | null> {
  const redis = getRedis();
  return (
    (await redis.get<P2PDepositOperation>(
      p2pDepositOperationKey(txHash, logIndex),
    )) ?? null
  );
}

export async function upsertP2PDepositOperation(
  input: UpsertP2PDepositOperationInput,
): Promise<P2PDepositOperation> {
  const redis = getRedis();
  const timestamp = input.at ?? Date.now();
  const existing = await getP2PDepositOperation(input.txHash, input.logIndex);
  const next: P2PDepositOperation = {
    id: existing?.id ?? getOperationId(input.txHash, input.logIndex),
    orderId: input.orderId,
    wallet: input.wallet,
    amount: input.amount,
    txHash: input.txHash.toLowerCase(),
    logIndex: input.logIndex,
    webhookEventId: input.webhookEventId ?? existing?.webhookEventId,
    workflowRunId: input.workflowRunId ?? existing?.workflowRunId,
    status: input.status,
    baseReceiptBlockNumber:
      input.baseReceiptBlockNumber ?? existing?.baseReceiptBlockNumber,
    baseSafeBlockNumber:
      input.baseSafeBlockNumber ?? existing?.baseSafeBlockNumber,
    solanaSignature: input.solanaSignature ?? existing?.solanaSignature,
    lastError: input.lastError,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    history: [
      ...(existing?.history ?? []),
      {
        status: input.status,
        at: timestamp,
        message: input.message,
      },
    ].slice(-MAX_HISTORY_EVENTS),
  };

  const pipeline = redis.pipeline();
  pipeline.set(p2pDepositOperationKey(input.txHash, input.logIndex), next);
  pipeline.zadd(p2pDepositOperationsIndexKey(), {
    score: next.updatedAt,
    member: next.id,
  });
  await pipeline.exec();
  await linkP2PDepositSubmission(next.orderId, next.id);

  return next;
}

export async function listRecentP2PDepositOperations(
  limit: number = 25,
): Promise<P2PDepositOperation[]> {
  const redis = getRedis();
  const ids =
    (await redis.zrange<string[]>(
      p2pDepositOperationsIndexKey(),
      0,
      limit - 1,
      { rev: true },
    )) ?? [];
  if (ids.length === 0) {
    return [];
  }

  const operations = await Promise.all(
    ids.map((id) => {
      const [txHash, logIndex] = id.split(":");
      return getP2PDepositOperation(txHash, Number(logIndex));
    }),
  );

  return operations.filter(
    (operation): operation is P2PDepositOperation => operation !== null,
  );
}
