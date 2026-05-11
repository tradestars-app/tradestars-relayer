import { BN, Program, type Idl } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  getProgramId,
  getSolanaMintComputeUnitPriceMicroLamports,
} from "@/lib/solana/config";
import {
  getDepositMarkerPda,
  getMintingKeypair,
  getMintingProvider,
  getPlatformConfigPda,
  getRpcConnection,
  getTusdcMintPda,
  getUserAccountPda,
} from "@/lib/solana/program";

const DEPOSIT_COLLATERAL_IDL = {
  address: getProgramId().toBase58(),
  metadata: {
    name: "tradestarsArena",
    version: "0.1.0",
    spec: "0.1.0",
    description: "TradeStars Arena deposit minting client",
  },
  instructions: [
    {
      name: "depositCollateral",
      discriminator: [156, 131, 142, 116, 146, 247, 162, 120],
      accounts: [
        { name: "platformConfig" },
        { name: "tusdcMint", writable: true },
        { name: "user" },
        { name: "userAccount", writable: true },
        { name: "depositMarker", writable: true },
        { name: "userTusdc", writable: true },
        { name: "mintingAuthority", writable: true, signer: true },
        { name: "tokenProgram" },
        { name: "associatedTokenProgram" },
        { name: "systemProgram" },
      ],
      args: [
        { name: "amount", type: "u64" },
        { name: "baseTxHash", type: { array: ["u8", 32] } },
        { name: "logIndex", type: "u32" },
      ],
    },
  ],
} as const satisfies Idl;

const MINT_CONFIRMATION_TIMEOUT_MS = 45_000;
const MINT_CONFIRMATION_POLL_MS = 1_000;
const MINT_CONFIRMATION_COMMITMENT = "confirmed";

export type DepositCollateralInput = {
  user: PublicKey;
  amount: bigint;
  baseTxHashBytes: number[];
  logIndex: number;
};

export type DepositCollateralResult =
  | { status: "minted"; signature: string }
  | { status: "duplicate" };

async function waitForSignatureCommitment(signature: string): Promise<void> {
  const connection = getRpcConnection();
  const startedAt = Date.now();

  while (Date.now() - startedAt < MINT_CONFIRMATION_TIMEOUT_MS) {
    const response = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: false,
    });
    const status = response.value[0];
    if (status?.err) {
      throw new Error(`Solana mint transaction failed: ${JSON.stringify(status.err)}`);
    }
    if (
      status?.confirmationStatus === MINT_CONFIRMATION_COMMITMENT ||
      status?.confirmationStatus === "finalized"
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, MINT_CONFIRMATION_POLL_MS));
  }

  throw new Error(
    `Timed out waiting for Solana mint ${signature} to reach ${MINT_CONFIRMATION_COMMITMENT}`,
  );
}

export async function depositCollateral(
  input: DepositCollateralInput,
): Promise<DepositCollateralResult> {
  const connection = getRpcConnection();
  const mintingKeypair = getMintingKeypair();
  const provider = getMintingProvider();
  const program = new Program(DEPOSIT_COLLATERAL_IDL, provider);
  const computeUnitPriceMicroLamports =
    getSolanaMintComputeUnitPriceMicroLamports();

  const [platformConfig] = getPlatformConfigPda();
  const [tusdcMint] = getTusdcMintPda();
  const [userAccount] = getUserAccountPda(input.user);
  const [depositMarker] = getDepositMarkerPda(
    Uint8Array.from(input.baseTxHashBytes),
    input.logIndex,
  );
  const userTusdc = getAssociatedTokenAddressSync(
    tusdcMint,
    input.user,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  if (await connection.getAccountInfo(depositMarker, "confirmed")) {
    return { status: "duplicate" };
  }

  try {
    const instruction = await program.methods
      .depositCollateral(
        new BN(input.amount.toString()),
        input.baseTxHashBytes,
        input.logIndex,
      )
      .accounts({
        platformConfig,
        tusdcMint,
        user: input.user,
        userAccount,
        depositMarker,
        userTusdc,
        mintingAuthority: mintingKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const { blockhash } = await connection.getLatestBlockhash("processed");
    const transaction = new Transaction({
      feePayer: mintingKeypair.publicKey,
      recentBlockhash: blockhash,
    }).add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: computeUnitPriceMicroLamports,
      }),
      instruction,
    );
    transaction.sign(mintingKeypair);

    const signature = await connection.sendRawTransaction(
      transaction.serialize(),
      {
        maxRetries: 5,
        preflightCommitment: "processed",
        skipPreflight: false,
      },
    );
    await waitForSignatureCommitment(signature);

    return { status: "minted", signature };
  } catch (error) {
    if (await connection.getAccountInfo(depositMarker, "confirmed")) {
      return { status: "duplicate" };
    }
    throw error;
  }
}
