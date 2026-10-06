import { useEffect } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { useBalance } from './hooks/useBalance'
import { useRoute } from './hooks/useHash'
import { useLobby } from './hooks/useLobby'
import { Connect } from './ui/Connect'
import { Desk } from './ui/Desk'
import { Masthead } from './ui/Masthead'
import { Pay } from './ui/Pay'
import { Setup } from './ui/Setup'

export function App() {
  const route = useRoute()
  const { address, status } = useAccount()
  const lobby = useLobby(address)
  const { balance, refresh: refreshBalance } = useBalance(address)
  const reconnecting = status === 'reconnecting' || status === 'connecting'
  const { disconnect } = useDisconnect()
  // A session without an account (for example a demo key that is gone) is useless: drop it so sign-in works again.
  useEffect(() => {
    if (status === 'connected' && !address) disconnect()
  }, [status, address, disconnect])

  let body
  if (route.page === 'pay') {
    body = <Pay route={route} balance={balance} refreshBalance={refreshBalance} />
  } else if (reconnecting) {
    body = <div className="quiet"><b>Checking your passkey…</b></div>
  } else if (!address) {
    body = <Connect />
  } else if (lobby.phase === 'needs-setup') {
    body = <Setup onDone={lobby.markSetup} foreign={lobby.foreign} />
  } else if (lobby.phase === 'loading') {
    body = <div className="quiet"><b>Reading the guest book…</b>Looking up your lobby on the chain.</div>
  } else {
    body = <Desk account={address} lobby={lobby} balance={balance} refreshBalance={refreshBalance} />
  }

  return (
    <div className="wrap">
      <Masthead route={route} account={address} online={lobby.online} head={lobby.head} syncing={lobby.phase === 'loading'} />
      {body}
      <footer>
        Lobby is non-custodial: every decision is signed by your own account and the network enforces it. This build runs on the Tempo
        testnet and keeps names and invoices only in this browser.{' '}
        <a href="https://github.com/Philshirt18/lobby" target="_blank" rel="noopener noreferrer">
          Open source (MIT) ↗
        </a>
      </footer>
    </div>
  )
}
