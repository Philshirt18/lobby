# Lobby – Feasibility notes (Tempo Testnet "Moderato")

Verified 2026-10-06 with Foundry cast 1.8.5.

- RPC: https://rpc.moderato.tempo.xyz, chain id 42431, token AlphaUSD 0x20c0…0001 (6 decimals)
- Faucet: `cast rpc tempo_fundAddress <addr> --rpc-url $RPC_URL` (1,000,000 AlphaUSD)
- Fees are paid in AlphaUSD, no native gas token needed.
- Precompiles: TIP-403 registry 0x403c…0000, ReceivePolicyGuard 0xB10C…0000 (both live on testnet)
- Wallets/keys: see `.env` (gitignored; testnet-only throwaway keys). Roles: OWNER, DESK (recovery authority), CUSTOMER (whitelisted), STRANGER.

## Flow that works end to end
1. `cast tip403 create whitelist --admin $OWNER --member $CUSTOMER` -> policy id from PolicyCreated event topic[1] (testnet: 1252689)
2. `cast receive-policy set <policyId> 1 --recovery-authority $DESK` (token filter 1 = allow all)
3. `cast receive-policy validate $TOKEN $SENDER $OWNER` predicts `credited` or `held` without sending.
4. Unknown sender calls `transferWithMemo(address,uint256,bytes32)` -> tx succeeds, funds go to the guard.
5. Guard event: `TransferBlocked(address indexed token, address indexed receiver, uint64 indexed blockedNonce, uint256 amount, uint8 receiptVersion, bytes receipt)`
   topic0 = 0x361d86e46fd139dc3eac4148f16b53597f0f8ddd9aba772aae0034bda5531b1c
   data = abi(amount, version, bytes receipt); receipt is 320 bytes and contains originator, memo, nonce.
6. Release: `cast receive-policy claim <to> <receipt>` signed by DESK.
   - `to` = OWNER -> resume (approve)
   - `to` = originator -> reroute (return to sender)
7. Whitelisted sender (CUSTOMER) is credited directly, guard is not involved.

## Notes for the build
- Receipts are not enumerable on-chain: the indexer must store every TransferBlocked event.
- `cast receive-policy receipt decode|balance <receipt>` is handy for checking state.
- "Approve and remember" = `modifyPolicyWhitelist(policyId, sender, true)` (OWNER is policy admin) + resume claim.

## Build status (Tue 2026-10-06)
Backend done and verified against the testnet: `pnpm setup` (once), `pnpm start` (API + indexer on :8787),
`pnpm seed`, `pnpm attack <customer|stranger|poison|spam>`, `pnpm mine` (lookalike address), `pnpm check`.
- API: GET /api/state, POST /api/held/:nonce/approve {remember,label}, POST /api/held/:nonce/return,
  POST /api/invoices, POST /api/known
- Verified: whitelisted sender credited directly; unknown sender held; approve+remember whitelists and releases;
  return-to-sender; lookalike dust flagged `reject`; invoices auto-settle.
- Gotchas: memos must be right-padded bytes32 (`stringToHex(s,{size:32})`); kill the old server before restarting
  (stale process kept the port and a deleted DB).
- Dashboard done (public/index.html, no build step): tiles, lobby cards with address comparison, one-click
  Let in / Let in & remember / Send back, inbox, invoices, known senders, demo controls (DEMO_MODE=1), dark mode, mobile.
- `pnpm reset` = fresh demo state (new whitelist, empty DB, seed). Then `pnpm start` and open http://localhost:8787.
- TODO: README + architecture diagram, tests, deploy, demo video, pitch text, Telegram (stretch).
