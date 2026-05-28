import { start } from "workflow/api";
import type { P2PDepositWorkflowInput } from "@/lib/p2p/base";
import { upsertP2PDepositOperation } from "@/lib/store/p2p-deposit-ops-store";
import { processP2PDeposit } from "@/workflows/p2p-deposit";

type ScheduleP2PDepositWorkflowOptions = {
  webhookEventId?: string;
  receivedMessage: string;
  workflowMessage: string;
  failedMessage: string;
};

function getWorkflowRunId(run: unknown): string | undefined {
  if (typeof run !== "object" || run === null || !("id" in run)) {
    return undefined;
  }

  const id = (run as { id: unknown }).id;
  return id === undefined ? undefined : String(id);
}

export async function recordAndScheduleP2PDepositWorkflow(
  operation: P2PDepositWorkflowInput,
  options: ScheduleP2PDepositWorkflowOptions,
): Promise<{ workflowRunId?: string }> {
  await upsertP2PDepositOperation({
    ...operation,
    webhookEventId: options.webhookEventId,
    status: "webhook_received",
    message: options.receivedMessage,
  });

  try {
    const run = await start(processP2PDeposit, [{ ...operation }]);
    const workflowRunId = getWorkflowRunId(run);

    await upsertP2PDepositOperation({
      ...operation,
      webhookEventId: options.webhookEventId,
      workflowRunId,
      status: "workflow_started",
      message: options.workflowMessage,
    });

    return { workflowRunId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await upsertP2PDepositOperation({
      ...operation,
      webhookEventId: options.webhookEventId,
      status: "failed",
      lastError: message,
      message: options.failedMessage,
    });

    throw error;
  }
}
