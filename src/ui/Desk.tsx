import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { isAddress, type Address, type Hex } from 'viem'
import { useNow } from '../hooks/useNow'
import { pub, useWallet } from '../hooks/useChain'
import type { useLobby } from '../hooks/useLobby'
import { useToast } from '../hooks/useToast'
import { admit, setGuest, turnAway } from '../lib/actions'
import { decisionLogCsv } from '../lib/csv'
import { errorText } from '../lib/errors'
import { money, short, toUnits } from '../lib/format'
import { assess, type RiskContext } from '../lib/risk'
import { reconcileInvoices } from '../lib/state'
import type { HeldItem, LobbyState } from '../lib/types'
import { Docket, TxLink, type Act } from './Docket'
import { Stage } from './Stage'

type Props = {
  account: Address
  lobby: ReturnType<typeof useLobby>
  balance: bigint | null
  refreshBalance: () => void
}

const DUST = 1_000_000n

function guestNameFor(item: HeldItem, s: LobbyState): string {
  const inv = item.memoText ? s.invoices.find((i) => i.id === item.memoText) : undefined
  const fromInvoice = inv?.label.split(/\s[–-]\s/)[0]?.trim()
  return fromInvoice || `Guest ${item.originator.slice(0, 6)}…${item.originator.slice(-4)}`
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function Desk({ account, lobby, balance, refreshBalance }: Props) {
  const { state, update, refresh } = lobby
  const wallet = useWallet()
  const { toast } = useToast()
  const now = useNow()
  const [busy, setBusy] = useState<{ nonce: number; act: Act } | null>(null)
  const [guestBusy, setGuestBusy] = useState(false)
  const seen = useRef(new Set<number>())
  const policyId = state.setup ? BigInt(state.setup.policyId) : 0n

  const ctx = useMemo<RiskContext>(
    () => ({
      guests: state.guests,
      counterparties: state.counterparties,
      invoices: state.invoices,
      dustUnits: DUST,
      seenBefore: (addr, nonce) =>
        state.credited.some((c) => c.from === addr) || state.held.some((h) => h.originator === addr && h.nonce !== nonce),
    }),
    [state],
  )
  const assessed = useMemo(() => new Map(state.held.map((h) => [h.nonce, assess(h, ctx)])), [state.held, ctx])

  const waiting = state.held.filter((h) => h.status === 'held')
  // Newly arrived visitors slide in once; afterwards re-renders leave them alone.
  const fresh = new Set(waiting.filter((h) => !seen.current.has(h.nonce)).map((h) => h.nonce))
  useEffect(() => {
    waiting.forEach((h) => seen.current.add(h.nonce))
  })
  const past = state.held.filter((h) => h.status !== 'held')
  const caught = state.held.filter((h) => assessed.get(h.nonce)?.flags.some((f) => f.code === 'lookalike')).length
  const open = state.invoices.filter((i) => i.status === 'open')
  const openSum = open.reduce((n, i) => n + BigInt(i.amount), 0n)
  const waitingSum = waiting.reduce((n, h) => n + BigInt(h.amount), 0n)

  const guestName = (a: Address): string | null =>
    state.guests.find((g) => g.address.toLowerCase() === a.toLowerCase())?.label ??
    (state.counterparties.some((c) => c.address.toLowerCase() === a.toLowerCase()) ? 'an address you paid before' : null)

  async function run(item: HeldItem, act: Act) {
    if (!wallet) return toast('Your account is not ready yet. Please try again.', true)
    setBusy({ nonce: item.nonce, act })
    try {
      const tx: Hex = act === 'return' ? await turnAway(wallet, pub, item) : await admit(wallet, pub, item, { remember: act === 'remember', policyId })
      update((s) => {
        const held = s.held.map((h): HeldItem =>
          h.nonce === item.nonce
            ? { ...h, status: act === 'return' ? 'returned' : 'approved', resolvedTx: tx, resolvedTo: (act === 'return' ? h.originator : account).toLowerCase() as Address }
            : h,
        )
        const guests =
          act === 'remember' && !s.guests.some((g) => g.address.toLowerCase() === item.originator.toLowerCase())
            ? [...s.guests, { address: item.originator, label: guestNameFor(item, s), addedAt: Math.floor(Date.now() / 1000) }]
            : s.guests
        const next = { ...s, held, guests }
        return { ...next, invoices: reconcileInvoices(next) }
      })
      toast(act === 'return' ? 'Turned away. The money went back to the sender.' : act === 'remember' ? 'Admitted, and on your guest list from now on.' : 'Admitted. The payment is in your balance.')
      refreshBalance()
      void refresh()
    } catch (e) {
      toast(errorText(e), true)
    } finally {
      setBusy(null)
    }
  }

  function addInvoice(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const id = String(f.get('id')).trim()
    const amount = toUnits(String(f.get('amount')))
    if (!/^[\x20-\x7e]{1,32}$/.test(id)) return toast('The invoice number must be 1 to 32 plain characters.', true)
    if (amount <= 0n) return toast('Enter an amount above zero.', true)
    update((s) => ({
      ...s,
      invoices: reconcileInvoices({
        ...s,
        invoices: [{ id, label: String(f.get('label')).trim(), amount: amount.toString(), status: 'open', createdAt: Math.floor(Date.now() / 1000) }, ...s.invoices.filter((i) => i.id !== id)],
      }),
    }))
    e.currentTarget.reset()
    toast('Entered in the books.')
  }

  async function addGuest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const address = String(f.get('address')).trim()
    if (!isAddress(address)) return toast('That does not look like an address.', true)
    if (!wallet) return toast('Your account is not ready yet.', true)
    setGuestBusy(true)
    try {
      await setGuest(wallet, pub, policyId, address, true)
      const label = String(f.get('label')).trim() || `Guest ${short(address)}`
      update((s) => ({ ...s, guests: [{ address: address.toLowerCase() as Address, label, addedAt: Math.floor(Date.now() / 1000) }, ...s.guests.filter((g) => g.address.toLowerCase() !== address.toLowerCase())] }))
      form.reset()
      toast('On the guest list. Their payments now arrive directly.')
    } catch (err) {
      toast(errorText(err), true)
    }
    setGuestBusy(false)
  }

  async function removeGuest(address: Address) {
    if (!wallet) return
    setGuestBusy(true)
    try {
      await setGuest(wallet, pub, policyId, address, false)
      update((s) => ({ ...s, guests: s.guests.filter((g) => g.address.toLowerCase() !== address.toLowerCase()) }))
      toast('Removed. Their next payment will wait in the lobby.')
    } catch (err) {
      toast(errorText(err), true)
    }
    setGuestBusy(false)
  }

  function copyPayLink(id: string, amount: string) {
    const url = `${window.location.origin}${window.location.pathname}#/pay?to=${account}&amount=${Number(amount) / 1e6}&ref=${encodeURIComponent(id)}`
    navigator.clipboard.writeText(url).then(
      () => toast('Payment link copied. Send it to your customer.'),
      () => toast(url),
    )
  }

  return (
    <>
      <div className="figures">
        <div className="fig first">
          <div className="k">Balance</div>
          <div className="v num">{balance === null ? '–' : money(balance)}</div>
          <div className="d">AlphaUSD, nothing but invited money</div>
        </div>
        <div className="fig">
          <div className="k">In the lobby</div>
          <div className="v num">{waiting.length}</div>
          <div className="d">{waiting.length ? `${money(waitingSum)} waiting` : 'no one waiting'}</div>
        </div>
        <div className={'fig ' + (caught ? 'alert' : '')}>
          <div className="k">Impostors</div>
          <div className="v num">{caught}</div>
          <div className="d">{caught === 1 ? 'look-alike caught' : 'look-alikes caught'}</div>
        </div>
        <div className="fig">
          <div className="k">Expected</div>
          <div className="v num">{money(openSum)}</div>
          <div className="d">
            {open.length} open {open.length === 1 ? 'account' : 'accounts'}
          </div>
        </div>
      </div>

      <div className="cols">
        <main>
          <section className="sec">
            <h2>
              <span className="r">I.</span> Awaiting admission <span className={'n ' + (waiting.length ? 'hot' : '')}>{waiting.length ? `${waiting.length} waiting` : 'quiet'}</span>
            </h2>
            <p className="sub">Held back by your receive policy. None of this has reached your balance.</p>
            {waiting.length === 0 ? (
              <div className="quiet">
                <b>The lobby is quiet.</b>Payments from senders you don't know will wait here.
              </div>
            ) : (
              waiting.map((h, i) => (
                <Docket
                  key={h.nonce}
                  item={h}
                  assessment={assessed.get(h.nonce)!}
                  guestName={guestName}
                  working={busy?.nonce === h.nonce ? busy.act : null}
                  disabled={busy !== null}
                  now={now}
                  isNew={fresh.has(h.nonce)}
                  index={i}
                  onAct={(act) => run(h, act)}
                />
              ))
            )}

            {past.length > 0 && (
              <details className="past">
                <summary>Earlier visitors ({past.length})</summary>
                <ul className="ledger resolved">
                  {past.slice(0, 15).map((h) => {
                    const ok = h.status === 'approved'
                    const imp = assessed.get(h.nonce)?.flags.some((f) => f.code === 'lookalike')
                    return (
                      <li key={h.nonce}>
                        <div className="who">
                          <b className="num">{money(h.amount)}</b>
                          <small>
                            {short(h.originator)}
                            {h.memoText ? ` · ${h.memoText}` : ''}
                            {imp ? ' · impostor' : ''}
                          </small>
                        </div>
                        <span className="lead" />
                        <div className="val">
                          <span className={'stamp fresh ' + (ok ? 'in' : 'out')}>{ok ? 'Admitted' : 'Returned'}</span>
                          {h.resolvedTx && <small><TxLink hash={h.resolvedTx} label="receipt" /></small>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </details>
            )}
          </section>
        </main>

        <aside>
          <section className="sec">
            <h2>
              <span className="r">II.</span> The register <span className="n">{state.credited.length || ''}</span>
            </h2>
            <p className="sub">Welcome guests. Credited the moment they arrived.</p>
            <ul className="ledger">
              {state.credited.length === 0 && (
                <li>
                  <div className="who"><small className="empty">No guests have signed in yet.</small></div>
                </li>
              )}
              {state.credited.slice(0, 8).map((c) => {
                const name = state.guests.find((g) => g.address.toLowerCase() === c.from)?.label
                return (
                  <li key={c.id}>
                    <div className="who">
                      <b>{name ?? short(c.from)}</b>
                      <small>
                        {name ? `${short(c.from)} · ` : ''}
                        {c.memoText || 'no reference'}
                      </small>
                    </div>
                    <span className="lead" />
                    <div className="val num">
                      +{money(c.amount)}
                      <small><TxLink hash={c.txHash} /></small>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="sec">
            <h2>
              <span className="r">III.</span> Open accounts <span className="n">{state.invoices.length || ''}</span>
            </h2>
            <p className="sub">A payment quoting an invoice number is recommended for admission.</p>
            <ul className="ledger">
              {state.invoices.length === 0 && (
                <li>
                  <div className="who"><small className="empty">Nothing owed yet. Enter an invoice below.</small></div>
                </li>
              )}
              {state.invoices.map((i) => (
                <li key={i.id}>
                  <div className="who">
                    <b className="mono small">{i.id}</b>
                    <small className="plain">{i.label}</small>
                  </div>
                  <span className="lead" />
                  <div className="val num">
                    {money(i.amount)}
                    <small className={i.status === 'paid' ? 'paid' : ''}>
                      {i.status === 'paid' ? (
                        <>settled {i.paidTx && <TxLink hash={i.paidTx} label="" />}</>
                      ) : (
                        <button className="linkish" onClick={() => copyPayLink(i.id, i.amount)} title="Copy a link that opens the payment page with everything filled in">
                          copy pay link
                        </button>
                      )}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
            <form className="add" onSubmit={addInvoice} autoComplete="off">
              <label>Invoice no.<input className="mono" name="id" placeholder="INV-1044" maxLength={32} required /></label>
              <label>Customer<input name="label" placeholder="Initech – retainer" /></label>
              <label className="narrow">Amount<input name="amount" type="number" step="0.01" min="0.01" placeholder="0.00" required /></label>
              <button className="btn small" type="submit">Enter</button>
            </form>
          </section>

          <section className="sec">
            <h2>
              <span className="r">IV.</span> Guest list <span className="n">{state.guests.length || ''}</span>
            </h2>
            <p className="sub">Guests are paid in directly. Look-alikes of them, and of anyone you ever paid, raise the alarm.</p>
            <ul className="ledger plain">
              {state.guests.length === 0 && (
                <li>
                  <div className="who"><small className="empty">The list is empty.</small></div>
                </li>
              )}
              {state.guests.map((g) => (
                <li key={g.address}>
                  <div className="who">
                    <b>{g.label}</b>
                    <small>{g.address}</small>
                  </div>
                  <div className="val">
                    <small><button className="linkish" disabled={guestBusy} onClick={() => removeGuest(g.address)}>remove</button></small>
                  </div>
                </li>
              ))}
            </ul>
            <p className="note">
              {state.counterparties.length === 0
                ? 'Everyone you pay from this account is watched for look-alikes automatically.'
                : `${state.counterparties.length} ${state.counterparties.length === 1 ? 'address' : 'addresses'} you have paid ${state.counterparties.length === 1 ? 'is' : 'are'} watched for look-alikes automatically.`}
            </p>
            <form className="add" onSubmit={addGuest} autoComplete="off">
              <label>Address<input className="mono" name="address" placeholder="0x…" required /></label>
              <label>Name<input name="label" placeholder="Name" /></label>
              <button className="btn small" type="submit" disabled={guestBusy}>{guestBusy ? 'Signing…' : 'Add'}</button>
            </form>
          </section>

          <section className="sec">
            <h2>
              <span className="r">V.</span> Books
            </h2>
            <p className="sub">Every payment, every decision, with the transaction that proves it.</p>
            <div className="acts">
              <button className="btn small" disabled={state.held.length + state.credited.length === 0} onClick={() => download('lobby-decisions.csv', decisionLogCsv(state))}>
                Download decision log (CSV)
              </button>
            </div>
          </section>
        </aside>
      </div>

      <Stage account={account} lobby={lobby} wallet={wallet} policyId={policyId} />
    </>
  )
}

