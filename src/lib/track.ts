import { getAbiItem, parseEventLogs, type Address, type Hex } from 'viem'
import { ABI, GUARD, type Pub } from './network'

export type PaymentStatus =
  | { stage: 'arrived' }
  | { stage: 'waiting'; nonce: number }
  | { stage: 'admitted'; nonce: number; tx: Hex }
  | { stage: 'returned'; nonce: number; tx: Hex }

const claimed = getAbiItem({ abi: ABI.guard, name: 'ReceiptClaimed' })

/** Where is the payment that `txHash` made? Credited right away, held in the lobby, or already decided. */
export async function paymentStatus(pub: Pub, txHash: Hex, receiver: Address, sender: Address): Promise<PaymentStatus> {
  const receipt = await pub.getTransactionReceipt({ hash: txHash })
  const [held] = parseEventLogs({ abi: ABI.guard, eventName: 'TransferBlocked', logs: receipt.logs }).filter(
    (l) => l.address.toLowerCase() === GUARD.toLowerCase(),
  )
  if (!held) return { stage: 'arrived' }
  const nonce = Number(held.args.blockedNonce)
  const logs = await pub.getLogs({
    address: GUARD,
    event: claimed,
    args: { receiver },
    fromBlock: receipt.blockNumber,
    toBlock: 'latest',
  })
  const decided = logs.find((l) => Number(l.args.blockedNonce) === nonce)
  if (!decided) return { stage: 'waiting', nonce }
  const to = (decided.args.to as Address).toLowerCase()
  return to === sender.toLowerCase() ? { stage: 'returned', nonce, tx: decided.transactionHash } : { stage: 'admitted', nonce, tx: decided.transactionHash }
}
