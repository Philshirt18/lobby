/** Turn wallet and RPC errors into one calm sentence. */
export function errorText(e: unknown): string {
  const raw = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e)
  const text = raw.split('\n')[0]
  if (/user rejected|user denied|cancell?ed|NotAllowedError|aborted/i.test(`${e instanceof Error ? e.name : ''} ${raw}`)) return 'Cancelled.'
  if (/rate limited|exceeds defined limit/i.test(raw)) return 'The test network is busy. Please try again in a moment.'
  if (/insufficient|exceeds balance|fee/i.test(raw) && /funds|balance/i.test(raw)) return 'This account has no test money for fees. Use "Get test money" first.'
  return text.length > 160 ? text.slice(0, 157) + '…' : text
}
