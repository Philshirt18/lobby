import type { Address, Hex } from 'viem'

export type HeldStatus = 'held' | 'approved' | 'returned'

/** A payment the receive policy kept in the guard. */
export type HeldItem = {
  nonce: number
  /** The TIP-20 token that was held. Everything but AlphaUSD is shown with its address. */
  token: Address
  amount: string
  originator: Address
  memo: Hex | null
  memoText: string
  blockedAt: number
  txHash: Hex
  block: number
  /** ABI-encoded claim receipt, needed to release the funds. */
  receipt: Hex
  status: HeldStatus
  resolvedTx?: Hex
  resolvedTo?: Address
}

/** A payment that arrived directly because the sender is on the whitelist. */
export type Credited = {
  id: string
  ts: number
  txHash: Hex
  from: Address
  amount: string
  memoText: string
  block: number
}

/** An address the owner has paid. These are the addresses a poisoner wants to imitate. */
export type Counterparty = { address: Address; count: number; lastBlock: number }

export type Invoice = {
  id: string
  label: string
  amount: string
  status: 'open' | 'paid'
  paidTx?: Hex
  createdAt: number
}

export type Guest = { address: Address; label: string; addedAt: number }

export type LobbyState = {
  version: 1
  setup: { policyId: string; block: number } | null
  cursor: number | null
  held: HeldItem[]
  credited: Credited[]
  counterparties: Counterparty[]
  invoices: Invoice[]
  guests: Guest[]
}

export type Activity = {
  blocked: { nonce: number; amount: bigint; receipt: Hex; txHash: Hex; block: number }[]
  claimed: { nonce: number; to: Address; txHash: Hex; block: number }[]
  inbound: { id: string; ts: number; txHash: Hex; from: Address; amount: bigint; memo: Hex | null; block: number }[]
  outbound: { to: Address; block: number }[]
}

export type Severity = 'high' | 'medium' | 'low' | 'good'
export type Flag = { code: string; severity: Severity; text: string; ref?: Address }
export type Recommendation = 'approve' | 'review' | 'reject'
