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

1. The product app records the user's encrypted payout details in the shared app store.
2. The user signs the Solana `withdraw_request` transaction.
3. The Solana program burns `tUSDC` and emits `WithdrawRequested`.
4. Helius sends raw Solana transaction logs to `POST /api/webhooks/p2p-withdrawals`.
5. The relayer verifies `X-Alchemy-Signature`, decodes the Anchor event, and starts a Workflow run.
6. The workflow reads the matching app withdrawal record by signature or `(wallet, nonce)`.
7. The workflow calls `placeSellOrderForBurn`, waits for merchant acceptance, encrypts the user's payout details for the merchant, calls `deliverOfframpUpi`, and reconciles terminal Base statuses.

## Security Model

- Alchemy webhooks are authenticated with HMAC.
- The relayer re-fetches the Base receipt before minting.
- In production, minting should only happen once the receipt block is at or below Base `safe`.
- Preview/dev deployments may use receipt-level finality to keep P2P testing fast.
- Only the configured Solana `minting_authority` can call `deposit_collateral`.
- Solana replay markers keyed by `(base_tx_hash, log_index)` prevent duplicate minting.
- Operation logs are for support and observability only, not correctness.
- The off-ramp relayer key stays in this service; the product app never receives it and does not expose off-ramp execution APIs.
- P2P payout addresses are encrypted at rest in the app store and decrypted only by the relayer when a matching burn event is observed.

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

## Environment

- `ALCHEMY_P2P_WEBHOOK_SIGNING_KEY`
- `ALCHEMY_P2P_DEPOSIT_TOPIC0`
- `BASE_RPC_URL`
- `BASE_P2P_INTEGRATOR_ADDRESS`
- `BASE_P2P_DIAMOND_ADDRESS`
- `BASE_OFFRAMP_RELAYER_PRIVATE_KEY`
- `BASE_P2P_DEPOSIT_FINALITY` optional, `safe` or `receipt`, defaults to `safe`
- `BASE_SAFE_RECHECK_DELAYS_SECONDS` optional, defaults to steady short polling for roughly 5 minutes
- `HELIUS_WEBHOOK_SECRET`
- `P2P_WITHDRAWAL_ENCRYPTION_KEY`
- `P2P_OFFRAMP_RELAY_ADDRESS`
- `P2P_OFFRAMP_RELAY_PUBLIC_KEY`
- `P2P_OFFRAMP_RELAY_PRIVATE_KEY`
- `P2P_OFFRAMP_MERCHANT_POLL_DELAYS_SECONDS` optional
- `P2P_OFFRAMP_TERMINAL_POLL_DELAYS_SECONDS` optional
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
