import type { Address } from 'viem'
import { ago, money } from '../lib/format'
import { EXPLORER } from '../lib/network'
import type { Assessment } from '../lib/risk'
import type { HeldItem } from '../lib/types'

export type Act = 'approve' | 'remember' | 'return'

const GLYPH = { high: '✕', medium: '!', low: '·', good: '✓' } as const

const ADVICE = {
  approve: { head: 'Admit.', body: 'The invoice number and the amount both match.' },
  reject: { head: 'Turn away.', body: 'Do not copy this address from your history.' },
  review: { head: 'Your call.', body: 'Nothing marks this visitor as safe or dangerous.' },
} as const

export function TxLink({ hash, label = 'tx' }: { hash: string; label?: string }) {
  return (
    <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer">
      {label}&nbsp;↗
    </a>
  )
}

/** Marks the leading and trailing characters two addresses share: exactly what a poisoner imitates. */
export function DiffAddr({ addr, against }: { addr: string; against: string }) {
  const a = addr.toLowerCase().slice(2)
  const r = against.toLowerCase().slice(2)
  let p = 0
  let s = 0
  while (p < a.length && a[p] === r[p]) p++
  while (s < a.length - p && a[a.length - 1 - s] === r[r.length - 1 - s]) s++
  const raw = addr.slice(2)
  return (
    <>
      0x<span className="m">{raw.slice(0, p)}</span>
      {raw.slice(p, raw.length - s)}
      <span className="m">{raw.slice(raw.length - s)}</span>
    </>
  )
}

type Props = {
  item: HeldItem
  assessment: Assessment
  guestName: (a: Address) => string | null
  working: Act | null
  disabled: boolean
  now: number
  isNew: boolean
  index: number
  onAct: (act: Act) => void
}

export function Docket({ item: h, assessment: a, guestName, working, disabled, now, isNew, index, onAct }: Props) {
  const rec = a.recommendation
  const look = a.flags.find((f) => f.code === 'lookalike')
  const who = guestName(h.originator)
  const lbl = (act: Act, text: string) => (working === act ? 'Working…' : text)

  return (
    <article className={`docket ${rec === 'reject' ? 'reject' : rec === 'approve' ? 'approve' : ''} ${isNew ? 'enter' : ''}`} style={{ ['--i' as string]: index }}>
      <div className="stripe" />
      <div className="body">
        <div className="head">
          <div className="amt num">
            {money(h.amount)}
            <small>AlphaUSD</small>
          </div>
          <div className="when">
            {ago(h.blockedAt, now)} · <TxLink hash={h.txHash} label="held" />
          </div>
        </div>

        {look?.ref ? (
          <div className="specimen">
            <div className="t">Poses as {guestName(look.ref) ?? 'an address you know'}</div>
            <div className="ln">
              <span className="tag">Presented</span>
              <span className="addr"><DiffAddr addr={h.originator} against={look.ref} /></span>
            </div>
            <div className="ln">
              <span className="tag">On file</span>
              <span className="addr"><DiffAddr addr={look.ref} against={h.originator} /></span>
            </div>
          </div>
        ) : (
          <dl className="facts">
            <dt>From</dt>
            <dd className="mono small">
              {h.originator}
              {who ? ` · ${who}` : ''}
            </dd>
          </dl>
        )}

        <dl className="facts tight">
          <dt>Ref.</dt>
          <dd>{h.memoText ? <span className="mono small">{h.memoText}</span> : <span className="none">no reference given</span>}</dd>
        </dl>

        {a.flags.length > 0 && (
          <ul className="notes">
            {a.flags.map((f) => (
              <li key={f.code} className={f.severity}>
                <span className="g">{GLYPH[f.severity]}</span>
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        )}

        <p className={`advice ${rec}`}>
          <span className="kicker">The desk advises</span>
          <br />
          <em>{ADVICE[rec].head}</em> <span>{ADVICE[rec].body}</span>
        </p>

        <div className="acts">
          <button className={'btn ' + (rec === 'approve' ? 'solid' : '')} disabled={disabled} onClick={() => onAct('approve')}>
            {lbl('approve', 'Admit')}
          </button>
          <button className="btn" disabled={disabled} onClick={() => onAct('remember')} title="Admit now and put this sender on your guest list, so future payments arrive directly">
            {lbl('remember', 'Admit & remember')}
          </button>
          <button className={'btn red ' + (rec === 'reject' ? 'solid' : '')} disabled={disabled} onClick={() => onAct('return')}>
            {lbl('return', 'Turn away')}
          </button>
        </div>
      </div>
    </article>
  )
}

