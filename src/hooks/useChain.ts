import { useWalletClient } from 'wagmi'
import { makePublicClient } from '../lib/network'
import type { Wallet } from '../lib/actions'

/** One shared public client for the whole app. */
export const pub = makePublicClient()

/** The connected account's wallet client (passkey or demo key), ready for the action helpers. */
export function useWallet(): Wallet | undefined {
  const { data } = useWalletClient()
  return data as Wallet | undefined
}
