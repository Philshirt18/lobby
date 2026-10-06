import { useState } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { errorText } from '../lib/errors'
import { demoKeyStorage } from '../lib/wagmi'

/** Sign in with a passkey (device-bound, no extension, no seed phrase) or with a throwaway demo key. */
export function Connect({ intro }: { intro?: string }) {
  const { connectAsync, connectors, isPending } = useConnect()
  const { disconnectAsync } = useDisconnect()
  const { status } = useAccount()
  const [error, setError] = useState<string | null>(null)
  const passkey = connectors.find((c) => c.id === 'webAuthn')
  const demo = connectors.find((c) => c.id === 'secp256k1')

  async function go(kind: 'register' | 'login' | 'demo') {
    setError(null)
    try {
      // A stale session (connected, but no account) would make wagmi refuse a new connection.
      if (status === 'connected') await disconnectAsync().catch(() => {})
      if (kind === 'demo') demoKeyStorage.remember()
      if (kind === 'demo' && demo) await connectAsync({ connector: demo })
      else if (passkey && kind === 'register') await connectAsync({ connector: passkey, capabilities: { method: 'register', name: 'Lobby' } } as never)
      else if (passkey) await connectAsync({ connector: passkey })
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <section className="sec welcome">
      <h2>
        <span className="r">§</span> Sign in at the desk
      </h2>
      <p className="sub">{intro ?? 'Your account is a passkey on this device. No extension, no seed phrase, nobody holds your keys.'}</p>
      {!intro && (
        <div className="explainer">
          <p>
            <b>What is this?</b> On a blockchain anyone can send anything to your address, and you cannot say no. Attackers abuse that with look-alike
            addresses. Lobby uses Tempo's receive policies: payments from senders you don't know are <em>held</em> and wait here, until you admit them
            or send them back.
          </p>
          <ol>
            <li>Sign in and get test money.</li>
            <li>Open your lobby (two transactions).</li>
            <li>Press "Set the scene" at the bottom and watch a regular, a newcomer and an impostor arrive.</li>
          </ol>
        </div>
      )}
      <div className="acts">
        <button className="btn solid" disabled={isPending || !passkey} onClick={() => go('register')}>
          Create account with a passkey
        </button>
        <button className="btn" disabled={isPending || !passkey} onClick={() => go('login')}>
          Sign in with a passkey
        </button>
      </div>
      <p className="note">
        No passkey support in this browser?{' '}
        <button className="linkish" disabled={isPending || !demo} onClick={() => go('demo')}>
          Use a quick demo account
        </button>
        . It is a throwaway key kept in this browser's storage. Testnet only.
      </p>
      {error && <p className="errtext">{error}</p>}
    </section>
  )
}
