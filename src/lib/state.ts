import type { Address, Hex } from 'viem'
import { ReceivePolicyReceipt } from 'viem/tempo'
import { GUARD, TOKEN } from './network'
import { memoToText } from './memo'
import type { Activity, Counterparty, Credited, HeldItem, Invoice, LobbyState } from './types'

export function emptyState(): LobbyState {
  return { version: 1, setup: null, cursor: null, held: [], credited: [], counterparties: [], invoices: [], guests: [] }
}

/** Precompiles look like 0xfeec000…000 (fee manager, guard, registry): never a human counterparty. */
export function isPrecompile(a: string): boolean {
  return /^0x[0-9a-f]{4}0{36}$/i.test(a)
}

/** Browser and chain clocks drift a little; a payment may count if it is at most this many seconds older than the invoice. */
const CLOCK_SLACK = 30

/**
 * Settle every open invoice that has a matching credited or admitted payment. Only payments that came
 * after the invoice was created count: an old payment must never settle a new invoice.
 */
export function reconcileInvoices(state: LobbyState): Invoice[] {
  return state.invoices.map((inv) => {
    if (inv.status === 'paid') return inv
    const need = BigInt(inv.amount)
    const since = inv.createdAt - CLOCK_SLACK
    const direct = state.credited.find((c) => c.memoText === inv.id && BigInt(c.amount) >= need && c.ts >= since)
    if (direct) return { ...inv, status: 'paid' as const, paidTx: direct.txHash }
    const admitted = state.held.find((h) => h.status === 'approved' && h.token === TOKEN && h.memoText === inv.id && BigInt(h.amount) >= need && h.blockedAt >= since)
    if (admitted) return { ...inv, status: 'paid' as const, paidTx: admitted.resolvedTx }
    return inv
  })
}

/** Merge freshly indexed chain activity into the state. Pure and idempotent. */
export function applyActivity(state: LobbyState, act: Activity, owner: Address): LobbyState {
  const held = [...state.held]
  for (const b of act.blocked) {
    if (held.some((h) => h.nonce === b.nonce)) continue
    const r = ReceivePolicyReceipt.decode(b.receipt)
    const memo = (r.memo ?? null) as Hex | null
    held.push({
      nonce: b.nonce,
      token: r.token.toLowerCase() as Address,
      amount: b.amount.toString(),
      originator: r.originator.toLowerCase() as Address,
      memo,
      memoText: memoToText(memo),
      blockedAt: Number(r.blockedAt),
      txHash: b.txHash,
      block: b.block,
      receipt: b.receipt,
      status: 'held',
    })
  }
  for (const c of act.claimed) {
    const i = held.findIndex((h) => h.nonce === c.nonce)
    if (i < 0) continue
    held[i] = {
      ...held[i],
      status: c.to.toLowerCase() === owner.toLowerCase() ? 'approved' : 'returned',
      resolvedTx: c.txHash,
      resolvedTo: c.to.toLowerCase() as Address,
    }
  }
  held.sort((a, b) => b.blockedAt - a.blockedAt)

  const credited: Credited[] = [...state.credited]
  for (const t of act.inbound) {
    if (t.from.toLowerCase() === GUARD.toLowerCase()) continue // released from the lobby: shown there
    if (credited.some((c) => c.id === t.id)) continue
    credited.push({
      id: t.id,
      ts: t.ts,
      txHash: t.txHash,
      from: t.from.toLowerCase() as Address,
      amount: t.amount.toString(),
      memoText: memoToText(t.memo),
      block: t.block,
    })
  }
  credited.sort((a, b) => b.block - a.block)

  const counterparties = new Map<string, Counterparty>(state.counterparties.map((c) => [c.address.toLowerCase(), c]))
  for (const o of act.outbound) {
    const key = o.to.toLowerCase()
    if (isPrecompile(key) || key === owner.toLowerCase()) continue
    const prev = counterparties.get(key)
    counterparties.set(key, { address: key as Address, count: (prev?.count ?? 0) + 1, lastBlock: Math.max(prev?.lastBlock ?? 0, o.block) })
  }

  const next: LobbyState = { ...state, held, credited, counterparties: [...counterparties.values()] }
  return { ...next, invoices: reconcileInvoices(next) }
}
