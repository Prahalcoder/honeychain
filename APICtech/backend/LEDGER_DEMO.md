# Honey Chain backend demonstration

Proof for the jury: traceability events are hash-chained, sealed into validator-signed blocks, and the database rejects edits and deletes.

## What to show

1. Open the Supabase dashboard > Table Editor (schema `public`), or the SQL Editor.
2. Tables `traceability_events` (transactions) and `chain_blocks` (blocks):

```sql
SELECT height, tx_count, substr(block_hash, 1, 16) AS hash, substr(prev_hash, 1, 16) AS prev, validator_id
FROM chain_blocks ORDER BY height;
```

Each block points at the previous block's hash. Block 0 is the genesis block.

3. In the control room (any officer login) open **Blockchain**: latest blocks, each block's Merkle root and transactions, and **Verify every block now**.

## Live flow

1. Register a beekeeper in the beekeeper app, then sign in as the regional officer: the registration is in the review queue. Accept it and a block is sealed.
2. As the beekeeper record a harvest, share a lab result, create bottle QR codes. As the officer verify the lab result. Each action appears as a new block.
3. Scan a bottle QR (`/api/verify?pack_id=…`): the response lists the pack's events with their block numbers and the chain integrity.

## Immutability proof

```sql
UPDATE traceability_events SET payload_json = '{}' WHERE id = 1;
DELETE FROM chain_blocks WHERE height = 1;
```

Both are rejected (`traceability ledger is immutable`, `blockchain is immutable`). These are intentionally destructive attempts, so run them on a copy unless you want to show the rejection live.

If someone drops the triggers and edits data directly, **Verify every block now** reports the exact block and reason (`CURRENT_HASH_MISMATCH`, `MERKLE_ROOT_MISMATCH`, `INVALID_VALIDATOR_SIGNATURE`, …).

## Scope statement

This is a tamper-evident, single-validator (proof of authority) ledger in the shared backend database. It demonstrates Honey Chain's QR authenticity and traceability behaviour. It is not yet a decentralised multi-node blockchain; a permissioned network can replace the storage and signing layer later without changing event types, QR IDs or API contracts.
