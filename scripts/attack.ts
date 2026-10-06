// Demo helper: plays the other side. Usage: pnpm attack <scenario>
//   customer   whitelisted customer pays INV-1043 (credited directly)
//   stranger   unknown company pays INV-2001 (held, recommended for approval)
//   poison     dust payment from the address that imitates your customer (held, flagged)
//   spam       unknown sender, random memo, odd amount (held, needs review)
import { createWalletClient, http, parseUnits, stringToHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoModerato } from 'viem/chains'
import { cfg } from '../src/config'
import { publicClient, tip20Abi } from '../src/chain'

const scenario = process.argv[2]
const key = (name: string) => {
  const v = process.env[name] as Hex | undefined
  if (!v) throw new Error(`${name} missing in .env`)
  return v
}
const plan: Record<string, { key: string; amount: string; memo: string }> = {
  customer: { key: 'CUSTOMER_KEY', amount: '1', memo: 'INV-1043' },
  stranger: { key: 'STRANGER_KEY', amount: '250', memo: 'INV-2001' },
  poison: { key: process.env.LOOKALIKE_KEY ? 'LOOKALIKE_KEY' : 'STRANGER_KEY', amount: '0.01', memo: '' },
  spam: { key: 'STRANGER_KEY', amount: '13.37', memo: 'hello' },
}
const p = plan[scenario]
if (!p) throw new Error(`Unknown scenario "${scenario}". Use: ${Object.keys(plan).join(', ')}`)

const account = privateKeyToAccount(key(p.key))
const client = createWalletClient({ account, chain: tempoModerato, transport: http(cfg.rpcUrl) })
const hash = await client.writeContract({
  address: cfg.token, abi: tip20Abi, functionName: 'transferWithMemo',
  args: [cfg.owner, parseUnits(p.amount, 6), stringToHex(p.memo, { size: 32 })],
} as never)
await publicClient.waitForTransactionReceipt({ hash })
console.log(`${scenario}: ${account.address} sent ${p.amount} with memo "${p.memo}" -> ${hash}`)
