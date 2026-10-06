import { useDisconnect } from 'wagmi'
import type { Address } from 'viem'
import { short } from '../lib/format'
import type { Route } from '../hooks/useHash'

type Props = {
  route: Route
  account: Address | undefined
  online: boolean
  head: number | null
  syncing: boolean
}

export function Masthead({ route, account, online, head, syncing }: Props) {
  const { disconnect } = useDisconnect()
  const live = account ? (online ? 'on' : 'off') : ''
  return (
    <header className="mast">
      <div className="mast-row">
        <div>
          <h1 className="wordmark">
            Lobby<i>.</i>
          </h1>
          <p className="tagline">Front desk for incoming payments. Strangers wait here.</p>
        </div>
        <div className="status">
          {account ? (
            <>
              <div>
                <span className={'live ' + live} />
                {online ? (head ? `live · block ${head.toLocaleString('en-US')}` : syncing ? 'syncing…' : 'live') : 'offline, retrying'}
              </div>
              <div>
                Tempo testnet · <span title={account}>{short(account)}</span>{' '}
                <button className="linkish" onClick={() => disconnect()}>
                  sign out
                </button>
              </div>
            </>
          ) : (
            <div>Tempo testnet · not signed in</div>
          )}
        </div>
      </div>
      <nav className="tabs" aria-label="Pages">
        <a href="#/" className={route.page === 'desk' ? 'on' : ''}>
          Front desk
        </a>
        <a href="#/pay" className={route.page === 'pay' ? 'on' : ''}>
          Send a payment
        </a>
      </nav>
      <div className="doublerule" />
    </header>
  )
}
