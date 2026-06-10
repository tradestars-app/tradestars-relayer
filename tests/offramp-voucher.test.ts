import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  OFFRAMP_VOUCHER_TYPES,
  isVoucherExpired,
  signOfframpVoucher,
  solanaPubkeyToBytes32,
  solanaSignatureToBurnBytes32,
  type P2POfframpConfig,
} from "@/lib/p2p/offramp";

const ATTESTER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const INTEGRATOR = "0xadD13C5DB8aD6913E213fAa6572f9C79F1659D19" as const;
const USER = "0x18743aFc33B5Ae4F6eCE457Dad14aFB36277e6fb" as const;

// Valid base58 Solana fixtures.
const SOLANA_SIGNATURE =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const SOLANA_PUBKEY = "4Nd1mYbVrCzbPnfmkff2cgZ6oCSXF2DcsXMDseTsJzAH";

const config: P2POfframpConfig = {
  baseRpcUrl: "http://unused-in-signing.invalid",
  chainId: 84532,
  integratorAddress: INTEGRATOR,
  diamondAddress: "0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9",
  relayerPrivateKey: ATTESTER_KEY,
  voucherTtlSeconds: 3600,
};

describe("offramp voucher signing (attester, off-chain only)", () => {
  it("signs a voucher that recovers to the attester over the integrator's domain", async () => {
    const { voucher, voucherSignature } = await signOfframpVoucher({
      config,
      baseAddress: USER,
      amount: "10000000",
      signature: SOLANA_SIGNATURE,
      solanaUser: SOLANA_PUBKEY,
    });

    expect(voucher.user).toBe(USER);
    expect(voucher.amount).toBe("10000000");
    expect(voucher.solanaBurnTx).toBe(
      solanaSignatureToBurnBytes32(SOLANA_SIGNATURE),
    );
    expect(voucher.solanaUserPubkey).toBe(solanaPubkeyToBytes32(SOLANA_PUBKEY));
    expect(Number(voucher.deadline)).toBeGreaterThan(Date.now() / 1000);

    // Must recover to the attester under EXACTLY the domain the integrator
    // verifies (TradeStarsOfframp/1/chainId/integrator) — this is what
    // ECDSA.recover(digest, sig) == offrampRelayer checks on-chain.
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: "TradeStarsOfframp",
        version: "1",
        chainId: config.chainId,
        verifyingContract: config.integratorAddress,
      },
      types: OFFRAMP_VOUCHER_TYPES,
      primaryType: "OfframpVoucher",
      message: {
        solanaBurnTx: voucher.solanaBurnTx,
        solanaUserPubkey: voucher.solanaUserPubkey,
        user: voucher.user,
        amount: BigInt(voucher.amount),
        deadline: BigInt(voucher.deadline),
      },
      signature: voucherSignature,
    });
    expect(recovered).toBe(privateKeyToAccount(ATTESTER_KEY).address);
  });

  it("a tampered amount no longer recovers to the attester", async () => {
    const { voucher, voucherSignature } = await signOfframpVoucher({
      config,
      baseAddress: USER,
      amount: "10000000",
      signature: SOLANA_SIGNATURE,
      solanaUser: SOLANA_PUBKEY,
    });

    const recovered = await recoverTypedDataAddress({
      domain: {
        name: "TradeStarsOfframp",
        version: "1",
        chainId: config.chainId,
        verifyingContract: config.integratorAddress,
      },
      types: OFFRAMP_VOUCHER_TYPES,
      primaryType: "OfframpVoucher",
      message: {
        solanaBurnTx: voucher.solanaBurnTx,
        solanaUserPubkey: voucher.solanaUserPubkey,
        user: voucher.user,
        amount: 90_000_000n, // inflated after signing
        deadline: BigInt(voucher.deadline),
      },
      signature: voucherSignature,
    });
    expect(recovered).not.toBe(privateKeyToAccount(ATTESTER_KEY).address);
  });

  it("isVoucherExpired respects the deadline", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isVoucherExpired({ deadline: String(now + 60) })).toBe(false);
    expect(isVoucherExpired({ deadline: String(now - 60) })).toBe(true);
  });
});
