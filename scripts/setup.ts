// One-time setup: creates the sender whitelist (administered by the DESK key) and points the
// owner's receive policy at it. Needs the OWNER key once; afterwards the app only uses the DESK key.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { createWalletClient, http, parseEventLogs, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoModerato } from 'viem/chains'
import { cfg } from '../src/config'
import { REGISTRY, publicClient, registryAbi, deskAccount } from '../src/chain'

const ownerKey = process.env.OWNER_KEY as Hex | undefined
if (!ownerKey) throw new Error('OWNER_KEY is needed for the one-time setup')
const owner = createWalletClient({ account: privateKeyToAccount(ownerKey), chain: tempoModerato, transport: http(cfg.rpcUrl) })

const WHITELIST = 0
const seed = (process.env.CUSTOMER_ADDRESS ? [process.env.CUSTOMER_ADDRESS] : []) as Hex[]

const createHash = await owner.writeContract({
  address: REGISTRY, abi: registryAbi, functionName: 'createPolicyWithAccounts',
  args: [deskAccount.address, WHITELIST, seed],
} as never)
const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash })
const [created] = parseEventLogs({ abi: registryAbi, eventName: 'PolicyCreated', logs: createReceipt.logs })
const policyId = created.args.policyId
console.log('Whitelist policy', policyId.toString(), 'admin =', deskAccount.address)

const setHash = await owner.writeContract({
  address: REGISTRY, abi: registryAbi, functionName: 'setReceivePolicy',
  args: [policyId, 1n, deskAccount.address],
} as never)
await publicClient.waitForTransactionReceipt({ hash: setHash })
console.log('Receive policy set for', owner.account.address, '(recovery authority = desk)')

const envText = readFileSync('.env', 'utf8')
if (/^POLICY_ID=/m.test(envText)) writeFileSync('.env', envText.replace(/^POLICY_ID=.*$/m, `POLICY_ID=${policyId}`))
else appendFileSync('.env', `POLICY_ID=${policyId}\n`)
console.log('Saved POLICY_ID to .env')
