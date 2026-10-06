// Demo helper: mines an address that starts and ends like the one you pass, the way a real
// address-poisoning attacker would. Usage: pnpm mine 0xYourTargetAddress (about 4 minutes on 7 cores for 3+3 characters).
// Prints a throwaway testnet key and address; nothing is written to disk.
import os from 'node:os'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex } from 'viem'

const PREFIX = 3
const SUFFIX = 3

if (isMainThread) {
  const target = (process.argv[2] ?? '').toLowerCase().replace(/^0x/, '')
  if (target.length !== 40) throw new Error('Usage: pnpm mine 0xTargetAddress')
  const want = { prefix: target.slice(0, PREFIX), suffix: target.slice(-SUFFIX) }
  const n = Math.max(1, os.cpus().length - 1)
  console.log(`Mining 0x${want.prefix}…${want.suffix} on ${n} threads (about 16.7M tries expected)`)
  const t0 = Date.now()
  const workers: Worker[] = []
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL(import.meta.url), { workerData: want })
    workers.push(w)
    w.on('message', (m: { key: string; address: string }) => {
      console.log(`Found after ${((Date.now() - t0) / 1000).toFixed(0)}s: ${m.address}`)
      console.log(`key: ${m.key}`)
      workers.forEach((x) => x.terminate())
    })
  }
} else {
  const { prefix, suffix } = workerData as { prefix: string; suffix: string }
  const order = secp256k1.Point.Fn.ORDER
  const start = BigInt('0x' + bytesToHex(secp256k1.utils.randomSecretKey()).slice(2))
  let point = secp256k1.Point.BASE.multiply(start)
  let offset = 0n
  for (;;) {
    const pub = point.toBytes(false).slice(1)
    const addr = bytesToHex(keccak_256(pub).slice(12)).slice(2)
    if (addr.startsWith(prefix) && addr.endsWith(suffix)) {
      const key = (start + offset) % order
      parentPort!.postMessage({ key: '0x' + key.toString(16).padStart(64, '0'), address: '0x' + addr })
      break
    }
    point = point.add(secp256k1.Point.BASE)
    offset++
  }
}
