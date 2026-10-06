import { createPublicClient, createWalletClient, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoModerato } from 'viem/chains'
import { Abis, Addresses } from 'viem/tempo'
import { cfg } from './config'

export const GUARD = Addresses.receivePolicyGuard as Address
export const REGISTRY = '0x403c000000000000000000000000000000000000' as Address
export const guardAbi = Abis.receivePolicyGuard
export const registryAbi = Abis.tip403Registry
export const tip20Abi = Abis.tip20

export const publicClient = createPublicClient({
  chain: tempoModerato,
  transport: http(cfg.rpcUrl),
})

export const deskAccount = privateKeyToAccount(cfg.deskKey)

export const deskClient = createWalletClient({
  account: deskAccount,
  chain: tempoModerato,
  transport: http(cfg.rpcUrl),
})
