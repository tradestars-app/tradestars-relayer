import bs58 from "bs58";

export type P2PDepositWorkflowInput = {
  orderId: string;
  wallet: string;
  amount: string;
  txHash: string;
  logIndex: number;
};

type BaseTransactionReceipt = {
  status?: string | null;
  blockNumber?: string | null;
  logs?: BaseReceiptLog[];
};

type BaseReceiptLog = {
  address?: string;
  topics?: string[];
  data?: string;
  logIndex?: string;
  transactionHash?: string;
  removed?: boolean;
};

type BaseBlock = {
  number?: string | null;
};

export type BaseDepositVerificationResult =
  | {
      status: "safe";
      safeBlockNumber: number;
      receiptBlockNumber: number;
    }
  | {
      status: "pending";
      reason: string;
    }
  | {
      status: "invalid";
      reason: string;
    };

type VerifyBaseDepositOptions = {
  baseRpcUrl: string;
  expectedTopic0: string;
  expectedContractAddress?: string | null;
  finality: "receipt" | "safe";
};

type DecodeBaseReceiptDepositLogsOptions = {
  baseRpcUrl: string;
  expectedTopic0: string;
  expectedContractAddress?: string | null;
};

export type BaseDepositReceiptMatch = {
  input: P2PDepositWorkflowInput;
  receiptBlockNumber: number;
};

export function isHexString(value: string, byteLength?: number): boolean {
  if (!/^(0x)?[0-9a-fA-F]+$/.test(value)) {
    return false;
  }

  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (byteLength === undefined) {
    return normalized.length % 2 === 0;
  }

  return normalized.length === byteLength * 2;
}

export function isHexQuantity(value: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(value);
}

export function normalizeHex(value: string): string {
  return value.startsWith("0x")
    ? value.toLowerCase()
    : `0x${value.toLowerCase()}`;
}

export function hexToNumber(value: string): number {
  return Number(BigInt(normalizeHex(value)));
}

export async function callBaseRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Base RPC ${method} failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (payload.error) {
    throw new Error(
      `Base RPC ${method} error: ${payload.error.message || "unknown error"}`,
    );
  }

  return payload.result as T;
}

function decodeReceiptLog(
  log: BaseReceiptLog,
  expectedTopic0: string,
  expectedContractAddress?: string | null,
): { orderId: string; wallet: string; amount: string; logIndex: number } | null {
  const topics = log.topics ?? [];
  if (topics.length < 3) {
    return null;
  }

  if (normalizeHex(topics[0]) !== normalizeHex(expectedTopic0)) {
    return null;
  }

  if (
    expectedContractAddress &&
    log.address &&
    normalizeHex(log.address) !== normalizeHex(expectedContractAddress)
  ) {
    return null;
  }

  if (!log.data || !isHexString(log.data)) {
    return null;
  }
  if (!log.logIndex || !isHexQuantity(log.logIndex)) {
    return null;
  }
  if (!isHexString(topics[1], 32) || !isHexString(topics[2], 32)) {
    return null;
  }

  return {
    orderId: BigInt(normalizeHex(topics[1])).toString(),
    wallet: Buffer.from(normalizeHex(topics[2]).slice(2), "hex").toString(
      "base64",
    ),
    amount: BigInt(normalizeHex(log.data)).toString(),
    logIndex: hexToNumber(log.logIndex),
  };
}

function walletBytesToBase58(walletBase64: string): string {
  return bs58.encode(Buffer.from(walletBase64, "base64"));
}

