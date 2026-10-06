import { describe, expect, it } from 'vitest'
import { REAL_RECEIPT } from './__fixtures__/receipt'
import { decisionLogCsv } from './csv'
import { ago, money, toUnits } from './format'
import { memoToText, textToMemo } from './memo'
import { applyActivity, emptyState, isPrecompile, reconcileInvoices } from './state'
import type { Activity, LobbyState } from './types'

const OWNER = '0xbefc23124939b9f72e8e6491c340ff3602d3e634' as const
const SENDER = '0x540e77867a96394eb9df149936617b64e017a295' as const
const none: Activity = { blocked: [], claimed: [], inbound: [], outbound: [] }

// A real claim receipt captured from the Tempo testnet: 5.00 AlphaUSD from SENDER, memo "INV-1042".
const blocked = (): Activity => ({
  ...none,
  blocked: [{ nonce: 2853, amount: 5_000_000n, receipt: REAL_RECEIPT, txHash: '0xaa', block: 100 }],
})

describe('applyActivity', () => {
  it('decodes a real receipt into a held item', () => {
    const s = applyActivity(emptyState(), blocked(), OWNER)
    expect(s.held).toHaveLength(1)
    expect(s.held[0]).toMatchObject({ nonce: 2853, originator: SENDER, memoText: 'INV-1042', amount: '5000000', status: 'held' })
  })

  it('is idempotent: re-reading the same block range changes nothing', () => {
    const once = applyActivity(emptyState(), blocked(), OWNER)
    const twice = applyActivity(once, blocked(), OWNER)
    expect(twice.held).toHaveLength(1)
  })

  it('marks a claim to the owner as approved and a claim elsewhere as returned', () => {
    const base = applyActivity(emptyState(), blocked(), OWNER)
    const approved = applyActivity(base, { ...none, claimed: [{ nonce: 2853, to: OWNER, txHash: '0xbb', block: 101 }] }, OWNER)
    expect(approved.held[0]).toMatchObject({ status: 'approved', resolvedTx: '0xbb' })
    const returned = applyActivity(base, { ...none, claimed: [{ nonce: 2853, to: SENDER, txHash: '0xcc', block: 101 }] }, OWNER)
    expect(returned.held[0].status).toBe('returned')
  })

  it('ignores claims for payments it has not seen', () => {
    const s = applyActivity(emptyState(), { ...none, claimed: [{ nonce: 1, to: OWNER, txHash: '0xbb', block: 1 }] }, OWNER)
    expect(s.held).toHaveLength(0)
  })

  it('does not list releases from the guard as new direct payments', () => {
    const guard = '0xB10C000000000000000000000000000000000000'
    const s = applyActivity(
      emptyState(),
      { ...none, inbound: [{ id: 'a', ts: 1, txHash: '0xdd', from: guard, amount: 1n, memo: null, block: 5 }] },
      OWNER,
    )
    expect(s.credited).toHaveLength(0)
  })

  it('records direct payments once, with their reference', () => {
    const act: Activity = {
      ...none,
      inbound: [{ id: 'tx:1', ts: 50, txHash: '0xee', from: SENDER, amount: 1_000_000n, memo: textToMemo('INV-9'), block: 7 }],
    }
    const s = applyActivity(applyActivity(emptyState(), act, OWNER), act, OWNER)
    expect(s.credited).toHaveLength(1)
    expect(s.credited[0]).toMatchObject({ memoText: 'INV-9', amount: '1000000', ts: 50 })
  })

  it('learns counterparties from outgoing payments but skips fees, itself and precompiles', () => {
    const payee = '0xd1b7e89c298b6dfe54f3fe937a57cea1327086ee'
    const s = applyActivity(
      emptyState(),
      {
        ...none,
        outbound: [
          { to: payee, block: 10 },
          { to: payee, block: 12 },
          { to: '0xfeec000000000000000000000000000000000000', block: 11 },
          { to: OWNER, block: 13 },
        ],
      },
      OWNER,
    )
    expect(s.counterparties).toEqual([{ address: payee, count: 2, lastBlock: 12 }])
  })
})

