import {
  encodeFunctionData,
  parseEventLogs,
  type Address,
  type Hex,
  type WalletClient,
} from 'viem'
import { textToMemo } from './memo'
import { ABI, ALLOW_ALL_TOKENS, GUARD, REGISTRY, TOKEN, WHITELIST, type Pub } from './network'
import type { HeldItem } from './types'

// The same functions run in the browser (wagmi connector client) and in Node (key account),
// so they only need a viem wallet client with an account and a public client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Wallet = WalletClient<any, any, any>

const accountOf = (w: Wallet): Address => {
  if (!w.account) throw new Error('No account connected')
  return w.account.address
}

async function write(w: Wallet, pub: Pub, request: Record<string, unknown>): Promise<Hex> {
  const hash = await (w.writeContract as (r: unknown) => Promise<Hex>)(request)
  await confirm(pub, hash)
  return hash
}

async function confirm(pub: Pub, hash: Hex) {
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted`)
  return receipt
}

/**
 * One-time setup for an account: create a sender whitelist it administers, then point its receive
 * policy at it with itself as the recovery authority. Two transactions, because the second needs
 * the policy id the first one creates.
 */
export async function setupLobby(w: Wallet, pub: Pub): Promise<{ policyId: bigint; block: bigint }> {
  const me = accountOf(w)
  const createHash = await (w.writeContract as (r: unknown) => Promise<Hex>)({
    address: REGISTRY,
    abi: ABI.registry,
    functionName: 'createPolicy',
    args: [me, WHITELIST],
  })
  const receipt = await confirm(pub, createHash)
  const [created] = parseEventLogs({ abi: ABI.registry, eventName: 'PolicyCreated', logs: receipt.logs })
  if (!created) throw new Error('Policy creation produced no PolicyCreated event')
  const policyId = created.args.policyId as bigint

  const setHash = await (w.writeContract as (r: unknown) => Promise<Hex>)({
    address: REGISTRY,
    abi: ABI.registry,
    functionName: 'setReceivePolicy',
    args: [policyId, ALLOW_ALL_TOKENS, me],
  })
  const setReceipt = await confirm(pub, setHash)
  return { policyId, block: setReceipt.blockNumber }
}

type Call = { to: Address; data: Hex }

async function sendBatch(w: Wallet, pub: Pub, calls: Call[]): Promise<Hex> {
  if (calls.length === 1) {
    const hash = await (w.sendTransaction as (r: unknown) => Promise<Hex>)({ to: calls[0].to, data: calls[0].data })
    await confirm(pub, hash)
    return hash
  }
  // Tempo transactions carry several calls and run them atomically: one signature, all or nothing.
  const hash = await (w.sendTransaction as (r: unknown) => Promise<Hex>)({ calls })
  await confirm(pub, hash)
  return hash
}

/** Let a held payment in. With `remember`, the sender joins the whitelist in the same transaction. */
export async function admit(w: Wallet, pub: Pub, item: HeldItem, opts: { remember: boolean; policyId: bigint }): Promise<Hex> {
  const me = accountOf(w)
  const calls: Call[] = []
  if (opts.remember) {
    calls.push({
      to: REGISTRY,
      data: encodeFunctionData({ abi: ABI.registry, functionName: 'modifyPolicyWhitelist', args: [opts.policyId, item.originator, true] }),
    })
  }
  calls.push({ to: GUARD, data: encodeFunctionData({ abi: ABI.guard, functionName: 'claim', args: [me, item.receipt] }) })
  return sendBatch(w, pub, calls)
}

/** Send the money back to whoever sent it. */
export async function turnAway(w: Wallet, pub: Pub, item: HeldItem): Promise<Hex> {
  return sendBatch(w, pub, [
    { to: GUARD, data: encodeFunctionData({ abi: ABI.guard, functionName: 'claim', args: [item.originator, item.receipt] }) },
  ])
}

export type Preflight = { outcome: 'credited' | 'held'; protectedBy: 'none' | 'receive-policy' }

/**
 * Ask the chain what would happen to a payment before sending it. A receiver without a receive policy
 * always credits; one with a policy may hold the money until its owner decides.
 */
export async function preflight(pub: Pub, sender: Address, receiver: Address): Promise<Preflight> {
  const [authorized] = (await pub.readContract({
    address: REGISTRY,
    abi: ABI.registry,
    functionName: 'validateReceivePolicy',
    args: [TOKEN, sender, receiver],
  })) as [boolean, number]
  return { outcome: authorized ? 'credited' : 'held', protectedBy: authorized ? 'none' : 'receive-policy' }
}

export async function sendPayment(w: Wallet, pub: Pub, to: Address, units: bigint, reference: string): Promise<Hex> {
  return write(w, pub, {
    address: TOKEN,
    abi: ABI.tip20,
    functionName: 'transferWithMemo',
    args: [to, units, textToMemo(reference)],
  })
}

/** Testnet faucet: tops an account up with AlphaUSD (also pays the fees). */
export async function fundFromFaucet(rpcUrl: string, address: Address): Promise<void> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tempo_fundAddress', params: [address] }),
  })
  const json = (await res.json()) as { error?: { message: string } }
  if (json.error) throw new Error(`Faucet: ${json.error.message}`)
}

/** Put an address on (or take it off) the on-chain guest list. Whitelisted senders are credited directly. */
export async function setGuest(w: Wallet, pub: Pub, policyId: bigint, address: Address, allowed: boolean): Promise<Hex> {
  return sendBatch(w, pub, [
    { to: REGISTRY, data: encodeFunctionData({ abi: ABI.registry, functionName: 'modifyPolicyWhitelist', args: [policyId, address, allowed] }) },
  ])
}
