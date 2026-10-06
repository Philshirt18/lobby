import 'dotenv/config'
import type { Address, Hex } from 'viem'

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var ${name} (see .env.example)`)
  return v
}

export const cfg = {
  rpcUrl: need('RPC_URL'),
  token: need('TOKEN').toLowerCase() as Address,
  owner: need('OWNER_ADDRESS').toLowerCase() as Address,
  deskKey: need('DESK_KEY') as Hex,
  // Created by `pnpm setup`; optional so that the setup script itself can load the config.
  policyId: process.env.POLICY_ID ? BigInt(process.env.POLICY_ID) : undefined,
  startBlock: process.env.START_BLOCK ? BigInt(process.env.START_BLOCK) : undefined,
  port: Number(process.env.PORT ?? 8787),
  demo: process.env.DEMO_MODE === '1',
  dbPath: process.env.DB_PATH ?? 'lobby.db',
  dustUnits: BigInt(process.env.DUST_UNITS ?? 1_000_000), // 1.00 token (6 decimals)
}
