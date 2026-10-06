import { createWalletClient, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readBalance } from '../hooks/useBalance'
import { fundFromFaucet, sendPayment } from './actions'
import { FIXTURES } from './fixtures'
import { toUnits } from './format'
import { chain, makePublicClient, rpcTransport } from './network'

const pub = makePublicClient()
const RPC = chain.rpcUrls.default.http[0]

export type Scenario = 'regular' | 'newcomer' | 'impostor' | 'odd'

export const SCENARIOS: Record<Scenario, { who: keyof typeof FIXTURES; amount: string; ref: string }> = {
  regular: { who: 'acme', amount: '1', ref: 'INV-1043' },
  newcomer: { who: 'newcomer', amount: '250', ref: 'INV-2001' },
  impostor: { who: 'impostor', amount: '0.01', ref: '' },
  odd: { who: 'newcomer', amount: '13.37', ref: 'hello' },
}

/** Make sure a fixture wallet can pay (and pay fees): top it up from the faucet when it runs low. */
export async function ensureFunded(address: Address) {
  if ((await readBalance(address)) >= toUnits(5)) return
  await fundFromFaucet(RPC, address)
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1200))
    if ((await readBalance(address)) >= toUnits(5)) return
  }
}

/** Play the other side of the desk: one of the demo cast pays the connected account. */
export async function playScenario(scenario: Scenario, to: Address) {
  const s = SCENARIOS[scenario]
  const f = FIXTURES[s.who]
  await ensureFunded(f.address)
  const wallet = createWalletClient({ account: privateKeyToAccount(f.key), chain, transport: rpcTransport() })
  return sendPayment(wallet, pub, to, toUnits(s.amount), s.ref)
}
