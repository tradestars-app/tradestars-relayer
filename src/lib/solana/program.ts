import { AnchorProvider } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getMintingAuthorityKeypair,
  getProgramId,
  getSolanaRpcUrl,
} from "@/lib/solana/config";

export class NodeWallet {
  constructor(readonly payer: Keypair) {}

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    if (tx instanceof Transaction) {
      tx.partialSign(this.payer);
    } else {
      tx.sign([this.payer]);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    return txs.map((tx) => {
      if (tx instanceof Transaction) {
        tx.partialSign(this.payer);
      } else {
        tx.sign([this.payer]);
      }
      return tx;
    });
  }

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }
}

export function getMintingKeypair(): Keypair {
  return getMintingAuthorityKeypair();
}

export function getRpcConnection(): Connection {
  return new Connection(getSolanaRpcUrl(), "confirmed");
}

export function getMintingProvider(): AnchorProvider {
  const connection = getRpcConnection();
  const wallet = new NodeWallet(getMintingKeypair());
  return new AnchorProvider(connection, wallet as never, {
    commitment: "confirmed",
  });
}

export function getPlatformConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], getProgramId());
}

export function getTusdcMintPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("tusdc_mint")],
    getProgramId(),
  );
}

export function getUserAccountPda(userPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user"), userPubkey.toBuffer()],
    getProgramId(),
  );
}

export function getDepositMarkerPda(
  baseTxHash: Uint8Array,
  logIndex: number,
): [PublicKey, number] {
  const logIndexBuffer = Buffer.alloc(4);
  logIndexBuffer.writeUInt32LE(logIndex, 0);

  return PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), Buffer.from(baseTxHash), logIndexBuffer],
    getProgramId(),
  );
}
