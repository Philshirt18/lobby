import type { Address } from 'viem'
import { money, short } from './format'
import { TOKEN } from './network'
import type { Counterparty, Flag, Guest, HeldItem, Invoice, Recommendation } from './types'

const hex = (a: string) => a.toLowerCase().replace(/^0x/, '')

function commonPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function commonSuffix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}

/**
 * Address poisoning: the attacker mines an address that starts and ends like one you
 * trust, hoping you copy it from your history later. Three matching characters at each
 * end already fool a quick visual check, so that is the threshold.
 */
export function isLookalike(a: string, b: string, minEnds = 3): boolean {
  const x = hex(a)
  const y = hex(b)
  if (x === y) return false
  return commonPrefix(x, y) >= minEnds && commonSuffix(x, y) >= minEnds
}

export type RiskContext = {
  guests: Guest[]
  counterparties: Counterparty[]
  invoices: Invoice[]
  /** Everything that already happened with this sender (credited or held). */
  seenBefore: (address: Address, excludeNonce: number) => boolean
  dustUnits: bigint
}

export type Assessment = { flags: Flag[]; recommendation: Recommendation }

export function assess(h: HeldItem, ctx: RiskContext): Assessment {
  const flags: Flag[] = []
  const sender = h.originator.toLowerCase() as Address
  const isGuest = ctx.guests.some((g) => g.address.toLowerCase() === sender)
  const isCounterparty = ctx.counterparties.some((c) => c.address.toLowerCase() === sender)

  // Look-alikes of the guest list first (named), then of everyone you ever paid (unnamed).
  const guestMatch = ctx.guests.find((g) => isLookalike(sender, g.address))
  const payeeMatch = guestMatch ? undefined : ctx.counterparties.find((c) => isLookalike(sender, c.address))
  if (guestMatch) {
    flags.push({
      code: 'lookalike',
      severity: 'high',
      ref: guestMatch.address,
      text: `Looks like your guest "${guestMatch.label}" (${guestMatch.address.slice(0, 6)}…${guestMatch.address.slice(-4)}) but is a different address`,
    })
  } else if (payeeMatch) {
    flags.push({
      code: 'lookalike',
      severity: 'high',
      ref: payeeMatch.address,
      text: `Looks like an address you paid before (${payeeMatch.address.slice(0, 6)}…${payeeMatch.address.slice(-4)}) but is a different address`,
    })
  }

  const otherToken = h.token.toLowerCase() !== TOKEN
  if (otherToken) {
    flags.push({ code: 'other_token', severity: 'medium', text: `Paid in a token other than AlphaUSD (${short(h.token)}). Unsolicited tokens are a common lure.` })
  }

  if (BigInt(h.amount) < ctx.dustUnits) {
    flags.push({ code: 'dust', severity: 'medium', text: 'Tiny amount, typical of poisoning or tracking attempts' })
  }

  if (isCounterparty && !guestMatch && !payeeMatch) {
    flags.push({ code: 'paid_before', severity: 'good', text: 'You have paid this address before' })
  } else if (!isGuest && !isCounterparty && !ctx.seenBefore(sender, h.nonce)) {
    flags.push({ code: 'first_seen', severity: 'low', text: 'First time this address has ever paid you' })
  }

  let invoiceExact = false
  if (h.memoText && !otherToken) {
    const inv = ctx.invoices.find((i) => i.id === h.memoText)
    if (inv && inv.status === 'open') {
      if (BigInt(h.amount) === BigInt(inv.amount)) {
        invoiceExact = true
        flags.push({ code: 'invoice_exact', severity: 'good', text: `Reference and amount match open invoice ${inv.id} (${inv.label})` })
      } else {
        flags.push({
          code: 'invoice_amount',
          severity: 'medium',
          text: `Reference matches ${inv.id}, but the amount differs: expected ${money(inv.amount)}, got ${money(h.amount)}`,
        })
      }
    } else if (inv) {
      flags.push({ code: 'invoice_paid', severity: 'medium', text: `Invoice ${inv.id} is already settled` })
    }
  }

  const hasHigh = flags.some((f) => f.severity === 'high')
  const hasMedium = flags.some((f) => f.severity === 'medium')
  const recommendation: Recommendation = hasHigh ? 'reject' : invoiceExact && !hasMedium ? 'approve' : 'review'
  return { flags, recommendation }
}
