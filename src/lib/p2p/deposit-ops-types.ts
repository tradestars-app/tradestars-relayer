export type P2PDepositOperationStatus =
  | "webhook_received"
  | "workflow_started"
  | "waiting_for_safe"
  | "safe_verified"
  | "minted"
  | "duplicate"
  | "invalid"
  | "failed";

export type P2PDepositOperationEvent = {
  status: P2PDepositOperationStatus;
  at: number;
  message?: string;
};

export type P2PDepositOperation = {
  id: string;
  orderId: string;
  wallet: string;
  amount: string;
  txHash: string;
  logIndex: number;
  webhookEventId?: string;
  workflowRunId?: string;
  status: P2PDepositOperationStatus;
  baseReceiptBlockNumber?: number;
  baseSafeBlockNumber?: number;
  solanaSignature?: string;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  history: P2PDepositOperationEvent[];
};

export type AdminP2PDepositOperationsData = {
  operations: P2PDepositOperation[];
};
