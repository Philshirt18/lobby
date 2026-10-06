import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { isAddress, type Address, type Hex } from 'viem'
import { pub, useWallet } from '../hooks/useChain'
import type { Route } from '../hooks/useHash'
import { useToast } from '../hooks/useToast'
import { fundFromFaucet, preflight, sendPayment, type Preflight } from '../lib/actions'
import { errorText } from '../lib/errors'
import { money, short, toUnits } from '../lib/format'
import { chain } from '../lib/network'
import { paymentStatus, type PaymentStatus } from '../lib/track'
import { Connect } from './Connect'
import { TxLink } from './Docket'

type Props = { route: Route; balance: bigint | null; refreshBalance: () => void }
type Check = Preflight | 'loading' | 'error' | null

/**
 * The sender's side of the story. A transfer to a protected account can succeed on-chain and still not arrive,
 * so this page asks the network first, says plainly what will happen, and then follows the payment to the end.
 */
export function Pay({ route, balance, refreshBalance }: Props) {
  const { address: sender, status } = useAccount()
  const wallet = useWallet()
  const { toast } = useToast()
  const query = route.params.toString()
  const [to, setTo] = useState(route.params.get('to') ?? '')
  const [amount, setAmount] = useState(route.params.get('amount') ?? '')
  const [reference, setReference] = useState(route.params.get('ref') ?? '')
  const [check, setCheck] = useState<Check>(null)
  const [sending, setSending] = useState(false)
  const [funding, setFunding] = useState(false)
  const [sent, setSent] = useState<{ hash: Hex; to: Address; units: bigint } | null>(null)

  // A pay link (#/pay?to=…&amount=…&ref=…) fills the form in.
  useEffect(() => {
    const p = new URLSearchParams(query)
    if (p.get('to')) setTo(p.get('to')!)
    if (p.get('amount')) setAmount(p.get('amount')!)
    if (p.get('ref')) setReference(p.get('ref')!)
    setSent(null)
  }, [query])

  const toValid = isAddress(to)
  const units = Number(amount) > 0 ? toUnits(amount) : 0n
  const refValid = /^[\x20-\x7e]{0,32}$/.test(reference)
  const self = !!sender && toValid && to.toLowerCase() === sender.toLowerCase()

  useEffect(() => {
    if (!sender || !toValid || self) return setCheck(null)
    setCheck('loading')
    let cancelled = false
    const id = setTimeout(() => {
      preflight(pub, sender, to as Address).then(
        (r) => !cancelled && setCheck(r),
        () => !cancelled && setCheck('error'),
      )
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [sender, to, toValid, self])

  async function send() {
    if (!wallet || !toValid || units <= 0n) return
    setSending(true)
    try {
      const hash = await sendPayment(wallet, pub, to as Address, units, reference)
      setSent({ hash, to: to as Address, units })
      refreshBalance()
    } catch (e) {
      toast(errorText(e), true)
    }
    setSending(false)
  }

  async function fund() {
    if (!sender) return
    setFunding(true)
    try {
      await fundFromFaucet(chain.rpcUrls.default.http[0], sender)
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1200))
        refreshBalance()
      }
      toast('Test money received.')
    } catch (e) {
      toast(errorText(e), true)
    }
    setFunding(false)
  }

  const poor = sender && balance !== null && balance < units + 100_000n
  const canSend = !!wallet && toValid && !self && units > 0n && refValid && !sending && !poor

  return (
    <div className="paywrap">
      <section className="sec">
        <h2>
          <span className="r">§</span> Send a payment
        </h2>
        <p className="sub">See what will happen before you send. Some accounts keep unknown senders waiting in a lobby until the owner agrees.</p>

        {!sender && status !== 'reconnecting' && status !== 'connecting' && <Connect intro="Sign in first, so the network can tell you how your payment will be treated." />}

        {sender && (
          <p className="note">
            Paying from {short(sender)} · balance {balance === null ? '…' : money(balance)} AlphaUSD
            {balance !== null && balance < 1_000_000n && (
              <>
                {' · '}
                <button className="linkish" disabled={funding} onClick={fund}>{funding ? 'fetching…' : 'get test money'}</button>
              </>
            )}
          </p>
        )}

        <form className="add stack" onSubmit={(e) => { e.preventDefault(); void send() }} autoComplete="off">
          <label>Recipient<input className="mono" value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x…" required /></label>
          <div className="row2">
            <label>Amount (AlphaUSD)<input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0.01" placeholder="0.00" required /></label>
            <label>Reference (invoice number)<input className="mono" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={32} placeholder="INV-1044" /></label>
          </div>

          {toValid && !self && sender && (
            <div className={'preflight ' + (typeof check === 'object' && check ? check.outcome : '')}>
              {check === 'loading' && <span>Asking the network…</span>}
              {check === 'error' && <span>Could not check right now. You can still send.</span>}
              {typeof check === 'object' && check?.outcome === 'credited' && (
                <>
                  <b>Arrives immediately.</b> The recipient accepts payments from you, so it is credited the moment it is sent.
                </>
              )}
              {typeof check === 'object' && check?.outcome === 'held' && (
                <>
                  <b>Will wait in the recipient's lobby.</b> The money leaves your balance now and reaches them only when they let it in. If they turn it
                  away, it comes back to you. Quote an invoice number in the reference so they can recognise you.
                </>
              )}
            </div>
          )}
          {self && <p className="errtext">That is your own account.</p>}
          {!refValid && <p className="errtext">The reference may contain up to 32 plain characters.</p>}
          {poor && sender && <p className="errtext">Not enough balance for this payment and the network fee.</p>}

          <div className="acts">
            <button className="btn solid" type="submit" disabled={!canSend}>
              {sending ? 'Signing…' : `Send ${units > 0n ? money(units) : ''} AlphaUSD`}
            </button>
          </div>
        </form>
      </section>

      {sent && sender && <Tracker sent={sent} sender={sender} refreshBalance={refreshBalance} />}
    </div>
  )
}

