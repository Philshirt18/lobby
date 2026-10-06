import { getAbiItem, type Address, type Hex } from 'viem'
import { Abis, ReceivePolicyReceipt } from 'viem/tempo'
import { cfg } from './config'
import { GUARD, guardAbi, publicClient, tip20Abi } from './chain'
import { db, getMeta, setMeta } from './db'
import { memoToText } from './memo'

const transferBlocked = getAbiItem({ abi: guardAbi, name: 'TransferBlocked' })
const receiptClaimed = getAbiItem({ abi: guardAbi, name: 'ReceiptClaimed' })
const transferEvt = getAbiItem({ abi: tip20Abi, name: 'Transfer' })
const transferWithMemo = getAbiItem({ abi: tip20Abi, name: 'TransferWithMemo' })

const CHUNK = 5000n
void Abis

async function resolveStart(): Promise<bigint> {
  const stored = getMeta('cursor')
  if (stored) return BigInt(stored) + 1n
  if (cfg.startBlock !== undefined) return cfg.startBlock
  const head = await publicClient.getBlockNumber()
  return head > 2000n ? head - 2000n : 0n
}

function markInvoicePaid(memoText: string | null | undefined, amount: bigint, tx: string) {
  if (!memoText) return
  db.prepare(
    "UPDATE invoices SET status = 'paid', paid_tx = ? WHERE id = ? AND status = 'open' AND CAST(amount AS INTEGER) <= ?",
  ).run(tx, memoText, Number(amount))
}

async function indexRange(from: bigint, to: bigint) {
  const [blocked, claimed, transfers, memos] = await Promise.all([
    publicClient.getLogs({ address: GUARD, event: transferBlocked, args: { token: cfg.token, receiver: cfg.owner }, fromBlock: from, toBlock: to }),
    publicClient.getLogs({ address: GUARD, event: receiptClaimed, args: { token: cfg.token, receiver: cfg.owner }, fromBlock: from, toBlock: to }),
    publicClient.getLogs({ address: cfg.token, event: transferEvt, args: { to: cfg.owner }, fromBlock: from, toBlock: to }),
    publicClient.getLogs({ address: cfg.token, event: transferWithMemo, args: { to: cfg.owner }, fromBlock: from, toBlock: to }),
  ])

  // Blocked payments -> the lobby
  for (const log of blocked) {
    const { receipt, amount, blockedNonce } = log.args
    const r = ReceivePolicyReceipt.decode(receipt as Hex)
    db.prepare(
      `INSERT OR IGNORE INTO held
       (receiver, nonce, token, amount, originator, memo, memo_text, blocked_at, tx_hash, block, receipt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      cfg.owner,
      Number(blockedNonce),
      r.token.toLowerCase(),
      String(amount),
      r.originator.toLowerCase(),
      r.memo ?? '0x',
      r.memo ? memoToText(r.memo) : '',
      Number(r.blockedAt),
      log.transactionHash,
      Number(log.blockNumber),
      receipt as string,
    )
  }

  // Resolutions: whoever claims (here or from another tool) updates the status
  for (const log of claimed) {
    const { blockedNonce, to: dest, amount } = log.args
    const status = (dest as string).toLowerCase() === cfg.owner ? 'approved' : 'returned'
    db.prepare(
      "UPDATE held SET status = ?, resolved_tx = COALESCE(resolved_tx, ?), resolved_to = ? WHERE receiver = ? AND nonce = ?",
    ).run(status, log.transactionHash, (dest as string).toLowerCase(), cfg.owner, Number(blockedNonce))
    if (status === 'approved') {
      const row = db.prepare('SELECT memo_text FROM held WHERE receiver = ? AND nonce = ?').get(cfg.owner, Number(blockedNonce)) as { memo_text: string } | undefined
      markInvoicePaid(row?.memo_text, BigInt(amount as bigint), log.transactionHash)
    }
  }

  // Credited payments (memo joined by tx hash)
  const memoByTx = new Map<string, Hex>()
  for (const m of memos) memoByTx.set(`${m.transactionHash}:${m.args.from}`, m.args.memo as Hex)
  for (const t of transfers) {
    const from = (t.args.from as Address).toLowerCase()
    if (from === GUARD.toLowerCase()) continue // released from the lobby, shown there already
    const memo = memoByTx.get(`${t.transactionHash}:${t.args.from}`)
    const memoText = memo ? memoToText(memo) : ''
    db.prepare(
      `INSERT OR IGNORE INTO credited (tx_hash, log_index, token, from_addr, to_addr, amount, memo, memo_text, block)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(t.transactionHash, t.logIndex, cfg.token, from, cfg.owner, String(t.args.amount), memo ?? null, memoText, Number(t.blockNumber))
    markInvoicePaid(memoText, BigInt(t.args.amount as bigint), t.transactionHash)
  }
}

/** An invoice is settled once a payment with its memo and at least its amount is credited or approved. */
export function reconcileInvoices() {
  db.exec(`
    UPDATE invoices SET status = 'paid', paid_tx = (
      SELECT c.tx_hash FROM credited c WHERE c.memo_text = invoices.id AND CAST(c.amount AS INTEGER) >= CAST(invoices.amount AS INTEGER)
      UNION ALL
      SELECT h.resolved_tx FROM held h WHERE h.memo_text = invoices.id AND h.status = 'approved' AND CAST(h.amount AS INTEGER) >= CAST(invoices.amount AS INTEGER)
      LIMIT 1
    )
    WHERE status = 'open' AND (
      EXISTS (SELECT 1 FROM credited c WHERE c.memo_text = invoices.id AND CAST(c.amount AS INTEGER) >= CAST(invoices.amount AS INTEGER))
      OR EXISTS (SELECT 1 FROM held h WHERE h.memo_text = invoices.id AND h.status = 'approved' AND CAST(h.amount AS INTEGER) >= CAST(invoices.amount AS INTEGER))
    )`)
}

export async function syncOnce(): Promise<{ head: bigint; indexed: boolean }> {
  const head = await publicClient.getBlockNumber()
  let from = await resolveStart()
  while (from <= head) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n
    await indexRange(from, to)
    setMeta('cursor', String(to))
    from = to + 1n
  }
  reconcileInvoices()
  return { head, indexed: true }
}

export function startIndexer(intervalMs = 2000) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await syncOnce()
    } catch (e) {
      console.error('[indexer]', (e as Error).message)
    } finally {
      running = false
    }
  }
  void tick()
  return setInterval(tick, intervalMs)
}
