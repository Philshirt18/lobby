import { DECIMALS } from './network'

const UNIT = 10 ** DECIMALS

export const toUnits = (amount: string | number): bigint => BigInt(Math.round(Number(amount) * UNIT))

export function money(units: bigint | string | number): string {
  return (Number(units) / UNIT).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export const short = (a: string) => a.slice(0, 6) + '…' + a.slice(-4)

export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor(now / 1000) - ts)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + ' min ago'
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'
  return Math.floor(s / 86400) + ' d ago'
}
