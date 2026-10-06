import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useBalance } from '../hooks/useBalance'
import { pub, useWallet } from '../hooks/useChain'
import { useToast } from '../hooks/useToast'
import { fundFromFaucet, setupLobby } from '../lib/actions'
import { errorText } from '../lib/errors'
import { money, short } from '../lib/format'
import type { SetupInfo } from '../lib/indexer'
import { chain } from '../lib/network'

/** Two steps: get test money for fees, then open the lobby (creates the guest list and sets the receive policy). */
export function Setup({ onDone, foreign }: { onDone: (info: SetupInfo) => void; foreign: string | null }) {
  const { address } = useAccount()
  const wallet = useWallet()
  const { balance, refresh } = useBalance(address, 2500)
  const { toast } = useToast()
  const [busy, setBusy] = useState<'fund' | 'open' | null>(null)
  const funded = balance !== null && balance > 0n

  async function fund() {
    if (!address) return
    setBusy('fund')
    try {
      await fundFromFaucet(chain.rpcUrls.default.http[0], address)
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1200))
        await refresh()
      }
      toast('Test money received.')
    } catch (e) {
      toast(errorText(e), true)
    }
    setBusy(null)
  }

  async function open() {
    if (!wallet) return
    setBusy('open')
    try {
      const { policyId, block } = await setupLobby(wallet, pub)
      toast('Your lobby is open.')
      onDone({ policyId: policyId.toString(), block: Number(block) })
    } catch (e) {
      toast(errorText(e), true)
      setBusy(null)
    }
  }

  return (
    <section className="sec welcome">
      <h2>
        <span className="r">§</span> Open your lobby
      </h2>
      <p className="sub">Two steps, about a minute. Everything is signed with your own account.</p>
      {foreign && (
        <p className="errtext">
          Heads up: this account already has a receive policy that {short(foreign)} manages. Opening the lobby replaces it, and held payments
          under the old policy stay with that address.
        </p>
      )}
      <ol className="steps">
        <li className={funded ? 'done' : ''}>
          <div>
            <b>1. Get test money</b>
            <span>The test network pays fees in a play stablecoin. {balance !== null && <>You have {money(balance)}.</>}</span>
          </div>
          <button className="btn" disabled={busy !== null || funded} onClick={fund}>
            {busy === 'fund' ? 'Fetching…' : funded ? 'Done' : 'Get test money'}
          </button>
        </li>
        <li>
          <div>
            <b>2. Open the lobby</b>
            <span>
              Creates your guest list and tells the network: unknown senders wait, and only you decide. Two transactions.
            </span>
          </div>
          <button className="btn solid" disabled={busy !== null || !funded || !wallet} onClick={open}>
            {busy === 'open' ? 'Opening…' : 'Open my lobby'}
          </button>
        </li>
      </ol>
    </section>
  )
}
