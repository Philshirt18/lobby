import { getAbiItem, type Address, type Hex } from 'viem'
import { ABI, GUARD, REGISTRY, TOKEN, type Pub } from './network'
import type { Activity } from './types'

const events = {
  blocked: getAbiItem({ abi: ABI.guard, name: 'TransferBlocked' }),
  claimed: getAbiItem({ abi: ABI.guard, name: 'ReceiptClaimed' }),
  transfer: getAbiItem({ abi: ABI.tip20, name: 'Transfer' }),
  withMemo: getAbiItem({ abi: ABI.tip20, name: 'TransferWithMemo' }),
  policySet: getAbiItem({ abi: ABI.registry, name: 'ReceivePolicyUpdated' }),
}

/** The testnet RPC rejects log queries wider than 100,000 blocks. */
export const MAX_RANGE = 90_000n

/** Everything that happened to `owner` between two blocks (inclusive). The range must be <= MAX_RANGE. */
export async function fetchActivity(client: Pub, owner: Address, fromBlock: bigint, toBlock: bigint): Promise<Activity> {
  const range = { fromBlock, toBlock }
  const [blocked, claimed, inbound, memos, outbound] = await Promise.all([
    client.getLogs({ address: GUARD, event: events.blocked, args: { receiver: owner }, ...range }),
    client.getLogs({ address: GUARD, event: events.claimed, args: { receiver: owner }, ...range }),
    client.getLogs({ address: TOKEN, event: events.transfer, args: { to: owner }, ...range }),
    client.getLogs({ address: TOKEN, event: events.withMemo, args: { to: owner }, ...range }),
    client.getLogs({ address: TOKEN, event: events.transfer, args: { from: owner }, ...range }),
  ])

  const memoByTx = new Map<string, Hex>()
  for (const m of memos) memoByTx.set(`${m.transactionHash}:${(m.args.from as string).toLowerCase()}`, m.args.memo as Hex)

  // Direct payments carry no timestamp in their logs; read it from the block (once per block).
  const stamps = new Map<bigint, number>()
  for (const b of new Set(inbound.map((l) => l.blockNumber))) {
    stamps.set(b, Number((await client.getBlock({ blockNumber: b })).timestamp))
  }

  return {
    blocked: blocked.map((l) => ({
      nonce: Number(l.args.blockedNonce),
      amount: l.args.amount as bigint,
      receipt: l.args.receipt as Hex,
      txHash: l.transactionHash,
      block: Number(l.blockNumber),
    })),
    claimed: claimed.map((l) => ({
      nonce: Number(l.args.blockedNonce),
      to: l.args.to as Address,
      txHash: l.transactionHash,
      block: Number(l.blockNumber),
    })),
    inbound: inbound.map((l) => ({
      id: `${l.transactionHash}:${l.logIndex}`,
      ts: stamps.get(l.blockNumber) ?? 0,
      txHash: l.transactionHash,
      from: l.args.from as Address,
      amount: l.args.amount as bigint,
      memo: memoByTx.get(`${l.transactionHash}:${(l.args.from as string).toLowerCase()}`) ?? null,
      block: Number(l.blockNumber),
    })),
    outbound: outbound.map((l) => ({ to: l.args.to as Address, block: Number(l.blockNumber) })),
  }
}

/** Index a longer span in chunks the RPC accepts. */
export async function fetchActivityChunked(
  client: Pub,
  owner: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Activity> {
  const all: Activity = { blocked: [], claimed: [], inbound: [], outbound: [] }
  for (let from = fromBlock; from <= toBlock; from += MAX_RANGE) {
    const to = from + MAX_RANGE - 1n > toBlock ? toBlock : from + MAX_RANGE - 1n
    const a = await fetchActivity(client, owner, from, to)
    all.blocked.push(...a.blocked)
    all.claimed.push(...a.claimed)
    all.inbound.push(...a.inbound)
    all.outbound.push(...a.outbound)
  }
  return all
}

export type SetupInfo = { policyId: string; block: number }

export type OnchainPolicy =
  | { state: 'none' }
  /** Somebody else (another address) is the recovery authority: this app could not release held payments. */
  | { state: 'foreign'; authority: Address }
  | { state: 'mine'; policyId: string }

/** The registry knows each account's receive policy; no log search needed to find it again on a new device. */
export async function readPolicy(client: Pub, owner: Address): Promise<OnchainPolicy> {
  const [has, senderPolicyId, , , , authority] = (await client.readContract({
    address: REGISTRY,
    abi: ABI.registry,
    functionName: 'receivePolicy',
    args: [owner],
  })) as readonly [boolean, bigint, number, bigint, number, Address]
  if (!has) return { state: 'none' }
  if (authority.toLowerCase() !== owner.toLowerCase()) return { state: 'foreign', authority }
  return { state: 'mine', policyId: senderPolicyId.toString() }
}

/**
 * How far back does this account's history go? Walk back through `ReceivePolicyUpdated` events (about 14 hours of
 * blocks per request, a few in parallel) and return the earliest one in reach. Without any, start at the
 * edge of the window: older payments are not shown on a fresh device.
 */
export async function findHistoryStart(client: Pub, owner: Address, head: bigint, maxBlocksBack = 2_000_000n): Promise<number> {
  const floor = head > maxBlocksBack ? head - maxBlocksBack : 0n
  const ranges: [bigint, bigint][] = []
  for (let to = head; to >= floor; to -= MAX_RANGE) {
    ranges.push([to - MAX_RANGE + 1n > floor ? to - MAX_RANGE + 1n : floor, to])
    if (to - MAX_RANGE < floor) break
  }
  let earliest: number | null = null
  for (let i = 0; i < ranges.length; i += 4) {
    const batch = await Promise.all(
      ranges.slice(i, i + 4).map(([from, to]) =>
        client.getLogs({ address: REGISTRY, event: events.policySet, args: { account: owner }, fromBlock: from, toBlock: to }),
      ),
    )
    for (const logs of batch) for (const l of logs) earliest = Math.min(earliest ?? Infinity, Number(l.blockNumber))
  }
  return earliest ?? Number(floor)
}

/**
 * Blocks to re-read on every sync. The RPC's log index can trail the chain head by a moment, so a
 * cursor that jumps straight to the head could skip events for good. Re-reading is harmless because
 * merging activity into the state is idempotent.
 */
export const OVERLAP = 40

export function syncFrom(cursor: number | null, setupBlock: number): bigint {
  if (cursor === null) return BigInt(setupBlock)
  return BigInt(Math.max(setupBlock, cursor - OVERLAP))
}
