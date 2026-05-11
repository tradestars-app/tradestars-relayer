import { BN, Program, type Idl } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, SystemProgram } from "@solana/web3.js";
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

export type DepositCollateralInput = {
  user: PublicKey;
  amount: bigint;
  baseTxHashBytes: number[];
  logIndex: number;
};

export type DepositCollateralResult =
  | { status: "minted"; signature: string }
  | { status: "duplicate" };

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
    const signature = await program.methods
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
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: computeUnitPriceMicroLamports,
        }),
      ])
      .rpc();

    return { status: "minted", signature };
  } catch (error) {
    if (await connection.getAccountInfo(depositMarker, "confirmed")) {
      return { status: "duplicate" };
    }
    throw error;
  }
}
