// End-to-end check against the Tempo testnet, no browser involved:
//   fresh account -> setup -> payments from three actors -> index -> assess -> admit / turn away.
// Run with `pnpm e2e`. Needs network access; uses the faucet.
import { createWalletClient, parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ABI, GUARD, REGISTRY, TOKEN, chain, makePublicClient, rpcTransport } from '../src/lib/network'
import { FIXTURES } from '../src/lib/fixtures'
import { admit, fundFromFaucet, preflight, sendPayment, setupLobby, turnAway } from '../src/lib/actions'
import { fetchActivityChunked, findSetup } from '../src/lib/indexer'
import { applyActivity, emptyState } from '../src/lib/state'
import { assess } from '../src/lib/risk'
import { toUnits } from '../src/lib/format'

const rpc = chain.rpcUrls.default.http[0]
const pub = makePublicClient(rpc)
const wallet = (key: `0x${string}`) => createWalletClient({ account: privateKeyToAccount(key), chain, transport: rpcTransport(rpc) })

let failures = 0
let state = emptyState()
let setupBlock = 0n
/** Read the chain until `done(state)` holds; the RPC log index can lag the head by a moment. */
async function sync(done: (s: typeof state) => boolean = () => true, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const head = await pub.getBlockNumber()
    state = applyActivity(state, await fetchActivityChunked(pub, me, setupBlock, head), me)
    if (done(state)) return
    await new Promise((r) => setTimeout(r, 1500))
  }
}
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
  if (!ok) failures++
}

const ownerKey = generatePrivateKey()
const owner = wallet(ownerKey)
const me = owner.account.address

console.log('Fresh owner', me)
await Promise.all([me, FIXTURES.acme.address, FIXTURES.impostor.address, FIXTURES.newcomer.address].map((a) => fundFromFaucet(rpc, a)))
await new Promise((r) => setTimeout(r, 3000))

const { policyId, block } = await setupLobby(owner, pub)
setupBlock = block
check('setup creates a policy and sets the receive policy', policyId > 0n, `policy ${policyId} at block ${block}`)

let found = await findSetup(pub, me, await pub.getBlockNumber())
for (let i = 0; i < 10 && !found; i++) {
  await new Promise((r) => setTimeout(r, 1500)) // the log index can trail the head
  found = await findSetup(pub, me, await pub.getBlockNumber())
}
check('findSetup recovers the policy on a fresh device', found?.policyId === String(policyId) && found.block === Number(block))

check('preflight: stranger would be held', (await preflight(pub, FIXTURES.newcomer.address, me)).outcome === 'held')

// Acme pays INV-1 while not yet on the whitelist -> held; then it becomes a guest.
await sendPayment(wallet(FIXTURES.acme.key), pub, me, toUnits(1), 'INV-1')
await sendPayment(wallet(FIXTURES.newcomer.key), pub, me, toUnits(250), 'INV-2')
await sendPayment(wallet(FIXTURES.impostor.key), pub, me, toUnits(0.01), '')

await sync((s) => s.held.length >= 3)
check('three payments are held', state.held.filter((h) => h.status === 'held').length === 3)

const ctx = (s: typeof state) => ({
  guests: s.guests,
  counterparties: s.counterparties,
  invoices: s.invoices,
  seenBefore: () => false,
  dustUnits: 1_000_000n,
})
state.invoices.push({ id: 'INV-2', label: 'Globex – licence', amount: toUnits(250).toString(), status: 'open', createdAt: 0 })
state.guests.push({ address: FIXTURES.acme.address.toLowerCase() as `0x${string}`, label: 'Acme GmbH', addedAt: 0 })

const byRef = (ref: string) => state.held.find((h) => h.memoText === ref)!
const impostor = state.held.find((h) => h.originator === FIXTURES.impostor.address.toLowerCase())!
const rImpostor = assess(impostor, ctx(state))
check('impostor is flagged as lookalike and rejected', rImpostor.recommendation === 'reject' && rImpostor.flags.some((f) => f.code === 'lookalike'))
check('invoice payment is recommended for admission', assess(byRef('INV-2'), ctx(state)).recommendation === 'approve')

await admit(owner, pub, byRef('INV-2'), { remember: true, policyId })
await turnAway(owner, pub, impostor)
await admit(owner, pub, byRef('INV-1'), { remember: false, policyId })

state = applyActivity(state, await fetchActivityChunked(pub, me, block, await pub.getBlockNumber()), me)
const status = (ref: string) => state.held.find((h) => h.memoText === ref)?.status
check('admitted payment shows as approved', status('INV-2') === 'approved' && status('INV-1') === 'approved')
check('impostor shows as returned', state.held.find((h) => h.originator === FIXTURES.impostor.address.toLowerCase())?.status === 'returned')
check('invoice INV-2 is settled', state.invoices.find((i) => i.id === 'INV-2')?.status === 'paid')

// Admit-and-remember whitelisted the newcomer in the same transaction: the next payment goes straight through.
check('preflight: remembered sender is credited', (await preflight(pub, FIXTURES.newcomer.address, me)).outcome === 'credited')
await sendPayment(wallet(FIXTURES.newcomer.key), pub, me, toUnits(5), 'INV-3')
await sync((s) => s.credited.some((c) => c.memoText === 'INV-3'))
check('second payment arrives directly', state.credited.some((c) => c.memoText === 'INV-3'))

// Outgoing payments feed the poisoning check: pay someone, then a lookalike of them is caught.
await sendPayment(owner, pub, FIXTURES.acme.address, parseUnits('1', 6), 'REFUND')
await sync((s) => s.counterparties.length > 0)
check('outgoing payee is remembered as counterparty', state.counterparties.some((c) => c.address === FIXTURES.acme.address.toLowerCase()))
void GUARD; void REGISTRY; void TOKEN; void ABI

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
