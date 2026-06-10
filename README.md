# TradeStars Relayer

`tradestars-relayer` is the operational service that mirrors Base USDC deposits into Solana `tUSDC` and turns Solana withdrawal burns into P2P cashout orders.

It is intentionally separate from the main product app. The relayer owns deposit execution and minting secrets; the product app only reads relayer status through an authenticated admin API.

## Deposit Flow

1. Alchemy sends Base `DepositComplete` logs to `POST /api/webhooks/p2p`.
2. The route verifies `X-Alchemy-Signature`.
3. Matching logs are decoded into `(wallet, amount, txHash, logIndex)`.
4. One Workflow run is started per deposit log.
5. The workflow re-checks the Base receipt until the configured finality is reached.
6. The relayer calls Solana `deposit_collateral(amount, base_tx_hash, log_index)`.
7. The Solana program creates the replay marker and mints `tUSDC`.

## P2P Withdrawal Flow

> **Offramp (voucher-attested, single user tx).** The relayer is a pure
> ATTESTER: it signs an EIP-712 `OfframpVoucher` off-chain and sends **no
> Base transaction**. The user's one Base tx redeems the voucher (vault →
> their proxy) and places the SELL atomically. See
> `payment-integrators/docs/OFFRAMP-V2.md`.

1. The product app records the user's **Base address** on the withdrawal in the shared app store (the payout address is entered + encrypted later, client-side in the widget — never stored server-side).
2. The user signs the Solana `withdraw_request` transaction.
3. The Solana program burns `tUSDC` and emits `WithdrawRequested`.
4. Helius sends raw Solana transaction logs to `POST /api/webhooks/p2p-withdrawals`.
5. The relayer verifies the webhook auth, decodes the Anchor event, and starts a Workflow run.
6. The workflow reads the matching app withdrawal record by signature or `(wallet, nonce)`.
7. The workflow **signs `OfframpVoucher(burnTx, solanaUserPubkey, baseAddress, amount, deadline)`** with the attester key and persists `{voucher, voucherSignature}` on the withdrawal record (status `signed`) — and stops. The product app hands the voucher to the widget; the **user's single Base tx** (`userRedeemAndStartOfframp`) verifies it, releases vault USDC into their own proxy, and places the SELL. Deliver-UPI / retry stay user-driven; the relayer never places orders, polls, encrypts payout details, reconciles, or transacts.

## Security Model

- Alchemy webhooks are authenticated with HMAC.
- The relayer re-fetches the Base receipt before minting.
- In production, minting should only happen once the receipt block is at or below Base `safe`.
- Preview/dev deployments may use receipt-level finality to keep P2P testing fast.
- Only the configured Solana `minting_authority` can call `deposit_collateral`.
- Solana replay markers keyed by `(base_tx_hash, log_index)` prevent duplicate minting.
- Operation logs are for support and observability only, not correctness.
- The off-ramp attester key stays in this service and only **signs vouchers off-chain** — it holds no gas, sends no transactions, and cannot move funds itself. Vault USDC moves only when the named user redeems a voucher on-chain (single-use per burn, deadline-bounded, user-bound).
- P2P payout addresses are entered + encrypted **client-side in the widget** against the assigned merchant's key — they are never stored server-side or handled by the relayer.

## Admin API

The product app reads deposit status from:

- `GET /api/admin/deposits?limit=20`

Auth:

- `Authorization: Bearer <RELAYER_ADMIN_API_KEY>`

## Manual Base Deposit Replay

Use this when Alchemy missed a Base deposit webhook, the webhook endpoint was
down, or a webhook was acknowledged before the workflow was scheduled.

Dry run first:

```bash
pnpm replay:base-deposit --env=.env.local --relayer-url=https://<preview-relayer> --network=base-sepolia --tx=0x...
pnpm replay:base-deposit --env=.env.prod --relayer-url=https://<production-relayer> --network=base-mainnet --tx=0x...
```

Execute only after the decoded wallet, amount, order id, tx hash, and log index
match the deposit being recovered:

```bash
pnpm replay:base-deposit --env=.env.local --relayer-url=https://<preview-relayer> --network=base-sepolia --tx=0x... --execute
pnpm replay:base-deposit --env=.env.prod --relayer-url=https://<production-relayer> --network=base-mainnet --tx=0x... --execute --confirm-mainnet
```

If the transaction emitted more than one matching deposit event, pass
`--log-index=<index>`. The script calls the protected relayer admin replay API
using `RELAYER_ADMIN_API_URL` or `--relayer-url`, plus
`RELAYER_ADMIN_API_KEY`. The deployed relayer verifies its configured Base RPC
chain id, decodes the deposit from the Base receipt, records the operation, and
schedules the same deposit workflow used by the Alchemy webhook. The workflow
still re-checks Base finality and the Solana program still enforces
`(base_tx_hash, log_index)` replay protection.

## Manual P2P Withdrawal Replay

Use this when a Solana withdrawal burn was observed but the P2P Base SELL
workflow did not complete. The dry run validates that the app withdrawal record
matches the Solana burn event fields.

```bash
pnpm replay:p2p-withdrawal --env=.env.prod --relayer-url=https://<production-relayer> --signature=<solana_tx> --user=<solana_wallet> --amount=<raw_usdc> --nonce=<withdraw_nonce>
```

To schedule the deployed workflow:

```bash
pnpm replay:p2p-withdrawal --env=.env.prod --relayer-url=https://<production-relayer> --signature=<solana_tx> --user=<solana_wallet> --amount=<raw_usdc> --nonce=<withdraw_nonce> --execute --confirm-mainnet
```

Replay is safe to retry: the workflow first checks `burnToAllocation` on the
TradeStars integrator (non-zero ⇒ the user already redeemed → status
`redeemed`), keeps a live unexpired voucher as-is, and re-signs an expired one
(same burn, fresh deadline — the on-chain burn dedupe makes double redemption
impossible regardless).

## Environment

- `ALCHEMY_P2P_WEBHOOK_SIGNING_KEY`
- `ALCHEMY_P2P_DEPOSIT_TOPIC0`
- `BASE_RPC_URL`
- `BASE_P2P_INTEGRATOR_ADDRESS`
- `BASE_P2P_DIAMOND_ADDRESS`
- `BASE_OFFRAMP_RELAYER_PRIVATE_KEY` — the attester key; signs vouchers off-chain only, needs no ETH
- `BASE_CHAIN_ID` optional, EIP-712 voucher domain chain id, defaults to `84532` (Base Sepolia)
- `P2P_VOUCHER_TTL_SECONDS` optional, voucher validity window, defaults to `86400` (24h)
- `BASE_P2P_DEPOSIT_FINALITY` optional, `safe` or `receipt`, defaults to `safe`
- `BASE_SAFE_RECHECK_DELAYS_SECONDS` optional, defaults to steady short polling for roughly 5 minutes
- `HELIUS_WEBHOOK_SECRET`
- `SOLANA_MINTING_AUTHORITY_KEYPAIR`
- `SOLANA_RPC`
- `SOLANA_MINT_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS` optional, defaults to `10000`
- `NEXT_PUBLIC_PROGRAM_ID`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `TRADESTARS_REDIS_KEY_PREFIX` optional, defaults to `ts-relayer` in production
- `TRADESTARS_APP_STORE_NAMESPACE` optional, defaults to `ts-app` in production and `ts-app-dev` otherwise
- `RELAYER_ADMIN_API_KEY`

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```
