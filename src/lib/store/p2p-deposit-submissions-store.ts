import { getRedis } from "@/store/upstash";
import type {
  P2PDepositSubmission,
  P2PDepositSubmissionStatus,
} from "@/lib/p2p/deposit-ops-types";
import {
  p2pDepositSubmissionKey,
  p2pDepositSubmissionsIndexKey,
} from "@/lib/store/keys";

export type UpsertP2PDepositSubmissionInput = {
  orderId: string;
  wallet: string;
  amount: string;
  status?: P2PDepositSubmissionStatus;
  linkedOperationId?: string;
  at?: number;
};

export async function getP2PDepositSubmission(
  orderId: string,
): Promise<P2PDepositSubmission | null> {
  const redis = getRedis();
  return (
    (await redis.get<P2PDepositSubmission>(
      p2pDepositSubmissionKey(orderId),
    )) ?? null
  );
}

export async function upsertP2PDepositSubmission(
  input: UpsertP2PDepositSubmissionInput,
): Promise<P2PDepositSubmission> {
  const redis = getRedis();
  const timestamp = input.at ?? Date.now();
  const existing = await getP2PDepositSubmission(input.orderId);
  const next: P2PDepositSubmission = {
    id: input.orderId,
    orderId: input.orderId,
    wallet: input.wallet,
    amount: input.amount,
    status: input.status ?? existing?.status ?? "processing",
    linkedOperationId: input.linkedOperationId ?? existing?.linkedOperationId,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  const pipeline = redis.pipeline();
  pipeline.set(p2pDepositSubmissionKey(next.orderId), next);
  pipeline.zadd(p2pDepositSubmissionsIndexKey(), {
    score: next.updatedAt,
    member: next.orderId,
  });
  await pipeline.exec();

  return next;
}

export async function linkP2PDepositSubmission(
  orderId: string,
  operationId: string,
): Promise<void> {
  const existing = await getP2PDepositSubmission(orderId);
  if (!existing || existing.status === "linked") return;
  await upsertP2PDepositSubmission({
    orderId: existing.orderId,
    wallet: existing.wallet,
    amount: existing.amount,
    status: "linked",
    linkedOperationId: operationId,
  });
}

export async function listRecentP2PDepositSubmissions(
  limit: number = 25,
): Promise<P2PDepositSubmission[]> {
  const redis = getRedis();
  const orderIds =
    (await redis.zrange<string[]>(
      p2pDepositSubmissionsIndexKey(),
      0,
      limit - 1,
      { rev: true },
    )) ?? [];
  if (orderIds.length === 0) return [];

  const submissions = await Promise.all(
    orderIds.map((orderId) => getP2PDepositSubmission(orderId)),
  );

  return submissions.filter(
    (submission): submission is P2PDepositSubmission =>
      submission !== null && submission.status === "processing",
  );
}
