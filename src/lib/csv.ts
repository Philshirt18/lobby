import { EXPLORER, TOKEN } from './network'
import type { LobbyState } from './types'

const esc = (v: string | number) => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const iso = (ts: number) => new Date(ts * 1000).toISOString()
const amount = (units: string) => (Number(units) / 1e6).toFixed(2)

/**
 * One row per payment, most recent first: what arrived, what the desk decided, and the transaction
 * that proves it. Meant for the accountant.
 */
export function decisionLogCsv(state: LobbyState): string {
  const header = ['time_utc', 'decision', 'amount', 'token', 'sender', 'reference', 'arrival_tx', 'decision_tx']
  const rows: { ts: number; cols: (string | number)[] }[] = []
  for (const h of state.held) {
    const decision = h.status === 'held' ? 'waiting' : h.status === 'approved' ? 'admitted' : 'returned'
    rows.push({
      ts: h.blockedAt,
      cols: [iso(h.blockedAt), decision, amount(h.amount), h.token, h.originator, h.memoText, `${EXPLORER}/tx/${h.txHash}`, h.resolvedTx ? `${EXPLORER}/tx/${h.resolvedTx}` : ''],
    })
  }
  for (const c of state.credited) {
    rows.push({ ts: c.ts, cols: [c.ts ? iso(c.ts) : '', 'credited directly', amount(c.amount), TOKEN, c.from, c.memoText, `${EXPLORER}/tx/${c.txHash}`, ''] })
  }
  rows.sort((a, b) => b.ts - a.ts)
  return [header, ...rows.map((r) => r.cols)].map((r) => r.map(esc).join(',')).join('\n') + '\n'
}
