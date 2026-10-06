import { createConfig } from 'wagmi'
import { generatePrivateKey } from 'viem/accounts'
import { dangerous_secp256k1, webAuthn } from 'wagmi/tempo'
import { chain, rpcTransport } from './network'

const DEMO_KEY = 'lobby:demo-key'

/**
 * The demo account is a throwaway testnet key. It must survive a page reload (otherwise the account
 * silently changes), so it lives in localStorage once the user has chosen it. Until then it is only random.
 */
function demoKey() {
  try {
    const stored = localStorage.getItem(DEMO_KEY)
    if (stored && /^0x[0-9a-f]{64}$/i.test(stored)) return stored as `0x${string}`
  } catch {
    /* storage blocked */
  }
  return generatePrivateKey()
}

export const demoKeyStorage = {
  /** Called when the user picks the demo account: keep this key for next time. */
  remember() {
    try {
      localStorage.setItem(DEMO_KEY, demoPrivateKey)
    } catch {
      /* ignore */
    }
  },
}

const demoPrivateKey = demoKey()

export const config = createConfig({
  chains: [chain],
  // Passkey accounts live on the user's device; the demo account is a plain throwaway key for browsers
  // without passkey support (clearly labelled in the UI, testnet only).
  connectors: [webAuthn(), dangerous_secp256k1({ privateKey: demoPrivateKey })],
  multiInjectedProviderDiscovery: false,
  transports: { [chain.id]: rpcTransport() },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