function Tracker({ sent, sender, refreshBalance }: { sent: { hash: Hex; to: Address; units: bigint }; sender: Address; refreshBalance: () => void }) {
  const [st, setSt] = useState<PaymentStatus | null>(null)

  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const s = await paymentStatus(pub, sent.hash, sent.to, sender)
        if (stop) return
        setSt(s)
        if (s.stage === 'returned') refreshBalance()
        if (s.stage === 'waiting') timer = setTimeout(tick, 3000)
      } catch {
        if (!stop) timer = setTimeout(tick, 3000)
      }
    }
    let timer = setTimeout(tick, 600)
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [sent.hash, sent.to, sender, refreshBalance])

  const arrived = st?.stage === 'arrived' || st?.stage === 'admitted'
  return (
    <section className="sec">
      <h2>
        <span className="r">II.</span> Following your payment
      </h2>
      <p className="sub">{money(sent.units)} AlphaUSD to {short(sent.to)}</p>
      <ol className="track">
        <li className="done">
          <b>Sent.</b> <TxLink hash={sent.hash} label="receipt" />
        </li>
        {!st && <li className="wait"><b>Checking where it went…</b></li>}
        {st?.stage === 'arrived' && <li className="done"><b>Arrived.</b> It was credited to the recipient right away.</li>}
        {(st?.stage === 'waiting' || st?.stage === 'admitted' || st?.stage === 'returned') && <li className="done"><b>Held in the recipient's lobby.</b> Their rules ask the owner to decide.</li>}
        {st?.stage === 'waiting' && <li className="wait"><b>Waiting for the owner.</b> This page updates by itself.</li>}
        {st?.stage === 'admitted' && <li className="done"><b>Admitted.</b> The payment reached them. <TxLink hash={st.tx} label="decision" /></li>}
        {st?.stage === 'returned' && <li className="bad"><b>Turned away.</b> The money came back to your account. <TxLink hash={st.tx} label="decision" /></li>}
      </ol>
      {arrived && <p className="note">Done. Nothing more to do.</p>}
    </section>
  )
}
