# TradeStars Relayer

`tradestars-relayer` is the operational service that mirrors Base USDC deposits into Solana `tUSDC`.

It is intentionally separate from the main product app. The relayer owns deposit execution and minting secrets; the product app only reads relayer status through an authenticated admin API.

## Flow

1. Alchemy sends Base `DepositComplete` logs to `POST /api/webhooks/p2p`.
2. The route verifies `X-Alchemy-Signature`.
3. Matching logs are decoded into `(wallet, amount, txHash, logIndex)`.
4. One Workflow run is started per deposit log.
5. The workflow re-checks the Base receipt until the deposit is in a `safe` block.
6. The relayer calls Solana `deposit_collateral(amount, base_tx_hash, log_index)`.
7. The Solana program creates the replay marker and mints `tUSDC`.

## Security Model

- Alchemy webhooks are authenticated with HMAC.
- The relayer re-fetches the Base receipt before minting.
- Minting only happens once the receipt block is at or below Base `safe`.
- Only the configured Solana `minting_authority` can call `deposit_collateral`.
- Solana replay markers keyed by `(base_tx_hash, log_index)` prevent duplicate minting.
- Operation logs are for support and observability only, not correctness.

## Admin API

The product app reads deposit status from:

- `GET /api/admin/deposits?limit=20`

Auth:

- `Authorization: Bearer <RELAYER_ADMIN_API_KEY>`

## Environment

- `ALCHEMY_P2P_WEBHOOK_SIGNING_KEY`
- `ALCHEMY_P2P_DEPOSIT_TOPIC0`
- `BASE_P2P_DEPOSIT_CONTRACT_ADDRESS`
- `BASE_RPC_URL`
- `BASE_SAFE_RECHECK_DELAYS_SECONDS` optional, defaults to `15,30,60,120`
- `SOLANA_MINTING_AUTHORITY_KEYPAIR`
- `SOLANA_RPC`
- `NEXT_PUBLIC_PROGRAM_ID`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `TRADESTARS_REDIS_KEY_PREFIX` optional, defaults to `ts-relayer` in production
- `RELAYER_ADMIN_API_KEY`

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```