export async function decodeBaseDepositLogsFromReceipt(
  txHash: string,
  options: DecodeBaseReceiptDepositLogsOptions,
): Promise<BaseDepositReceiptMatch[]> {
  if (!isHexString(txHash, 32)) {
    throw new Error("Transaction hash must be a 32-byte hex string");
  }

  const normalizedTxHash = normalizeHex(txHash);
  const receipt = await callBaseRpc<BaseTransactionReceipt | null>(
    options.baseRpcUrl,
    "eth_getTransactionReceipt",
    [normalizedTxHash],
  );

  if (!receipt) {
    throw new Error("Transaction receipt not available");
  }

  if (receipt.status && normalizeHex(receipt.status) !== "0x1") {
    throw new Error("Base transaction failed");
  }

  if (!receipt.blockNumber || !isHexQuantity(receipt.blockNumber)) {
    throw new Error("Transaction receipt has no block number yet");
  }

  const receiptBlockNumber = hexToNumber(receipt.blockNumber);
  const matches: BaseDepositReceiptMatch[] = [];

  for (const log of receipt.logs ?? []) {
    if (log.removed) {
      continue;
    }
    if (
      log.transactionHash &&
      normalizeHex(log.transactionHash) !== normalizedTxHash
    ) {
      continue;
    }

    const decoded = decodeReceiptLog(
      log,
      options.expectedTopic0,
      options.expectedContractAddress,
    );
    if (!decoded) {
      continue;
    }

    matches.push({
      receiptBlockNumber,
      input: {
        orderId: decoded.orderId,
        wallet: walletBytesToBase58(decoded.wallet),
        amount: decoded.amount,
        txHash: normalizedTxHash,
        logIndex: decoded.logIndex,
      },
    });
  }

  return matches;
}

export async function verifySafeBaseDeposit(
  input: P2PDepositWorkflowInput,
  options: VerifyBaseDepositOptions,
): Promise<BaseDepositVerificationResult> {
  const receipt = await callBaseRpc<BaseTransactionReceipt | null>(
    options.baseRpcUrl,
    "eth_getTransactionReceipt",
    [input.txHash],
  );

  if (!receipt) {
    return {
      status: "pending",
      reason: "Transaction receipt not available yet",
    };
  }

  if (receipt.status && normalizeHex(receipt.status) !== "0x1") {
    return {
      status: "invalid",
      reason: "Base transaction failed",
    };
  }

  if (!receipt.blockNumber || !isHexQuantity(receipt.blockNumber)) {
    return {
      status: "pending",
      reason: "Transaction receipt has no block number yet",
    };
  }

  const receiptLog = (receipt.logs ?? []).find((log) => {
    if (log.removed) {
      return false;
    }
    if (
      log.transactionHash &&
      normalizeHex(log.transactionHash) !== normalizeHex(input.txHash)
    ) {
      return false;
    }
    if (!log.logIndex || !isHexQuantity(log.logIndex)) {
      return false;
    }

    return hexToNumber(log.logIndex) === input.logIndex;
  });

  if (!receiptLog) {
    return {
      status: "invalid",
      reason: "Expected deposit log is missing from the Base receipt",
    };
  }

  const decoded = decodeReceiptLog(
    receiptLog,
    options.expectedTopic0,
    options.expectedContractAddress,
  );
  if (!decoded) {
    return {
      status: "invalid",
      reason: "Base receipt log does not match the expected deposit event",
    };
  }

  if (decoded.orderId !== input.orderId) {
    return {
      status: "invalid",
      reason: "Base receipt order id does not match the scheduled workflow payload",
    };
  }

  if (walletBytesToBase58(decoded.wallet) !== input.wallet) {
    return {
      status: "invalid",
      reason: "Base receipt wallet does not match the scheduled workflow payload",
    };
  }

  if (decoded.amount !== input.amount) {
    return {
      status: "invalid",
      reason: "Base receipt amount does not match the scheduled workflow payload",
    };
  }

  const receiptBlockNumber = hexToNumber(receipt.blockNumber);
  if (options.finality === "receipt") {
    return {
      status: "safe",
      safeBlockNumber: receiptBlockNumber,
      receiptBlockNumber,
    };
  }

  const safeBlock = await callBaseRpc<BaseBlock | null>(
    options.baseRpcUrl,
    "eth_getBlockByNumber",
    ["safe", false],
  );

  if (!safeBlock?.number || !isHexQuantity(safeBlock.number)) {
    return {
      status: "pending",
      reason: "Base safe block not available yet",
    };
  }

  const safeBlockNumber = hexToNumber(safeBlock.number);

  if (receiptBlockNumber > safeBlockNumber) {
    return {
      status: "pending",
      reason: "Base transaction is not safe yet",
    };
  }

  return {
    status: "safe",
    safeBlockNumber,
    receiptBlockNumber,
  };
}
