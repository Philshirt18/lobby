import type { Address, Hex } from 'viem'
import { cfg } from './config'
import { GUARD, REGISTRY, deskClient, guardAbi, publicClient, registryAbi } from './chain'
import { db } from './db'
import { reconcileInvoices } from './indexer'

type HeldRecord = {
  nonce: number
  originator: Address
  receipt: Hex
  status: string
}

function getHeld(nonce: number): HeldRecord {
  const row = db.prepare('SELECT nonce, originator, receipt, status FROM held WHERE receiver = ? AND nonce = ?').get(cfg.owner, nonce) as HeldRecord | undefined
  if (!row) throw new Error(`No held payment with nonce ${nonce}`)
  if (row.status !== 'held') throw new Error(`Payment ${nonce} is already ${row.status}`)
  return row
}

async function send(request: Parameters<typeof deskClient.writeContract>[0]): Promise<Hex> {
  const hash = await deskClient.writeContract(request)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted`)
  return hash
}

function resolve(nonce: number, status: 'approved' | 'returned', to: Address, tx: Hex) {
  db.prepare('UPDATE held SET status = ?, resolved_tx = ?, resolved_to = ? WHERE receiver = ? AND nonce = ?').run(status, tx, to.toLowerCase(), cfg.owner, nonce)
}

/** Let the payment in. With `remember`, the sender is also added to the whitelist and the known list. */
export async function approve(nonce: number, opts: { remember?: boolean; label?: string } = {}) {
  const h = getHeld(nonce)
  let whitelistTx: Hex | undefined
  if (opts.remember) {
    if (cfg.policyId === undefined) throw new Error('POLICY_ID is not set, run `pnpm setup` first')
    whitelistTx = await send({
      address: REGISTRY,
      abi: registryAbi,
      functionName: 'modifyPolicyWhitelist',
      args: [cfg.policyId, h.originator, true],
    } as never)
    db.prepare('INSERT OR REPLACE INTO known (address, label, added_at) VALUES (?, ?, ?)').run(
      h.originator.toLowerCase(),
      opts.label?.trim() || `Approved ${h.originator.slice(0, 6)}…${h.originator.slice(-4)}`,
      Math.floor(Date.now() / 1000),
    )
  }
  const tx = await send({ address: GUARD, abi: guardAbi, functionName: 'claim', args: [cfg.owner, h.receipt] } as never)
  resolve(nonce, 'approved', cfg.owner, tx)
  reconcileInvoices()
  return { tx, whitelistTx }
}

/** Send the money back to whoever sent it. */
export async function returnToSender(nonce: number) {
  const h = getHeld(nonce)
  const tx = await send({ address: GUARD, abi: guardAbi, functionName: 'claim', args: [h.originator, h.receipt] } as never)
  resolve(nonce, 'returned', h.originator, tx)
  return { tx }
}
