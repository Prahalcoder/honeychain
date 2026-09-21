# Immutable ledger

The blockchain lives in the common secure database.

## Layers

1. **Events** (`traceability_events`): every harvest, lab decision, QR code and officer decision. Each stores the hash of the previous event and a SHA-256 hash of its own content.
2. **Blocks** (`chain_blocks`): each business action seals the events it produced into a block. A block holds the Merkle root of its events, the previous block hash, and an ed25519 signature from the validator node (`data/validator-key.pem`).
3. **Database rules:** Postgres triggers reject `UPDATE`, `DELETE` and `TRUNCATE` on events, blocks, validators and the audit log.

## What validation checks

`POST /api/admin/chain/validate` recomputes every event hash and link, every Merkle root, every block hash and every signature, and confirms each block covers exactly its transactions. Editing a payload, re-hashing an event, changing a Merkle root, or forging a block without the validator key all fail with a specific reason and block number.

## What it is not

A single validator signs every block (proof of authority), so this is a tamper-evident prototype, not a decentralised network. A multi-node permissioned network can replace the storage and signing layer without changing event types, QR IDs or the API.

## Privacy

Only identifiers, quantities, statuses and officer decisions are written. Contact details, GSTIN, finance and harvest notes stay in the common `user_settings` table or the company's private database.
