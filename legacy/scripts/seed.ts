// Demo data: one known customer and two open invoices. Safe to run repeatedly.
import { db } from '../src/db'

const now = Math.floor(Date.now() / 1000)
const customer = process.env.CUSTOMER_ADDRESS?.toLowerCase()
if (customer) {
  db.prepare('INSERT OR REPLACE INTO known (address, label, added_at) VALUES (?, ?, ?)').run(customer, 'Acme GmbH', now)
}
const inv = db.prepare("INSERT OR IGNORE INTO invoices (id, label, amount, status, created_at) VALUES (?, ?, ?, 'open', ?)")
inv.run('INV-1043', 'Acme – consulting', '1000000', now)
inv.run('INV-2001', 'Globex – licence', '250000000', now)
console.log('Seeded known sender and invoices')