describe('reconcileInvoices', () => {
  const invoiceState = (): LobbyState => ({
    ...emptyState(),
    invoices: [{ id: 'INV-1042', label: 'Globex', amount: '5000000', status: 'open', createdAt: 0 }],
  })

  it('settles an invoice once the matching payment is admitted', () => {
    const s = applyActivity(invoiceState(), blocked(), OWNER)
    expect(s.invoices[0].status).toBe('open') // held is not settled
    const done = applyActivity(s, { ...none, claimed: [{ nonce: 2853, to: OWNER, txHash: '0xbb', block: 101 }] }, OWNER)
    expect(done.invoices[0]).toMatchObject({ status: 'paid', paidTx: '0xbb' })
  })

  it('does not settle for an amount that is too small', () => {
    const s: LobbyState = {
      ...invoiceState(),
      credited: [{ id: 'x', ts: 0, txHash: '0x1', from: SENDER, amount: '4999999', memoText: 'INV-1042', block: 1 }],
    }
    expect(reconcileInvoices(s)[0].status).toBe('open')
  })

  it('settles on a direct payment of at least the invoice amount', () => {
    const s: LobbyState = {
      ...invoiceState(),
      credited: [{ id: 'x', ts: 0, txHash: '0x1', from: SENDER, amount: '6000000', memoText: 'INV-1042', block: 1 }],
    }
    expect(reconcileInvoices(s)[0]).toMatchObject({ status: 'paid', paidTx: '0x1' })
  })
})

describe('isPrecompile', () => {
  it('recognises protocol addresses', () => {
    expect(isPrecompile('0xfeec000000000000000000000000000000000000')).toBe(true)
    expect(isPrecompile('0xB10C000000000000000000000000000000000000')).toBe(true)
    expect(isPrecompile(SENDER)).toBe(false)
  })
})

describe('decisionLogCsv', () => {
  it('lists every payment with decision and transaction links, most recent first', () => {
    let s = applyActivity(emptyState(), blocked(), OWNER)
    s = applyActivity(s, { ...none, claimed: [{ nonce: 2853, to: OWNER, txHash: '0xbb', block: 101 }] }, OWNER)
    s = applyActivity(s, { ...none, inbound: [{ id: 'd', ts: 9, txHash: '0xdd', from: SENDER, amount: 1_000_000n, memo: null, block: 8 }] }, OWNER)
    const lines = decisionLogCsv(s).trim().split('\n')
    expect(lines[0]).toBe('time_utc,decision,amount,token,sender,reference,arrival_tx,decision_tx')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('admitted')
    expect(lines[1]).toContain('5.00')
    expect(lines[1]).toContain('INV-1042')
    expect(lines[1]).toContain('/tx/0xbb')
    expect(lines[2]).toContain('credited directly')
  })

  it('quotes fields that contain commas or quotes', () => {
    const s = { ...emptyState(), credited: [{ id: 'q', ts: 1, txHash: '0x1' as const, from: SENDER, amount: '1000000', memoText: 'a,"b"', block: 1 }] }
    expect(decisionLogCsv(s)).toContain('"a,""b"""')
  })
})

describe('helpers', () => {
  it('round-trips memos in the right-padded layout', () => {
    const memo = textToMemo('INV-1042')
    expect(memo.startsWith('0x494e562d31303432')).toBe(true)
    expect(memoToText(memo)).toBe('INV-1042')
  })
  it('reads left-padded memos too and rejects binary garbage', () => {
    expect(memoToText('0x0000000000000000000000000000000000000000000000494e562d31303432')).toBe('INV-1042')
    expect(memoToText('0xdeadbeef00000000000000000000000000000000000000000000000000000000')).toBe('')
    expect(memoToText(null)).toBe('')
  })
  it('formats money in six-decimal units', () => {
    expect(money(1_234_560_000n)).toBe('1,234.56')
    expect(toUnits('0.01')).toBe(10_000n)
    expect(toUnits(250)).toBe(250_000_000n)
  })
  it('formats relative time', () => {
    const now = 1_000_000_000_000
    expect(ago(1_000_000_000 - 30, now)).toBe('just now')
    expect(ago(1_000_000_000 - 300, now)).toBe('5 min ago')
    expect(ago(1_000_000_000 - 7200, now)).toBe('2 h ago')
  })
})
