import { useCallback, useEffect, useState } from 'react'
import type { Address } from 'viem'
import { ABI, TOKEN } from '../lib/network'
import { pub } from './useChain'

export async function readBalance(address: Address): Promise<bigint> {
  return (await pub.readContract({ address: TOKEN, abi: ABI.tip20, functionName: 'balanceOf', args: [address] })) as bigint
}

export function useBalance(address: Address | undefined, everyMs = 4000) {
  const [balance, setBalance] = useState<bigint | null>(null)
  const refresh = useCallback(async () => {
    if (!address) return
    try {
      setBalance(await readBalance(address))
    } catch {
      /* keep the last value */
    }
  }, [address])
  useEffect(() => {
    setBalance(null)
    if (!address) return
    void refresh()
    const id = setInterval(() => {
      if (!document.hidden) void refresh()
    }, everyMs)
    const onVisible = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [address, refresh, everyMs])
  return { balance, refresh }
}
