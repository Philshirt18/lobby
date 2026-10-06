import { db } from './db'
import { cfg } from './config'

export type Severity = 'high' | 'medium' | 'low' | 'good'
export type Flag = { code: string; severity: Severity; text: string; ref?: string }
export type Recommendation = 'approve' | 'review' | 'reject'

export type HeldRow = {
  receiver: string
  nonce: number
  amount: string
  originator: string
  memo_text: string
}

type KnownRow = { address: string; label: string }
type InvoiceRow = { id: string; label: string; amount: string; status: string }

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
 * trust, hoping you copy it from your history later. 3+3 characters is already enough
 * to fool a quick visual check, so that is our threshold.
 */
export function findLookalike(address: string, known: KnownRow[]): KnownRow | undefined {
  const a = hex(address)
  return known.find((k) => {
    const b = hex(k.address)
    if (a === b) return false
    return commonPrefix(a, b) >= 3 && commonSuffix(a, b) >= 3
  })
}

export function assess(h: HeldRow): { flags: Flag[]; recommendation: Recommendation } {
  const flags: Flag[] = []
  const known = db.prepare('SELECT address, label FROM known').all() as KnownRow[]
  const sender = h.originator.toLowerCase()

  const lookalike = findLookalike(sender, known)
  if (lookalike) {
    flags.push({
      code: 'lookalike',
      severity: 'high',
      ref: lookalike.address,
      text: `Looks like your known sender "${lookalike.label}" (${lookalike.address.slice(0, 6)}…${lookalike.address.slice(-4)}) but is a different address`,
    })
  }

  if (BigInt(h.amount) < cfg.dustUnits) {
    flags.push({ code: 'dust', severity: 'medium', text: 'Tiny amount, typical of poisoning or tracking attempts' })
  }

  const seen = db
    .prepare('SELECT 1 FROM credited WHERE from_addr = ? UNION SELECT 1 FROM held WHERE originator = ? AND nonce != ?')
    .get(sender, sender, h.nonce)
  if (!known.some((k) => k.address.toLowerCase() === sender) && !seen) {
    flags.push({ code: 'first_seen', severity: 'low', text: 'First time this address has ever paid you' })
  }

  let invoiceExact = false
  if (h.memo_text) {
    const inv = db.prepare('SELECT id, label, amount, status FROM invoices WHERE id = ?').get(h.memo_text) as
      | InvoiceRow
      | undefined
    if (inv && inv.status === 'open') {
      if (BigInt(h.amount) === BigInt(inv.amount)) {
        invoiceExact = true
        flags.push({ code: 'invoice_exact', severity: 'good', text: `Memo and amount match open invoice ${inv.id} (${inv.label})` })
      } else {
        flags.push({ code: 'invoice_amount', severity: 'medium', text: `Memo matches ${inv.id} but the amount differs from the invoice` })
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
