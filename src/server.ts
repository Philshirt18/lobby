import { execFile } from 'node:child_process'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cfg } from './config'
import { deskAccount, publicClient, tip20Abi } from './chain'
import { db, getMeta } from './db'
import { startIndexer } from './indexer'
import { assess, type HeldRow } from './risk'
import { approve, returnToSender } from './actions'

const app = new Hono()

type Row = Record<string, unknown>
const all = (sql: string, ...params: (string | number)[]) => db.prepare(sql).all(...params) as Row[]

app.get('/api/state', async (c) => {
  const held = all('SELECT * FROM held WHERE receiver = ? ORDER BY blocked_at DESC', cfg.owner).map((h) => {
    const { flags, recommendation } = assess(h as unknown as HeldRow)
    const { receipt: _receipt, ...rest } = h
    return { ...rest, flags, recommendation: h.status === 'held' ? recommendation : null }
  })
  const credited = all('SELECT * FROM credited WHERE to_addr = ? ORDER BY block DESC, log_index DESC LIMIT 100', cfg.owner)
  const invoices = all('SELECT * FROM invoices ORDER BY created_at DESC')
  const known = all('SELECT * FROM known ORDER BY added_at DESC')
  const balance = await publicClient
    .readContract({ address: cfg.token, abi: tip20Abi, functionName: 'balanceOf', args: [cfg.owner] })
    .then((b) => String(b))
    .catch(() => null)
  return c.json({
    owner: cfg.owner,
    desk: deskAccount.address,
    policyId: cfg.policyId?.toString() ?? null,
    token: cfg.token,
    balance,
    syncedBlock: getMeta('cursor') ?? null,
    demo: cfg.demo,
    held,
    credited,
    invoices,
    known,
  })
})

const SCENARIOS = ['customer', 'stranger', 'poison', 'spam']
app.post('/api/demo/:scenario', async (c) => {
  if (!cfg.demo) return c.json({ ok: false, error: 'Demo mode is off (set DEMO_MODE=1)' }, 403)
  const scenario = c.req.param('scenario')
  if (!SCENARIOS.includes(scenario)) return c.json({ ok: false, error: 'Unknown scenario' }, 400)
  return await new Promise<Response>((resolve) => {
    execFile('node_modules/.bin/tsx', ['scripts/attack.ts', scenario], { cwd: process.cwd() }, (err, stdout, stderr) => {
      resolve(c.json(err ? { ok: false, error: (stderr || err.message).split('\n')[0] } : { ok: true, out: stdout.trim() }, err ? 500 : 200))
    })
  })
})

app.post('/api/held/:nonce/approve', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    return c.json({ ok: true, ...(await approve(Number(c.req.param('nonce')), { remember: !!body.remember, label: body.label })) })
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 400)
  }
})

app.post('/api/held/:nonce/return', async (c) => {
  try {
    return c.json({ ok: true, ...(await returnToSender(Number(c.req.param('nonce')))) })
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 400)
  }
})

app.post('/api/invoices', async (c) => {
  const b = await c.req.json()
  if (!b.id || !/^[\x20-\x7e]{1,32}$/.test(b.id)) return c.json({ ok: false, error: 'Invoice id must be 1-32 printable ASCII characters' }, 400)
  const units = Math.round(Number(b.amount) * 1_000_000)
  if (!Number.isFinite(units) || units <= 0) return c.json({ ok: false, error: 'Invalid amount' }, 400)
  db.prepare('INSERT OR REPLACE INTO invoices (id, label, amount, status, created_at) VALUES (?, ?, ?, ?, ?)').run(
    b.id, b.label ?? '', String(units), 'open', Math.floor(Date.now() / 1000),
  )
  return c.json({ ok: true })
})

app.post('/api/known', async (c) => {
  const b = await c.req.json()
  if (!/^0x[0-9a-fA-F]{40}$/.test(b.address ?? '')) return c.json({ ok: false, error: 'Invalid address' }, 400)
  db.prepare('INSERT OR REPLACE INTO known (address, label, added_at) VALUES (?, ?, ?)').run(
    b.address.toLowerCase(), b.label || 'Known sender', Math.floor(Date.now() / 1000),
  )
  return c.json({ ok: true })
})

app.use('/*', serveStatic({ root: './public' }))

startIndexer()
serve({ fetch: app.fetch, port: cfg.port }, (i) => console.log(`Lobby running on http://localhost:${i.port}`))
