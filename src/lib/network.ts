import { createPublicClient, http, type Transport } from 'viem'
import { tempoModerato } from 'viem/chains'
import { Abis, Addresses } from 'viem/tempo'

export const chain = tempoModerato
export const EXPLORER = 'https://explore.testnet.tempo.xyz'

/** AlphaUSD, the testnet stablecoin (6 decimals). */
export const TOKEN = '0x20c0000000000000000000000000000000000001' as const
export const DECIMALS = 6
export const GUARD = Addresses.receivePolicyGuard
export const REGISTRY = '0x403c000000000000000000000000000000000000' as const

export const ABI = {
  guard: Abis.receivePolicyGuard,
  registry: Abis.tip403Registry,
  tip20: Abis.tip20,
} as const

/** TIP-403 policy type: 0 = whitelist (verified against `cast tip403 info`). */
export const WHITELIST = 0
/** Built-in token filter policy 1 = allow every token. */
export const ALLOW_ALL_TOKENS = 1n

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const isRateLimit = (e: unknown) => {
  const text = e instanceof Error ? `${e.name} ${e.message} ${(e as { details?: string }).details ?? ''}` : String(e)
  return /rate limited|LimitExceeded|Request exceeds defined limit|-32005|429/i.test(text)
}

/**
 * The public RPC throttles bursts ("rate limited, try again in 38ms"). viem never retries
 * `eth_sendRawTransaction`, so the wrapper does it here. A rate-limited request was rejected before
 * the node accepted it, so repeating it is safe, and it keeps the signature (and passkey prompt) intact.
 */
export const rpcTransport = (rpcUrl?: string, attempts = 8): Transport => {
  const inner = http(rpcUrl, { retryCount: 4, retryDelay: 250, timeout: 20_000 })
  return (params) => {
    const t = inner(params)
    return {
      ...t,
      request: (async (args: unknown, opts: unknown) => {
        for (let i = 0; ; i++) {
          try {
            return await (t.request as (a: unknown, o?: unknown) => Promise<unknown>)(args, opts)
          } catch (e) {
            if (!isRateLimit(e) || i >= attempts) throw e
            await sleep(150 * (i + 1))
          }
        }
      }) as typeof t.request,
    }
  }
}

export function makePublicClient(rpcUrl?: string) {
  return createPublicClient({ chain, transport: rpcTransport(rpcUrl) })
}
/** Tempo's public client type (its blocks and transactions differ from vanilla EVM). */
export type Pub = ReturnType<typeof makePublicClient>
