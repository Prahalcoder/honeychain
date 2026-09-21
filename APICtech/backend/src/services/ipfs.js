import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'

import db from '../database/database.js'
import { lockDown, pgDdl } from '../database/ddl.js'

// Content-addressed storage for the PUBLIC metadata of a batch (origin, lab values, officer).
// The identifier is a real IPFS CIDv1 (raw codec, sha2-256): the same bytes always give the same
// CID, and the CID is what the smart contract stores. The documents are kept in the ipfs_objects
// table, so they live in the same hosted database as everything else.
// Set IPFS_API_URL (for example http://127.0.0.1:5001 for a Kubo node) to pin them to a real IPFS
// node as well; for small files Kubo returns the same CID when asked for raw leaves.
await db.exec(pgDdl(`
  CREATE TABLE IF NOT EXISTS ipfs_objects (
    cid TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`))
await db.refresh()
await lockDown('public')

export async function cidOf(bytes) {
  return CID.createV1(raw.code, await sha256.digest(bytes)).toString()
}

export async function pinJson(value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2))
  const cid = await cidOf(bytes)

  await db.prepare('INSERT INTO ipfs_objects (cid, body) VALUES (?, ?) ON CONFLICT (cid) DO NOTHING').run(cid, bytes.toString('utf8'))

  let pinnedTo = null
  if (process.env.IPFS_API_URL) {
    try {
      const form = new FormData()
      form.append('file', new Blob([bytes]), `${cid}.json`)
      const response = await fetch(`${process.env.IPFS_API_URL}/api/v0/add?cid-version=1&raw-leaves=true&pin=true`, { method: 'POST', body: form })
      const result = await response.json()
      pinnedTo = result.Hash === cid ? 'ipfs-node' : `ipfs-node (its CID ${result.Hash} differs)`
    } catch {
      pinnedTo = 'ipfs-node unreachable, kept in the database'
    }
  }

  return { cid, bytes: bytes.length, pinnedTo }
}

// Reads a pinned document and checks it still hashes to its own CID.
export async function readPinned(cid) {
  if (!/^baf[a-z2-7]{20,}$/.test(String(cid))) return null
  const row = await db.prepare('SELECT body FROM ipfs_objects WHERE cid = ?').get(cid)
  if (!row) return null

  const bytes = Buffer.from(row.body, 'utf8')
  return { intact: (await cidOf(bytes)) === cid, json: JSON.parse(bytes.toString('utf8')) }
}
