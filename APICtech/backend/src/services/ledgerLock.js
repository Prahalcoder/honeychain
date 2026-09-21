import db from '../database/database.js'

// Only one writer at a time may extend the ledger (events or blocks), across every request and every
// process. Call it first inside a transaction: the lock is held until that transaction ends.
export const lockLedger = async () => { await db.prepare('SELECT pg_advisory_xact_lock(7001)').get() }

// A named lock for "read the highest number, use the next one" sequences (batch codes, invoice numbers).
// Take it first inside a transaction; it is released when that transaction ends.
export const lockNamed = async (name) => { await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(name) }
