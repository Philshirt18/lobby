import { useState } from 'react'
import type { Address } from 'viem'
import type { useLobby } from '../hooks/useLobby'
import { pub } from '../hooks/useChain'
import { useToast } from '../hooks/useToast'
import { setGuest, setGuests, type Wallet } from '../lib/actions'
import { playScenario, type Scenario } from '../lib/demo'
import { errorText } from '../lib/errors'
import { FIXTURES } from '../lib/fixtures'
import { reconcileInvoices } from '../lib/state'

type Props = { account: Address; lobby: ReturnType<typeof useLobby>; wallet: Wallet | undefined; policyId: bigint }

const BUTTONS: { id: Scenario; label: string; hint: string; red?: boolean }[] = [
  { id: 'regular', label: 'Regular pays INV-1043', hint: 'A guest: arrives directly' },
  { id: 'newcomer', label: 'Newcomer pays INV-2001', hint: 'A stranger with a matching invoice' },
  { id: 'impostor', label: 'Impostor sends dust', hint: 'Look-alike of your regular', red: true },
  { id: 'odd', label: 'Odd amount, no invoice', hint: 'A stranger you have to judge' },
]

/** Plays the other side of the desk with throwaway testnet wallets, so anyone can see the whole story in a minute. */
export function Stage({ account, lobby, wallet, policyId }: Props) {
  const { toast } = useToast()
  const [running, setRunning] = useState<string | null>(null)
  const { state, update, refresh } = lobby
  const hasRegular = state.guests.some((g) => g.address.toLowerCase() === FIXTURES.acme.address.toLowerCase())

  async function loadDemo() {
    if (!wallet) return toast('Your account is not ready yet.', true)
    setRunning('load')
    try {
      if (!hasRegular) await setGuest(wallet, pub, policyId, FIXTURES.acme.address, true)
      update((s) => {
        const now = Math.floor(Date.now() / 1000)
        const guests = s.guests.some((g) => g.address.toLowerCase() === FIXTURES.acme.address.toLowerCase())
          ? s.guests
          : [{ address: FIXTURES.acme.address.toLowerCase() as Address, label: 'Acme GmbH', addedAt: now }, ...s.guests]
        const add = (id: string, label: string, amount: string) =>
          s.invoices.some((i) => i.id === id) ? [] : [{ id, label, amount, status: 'open' as const, createdAt: now }]
        const next = { ...s, guests, invoices: [...add('INV-1043', 'Acme – consulting', '1000000'), ...add('INV-2001', 'Globex – licence', '250000000'), ...s.invoices] }
        return { ...next, invoices: reconcileInvoices(next) }
      })
      toast('Acme GmbH is a guest now, and two invoices are open.')
    } catch (e) {
      toast(errorText(e), true)
    }
    setRunning(null)
  }

  /** Take every demo character off the guest list again, so the story can be played from the start. */
  async function clearScene() {
    if (!wallet) return toast('Your account is not ready yet.', true)
    setRunning('clear')
    try {
      const cast = Object.values(FIXTURES).map((f) => f.address)
      await setGuests(wallet, pub, policyId, cast, false)
      const isCast = (a: string) => cast.some((c) => c.toLowerCase() === a.toLowerCase())
      update((s) => ({
        ...s,
        guests: s.guests.filter((g) => !isCast(g.address)),
        invoices: s.invoices.filter((i) => i.id !== 'INV-1043' && i.id !== 'INV-2001'),
      }))
      toast('The scene is cleared. Everyone is a stranger again.')
    } catch (e) {
      toast(errorText(e), true)
    }
    setRunning(null)
  }

  async function play(id: Scenario) {
    setRunning(id)
    try {
      await playScenario(id, account)
      toast('Sent. The visitor shows up in a few seconds.')
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        void refresh()
      }
    } catch (e) {
      toast(errorText(e), true)
    }
    setRunning(null)
  }

  return (
    <section className="stage">
      <h3>Stage directions</h3>
      <p>
        Nobody paying you yet? These buttons play the other side of the desk with throwaway testnet wallets. Start with "Set the scene", then
        try the visitors in any order.
      </p>
      <div className="btns">
        <button className="btn small solid" disabled={running !== null} onClick={loadDemo}>
          {running === 'load' ? 'Signing…' : hasRegular ? 'Scene is set' : 'Set the scene'}
        </button>
        <button className="btn small" disabled={running !== null} onClick={clearScene} title="Take the demo characters off your guest list again">
          {running === 'clear' ? 'Signing…' : 'Clear the scene'}
        </button>
        {BUTTONS.map((b) => (
          <button key={b.id} className={'btn small ' + (b.red ? 'red' : '')} disabled={running !== null} onClick={() => play(b.id)} title={b.hint}>
            {running === b.id ? 'Sending…' : b.label}
          </button>
        ))}
      </div>
    </section>
  )
}
