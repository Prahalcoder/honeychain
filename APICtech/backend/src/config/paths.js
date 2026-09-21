import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Local files that are NOT in the database: the embedded Postgres used when DATABASE_URL is empty,
// the ledger validator's signing key and (optionally) the wallet master key.
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(backendRoot, 'data')

export const VALIDATOR_KEY_FILE = path.join(DATA_DIR, 'validator-key.pem')
