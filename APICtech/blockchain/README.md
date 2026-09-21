# APICtech Honey Chain

This directory is intentionally a clean starting point for the APICtech Honey Chain. The old Bitcoin tutorial, wallet demo, mined data, virtual environment, and Hardhat experiment were removed.

## Purpose

Honey Chain will record only traceability facts:

- Harvest lot created
- Lab result attached
- Processing batch created
- Pack/bottle created
- Custody transfer recorded
- Recall or review status changed

Personal data, GSTIN, addresses, phone numbers, sensor readings, images, PDFs, and financial details stay in the APICtech database or file storage. The chain receives IDs, event types, quantities, party IDs, timestamps, and document hashes.

## Planned boundary

The APICtech backend remains the only component allowed to write to the chain:

```text
Participant app / future captain app
                |
                v
       APICtech backend
          /          \
   SQLite data     Honey Chain
                |
                v
       Public QR verification
```

The frontend must never hold a chain private key. The future chain adapter will live behind the backend and expose the existing traceability API without changing the participant app.

## Implementation phases

1. Define the Honey Chain event schema and append-only rules.
2. Build a local development ledger with deterministic tests.
3. Connect harvest, lab, packaging, and custody events from the backend.
4. Connect QR verification to the latest verified event history.
5. Add signed backend writes and operator identity.
6. Replace the local ledger with a permissioned network or public EVM deployment only after the database workflow is accepted.

## Current prototype

The working version is a database-backed blockchain in the shared APICtech SQLite database. Events (`traceability_events`) are sealed into blocks (`chain_blocks`) carrying a Merkle root and an ed25519 validator signature, and the beekeeper app, regional, state and KVIC head officers all read the same history. See `backend/IMMUTABLE_LEDGER.md`.

Earlier notes on the event table:

Each event contains:

- `entity_type` and `entity_id`
- `event_type`
- `payload_json`
- `created_by` and `created_at`
- `prev_hash`
- `current_hash`

SQLite triggers reject `UPDATE` and `DELETE` operations on this table. The backend validator recomputes every `current_hash` and checks every `prev_hash` link.

## QR proof for a presentation

1. Create a harvested batch in the participant app.
2. Create a packaging batch and bottle pack IDs in QR Management.
3. Open a generated QR verification URL:

```text
GET /api/verify?pack_id=<pack-id>
```

4. Show the response fields:

```json
{
       "authenticity": "VALID",
       "timeline": [
              { "event_type": "PACK_CREATED", "prev_hash": "...", "current_hash": "..." }
       ],
       "ledger": {
              "valid": true,
              "events": 1,
              "lastHash": "..."
       }
}
```

5. Show the authenticated validation endpoint:

```text
GET /api/platform/traceability/validate
```

This prototype does not claim to be a decentralized public blockchain yet. It demonstrates the required immutable, tamper-evident traceability behavior in the shared database. A permissioned network adapter can replace the storage layer later without changing QR IDs or participant API contracts.
