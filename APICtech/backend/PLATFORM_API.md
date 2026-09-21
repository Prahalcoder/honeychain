# Platform notes

Superseded by [API.md](API.md), which documents roles, approvals, private company databases, the bottle limit and the admin API.

Quick reference for the packaging flow:

1. Record a harvest: `POST /api/company/harvests` (server assigns the batch code).
2. Create a packaging batch: `POST /api/platform/pack-batches`. Bottle count is limited by the honey left in the batch (`409 BOTTLE_LIMIT_EXCEEDED`).
3. Generate the bottle IDs: `POST /api/platform/pack-batches/:packBatchCode/packs`.
4. Public verification, no login: `GET /api/verify?pack_id=…`.
5. Validate the whole chain: `GET /api/platform/traceability/validate` (beekeeper) or `POST /api/admin/chain/validate` (officers).
