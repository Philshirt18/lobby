import { describe, expect, it } from 'vitest'
import { assess, isLookalike, type RiskContext } from './risk'
import type { Counterparty, Guest, HeldItem, Invoice } from './types'

const ACME = '0xd1b7e89c298b6dfe54f3fe937a57cea1327086ee' as const
const IMPOSTOR = '0xd1bdf001039967455c1eff92230404423ce326ee' as const // same first/last 3 chars as ACME
const STRANGER = '0x540e77867a96394eb9df149936617b64e017a295' as const

const held = (over: Partial<HeldItem> = {}): HeldItem => ({
  nonce: 1,
  amount: '5000000',
  originator: STRANGER,
  memo: null,
  memoText: '',
  blockedAt: 1,
  txHash: '0x00',
  block: 1,
  receipt: '0x00',
  status: 'held',
  ...over,
})

const ctx = (over: Partial<RiskContext> = {}): RiskContext => ({
  guests: [],
  counterparties: [],
  invoices: [],
  seenBefore: () => false,
  dustUnits: 1_000_000n,
  ...over,
})

const guest = (address: `0x${string}`, label: string): Guest => ({ address, label, addedAt: 0 })
const payee = (address: `0x${string}`): Counterparty => ({ address, count: 1, lastBlock: 1 })
const invoice = (id: string, amount: string, status: Invoice['status'] = 'open'): Invoice => ({
  id,
  label: 'Acme – consulting',
  amount,
  status,
  createdAt: 0,
})

describe('isLookalike', () => {
  it('matches addresses that share three characters at both ends', () => {
    expect(isLookalike(IMPOSTOR, ACME)).toBe(true)
  })
  it('is case-insensitive and ignores the 0x prefix', () => {
    expect(isLookalike(IMPOSTOR.toUpperCase().replace('0X', '0x'), ACME)).toBe(true)
  })
  it('does not flag the identical address', () => {
    expect(isLookalike(ACME, ACME)).toBe(false)
  })
  it('does not flag a match at only one end', () => {
    expect(isLookalike('0xd1b0000000000000000000000000000000000000', ACME)).toBe(false)
    expect(isLookalike('0x0000000000000000000000000000000000006ee0', ACME)).toBe(false)
  })
  it('does not flag two unrelated addresses', () => {
    expect(isLookalike(STRANGER, ACME)).toBe(false)
  })
  it('respects a stricter threshold', () => {
    expect(isLookalike(IMPOSTOR, ACME, 4)).toBe(false)
  })
})

describe('assess: address poisoning', () => {
  it('rejects a lookalike of a named guest and points at the real address', () => {
    const r = assess(held({ originator: IMPOSTOR, amount: '10000' }), ctx({ guests: [guest(ACME, 'Acme GmbH')] }))
    expect(r.recommendation).toBe('reject')
    const flag = r.flags.find((f) => f.code === 'lookalike')
    expect(flag?.severity).toBe('high')
    expect(flag?.ref).toBe(ACME)
    expect(flag?.text).toContain('Acme GmbH')
  })

  it('also protects addresses you only ever paid (outgoing history), without a name', () => {
    const r = assess(held({ originator: IMPOSTOR }), ctx({ counterparties: [payee(ACME)] }))
    expect(r.recommendation).toBe('reject')
    expect(r.flags.find((f) => f.code === 'lookalike')?.text).toContain('paid before')
  })

  it('flags dust as medium', () => {
    const r = assess(held({ amount: '10000' }), ctx())
    expect(r.flags.some((f) => f.code === 'dust' && f.severity === 'medium')).toBe(true)
  })

  it('does not treat a normal amount as dust', () => {
    expect(assess(held({ amount: '1000000' }), ctx()).flags.some((f) => f.code === 'dust')).toBe(false)
  })
})

describe('assess: invoices', () => {
  it('recommends admission when reference and amount match an open invoice', () => {
    const r = assess(held({ memoText: 'INV-7', amount: '250000000' }), ctx({ invoices: [invoice('INV-7', '250000000')] }))
    expect(r.recommendation).toBe('approve')
    expect(r.flags.some((f) => f.code === 'invoice_exact')).toBe(true)
  })

  it('asks for review when the amount differs', () => {
    const r = assess(held({ memoText: 'INV-7', amount: '240000000' }), ctx({ invoices: [invoice('INV-7', '250000000')] }))
    expect(r.recommendation).toBe('review')
    expect(r.flags.find((f) => f.code === 'invoice_amount')?.text).toContain('expected 250.00')
  })

  it('warns when the invoice is already settled', () => {
    const r = assess(held({ memoText: 'INV-7', amount: '250000000' }), ctx({ invoices: [invoice('INV-7', '250000000', 'paid')] }))
    expect(r.recommendation).toBe('review')
    expect(r.flags.some((f) => f.code === 'invoice_paid')).toBe(true)
  })

  it('never recommends admission for a lookalike, even with a matching invoice', () => {
    const r = assess(
      held({ originator: IMPOSTOR, memoText: 'INV-7', amount: '250000000' }),
      ctx({ guests: [guest(ACME, 'Acme GmbH')], invoices: [invoice('INV-7', '250000000')] }),
    )
    expect(r.recommendation).toBe('reject')
  })
})

describe('assess: trust signals', () => {
  it('marks a first-time sender', () => {
    expect(assess(held(), ctx()).flags.some((f) => f.code === 'first_seen')).toBe(true)
  })
  it('does not mark a sender seen before', () => {
    expect(assess(held(), ctx({ seenBefore: () => true })).flags.some((f) => f.code === 'first_seen')).toBe(false)
  })
  it('notes when you have paid the sender before', () => {
    const r = assess(held(), ctx({ counterparties: [payee(STRANGER)] }))
    expect(r.flags.some((f) => f.code === 'paid_before' && f.severity === 'good')).toBe(true)
    expect(r.recommendation).toBe('review')
  })
  it('asks for review when nothing is known either way', () => {
    expect(assess(held(), ctx()).recommendation).toBe('review')
  })
})
