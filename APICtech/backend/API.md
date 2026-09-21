# Honey Chain central API

One backend serves three clients: **Honey Chain Keeper** (`frontend/`), **Honey Chain Admin, the KVIC Control Portal** (`../../apictech-admin`) and the public consumer page opened by bottle QR codes. The blockchain is a validator-signed, hash-linked ledger in the common database (see `IMMUTABLE_LEDGER.md`).

> **AI assists. KVIC authorizes. Blockchain records. QR verifies.** AI produces analysis and forecasts; only a regional officer can verify a certificate; verification is digitally signed and chained; the QR shows the public result.

## Data layout

| Store | Location | Holds | Read by |
|---|---|---|---|
| Common secure DB | `apictech.db` | logins, organisation registry, review queues, audit log, blockchain, packs, custody | officers (`/api/admin`), consumers (`/api/verify`) |
| Private company DB | `data/companies/<ORG_CODE>.db` | hives, harvest notes, finance entries | only that company (`/api/company`) |
| Validator key | `data/validator-key.pem` | ed25519 key that signs blocks | the backend. **Back it up.** |

Admin routes never open a private database. Only the **monthly income total** reaches the common DB (`monthly_reports`). Environment (optional): `DATABASE_FILE`, `DATA_DIR`, `CORS_ORIGINS`, `PORT`, `JWT_SECRET`, `CAPTAIN_API_KEY`, `PUBLIC_VERIFY_PAGE_URL` (default `http://localhost:5175/verify` — the public Honey Chain website; use a LAN/public host so phones can open QR links).

## Roles

| Role | Scope |
|---|---|
| `BEEKEEPER` | own company only |
| `REGIONAL_OFFICER` | one state + region: approves registrations, reviews and signs lab certificates |
| `STATE_OFFICER` | one state: regions, production, income, batches, blockchain, regional officer performance; may suspend or reinstate |
| `KVIC_HEAD` | all states; creates/deactivates officers; officer activity, approvals, audit |
| Consumer | public QR page only |

Seeded demo logins (shown on both login pages; change before deployment): no beekeeper account is seeded (keepers register and wait for approval), one regional officer per registration location as `region.<location> / region@12345` (22 locations, e.g. `region.coimbatore`), `state.tn / state@12345`, `kvic.head / kvic@12345`. Every request re-checks the account, so deactivation is immediate.

## Registration and approval

`POST /api/auth/register` (public): `name`, `username`, `password` (8+), `organizationName`, `organizationType` (`KVIC_BEEKEEPER`, `ORG_BEEKEEPER`, `LOCAL_STARTUP`), `registrationId` (KVIC Madhukranti ID or the parent organisation's number), `registrationBody` (non-KVIC), `fssaiLicense` (14 digits), `state`, `region`; optional `gstin`, `email`, `phone`. Creates the user, a `PENDING_APPROVAL` organisation, its private database and an `ORGANIZATION_REGISTERED` chain event.

**A registration does not activate the account.** Until a regional officer approves, the keeper can sign in and read `/api/company/summary` and `/notifications` (to see status), and every other `/api/company/*` route returns `403 ORG_NOT_APPROVED`. `REJECTED` and `SUSPENDED` close the workspace the same way.

`POST /api/admin/organizations/:id/decision` `{ decision, note }`: `PENDING_APPROVAL` → `APPROVED`/`REJECTED` (any officer in scope); `APPROVED` → `SUSPENDED` and `REJECTED`/`SUSPENDED` → `APPROVED` (state officer or KVIC head). Reasons are required for rejection and suspension. Every decision is a chain event and an audit row.

## Laboratory workflow

1. Keeper `POST /api/company/lab-requests` `{ batchCode, labName, note }` → `REQUESTED`.
2. The laboratory's certificate is submitted: `POST /api/company/lab-requests/:id/result` `{ certificateReference, status, testedAt, results }`. The server runs the **AI-assisted analysis** and creates a `PENDING` review for the regional officer.
3. Officer `GET /api/admin/lab-reviews` returns each review with `ai`: risk level, per-value findings against reference limits, anomalies (certificate says PASSED but values exceed limits, test date before harvest or >90 days after, **certificate number reused on another batch**, missing values) and the points needing attention. The current engine (`rule-based-v1`) is deterministic and its limits are configuration in `services/labAnalysis.js`. It never approves anything.
4. Officer `POST /api/admin/lab-reviews/:id/decision` `{ decision, note, password }`:
   - `REJECTED` needs a reason.
   - `VERIFIED` needs the officer's **password**, which unlocks their ed25519 signing key and signs the certificate details (batch, certificate, lab, declared status, test date, results hash, officer, role, region, time). The signature, key fingerprint and payload hash go on the chain (`LAB_RESULT_VERIFIED`).
   - Officer keys are stored AES-256-GCM encrypted under a scrypt key derived from the password. A password change or reset rotates the key on the next signature; old signatures stay verifiable through the stored public key.

Chain events for one batch: `HARVEST_RECORDED`, `LAB_TEST_REQUESTED`, `LAB_RESULT_SUBMITTED`, `LAB_RESULT_VERIFIED` or `LAB_RESULT_REJECTED`, `PACK_BATCH_CREATED`, `PACK_CREATED`, `CUSTODY_TRANSFER`.

## Packaging, QR and the bottle limit (`/api/platform`)

**Packaging is locked** until an officer has verified a certificate that says the batch **passed**. `POST /pack-batches` returns `403 PACKAGING_LOCKED` (with `labStatus`) otherwise; `GET /api/company/batches` reports `packaging: { unlocked, labStatus, reason }`. Keeper and captain custody transfers are locked the same way.

`POST /pack-batches` `{ batchCode, productName, jarSizeGrams, quantityToPack }`. The honey in a batch caps the QR codes: `floor((batch grams − grams already reserved) / jarSizeGrams)`. A 5 kg batch of 500 g bottles allows 10 QR codes in total; more returns `409 BOTTLE_LIMIT_EXCEEDED` with `maxBottles`. `POST /pack-batches/:code/packs` creates the unique jar IDs (idempotent); QR URLs point to the consumer page `PUBLIC_VERIFY_PAGE_URL?pack_id=…`.

## Consumer verification (public)

``GET /api/verify?pack_id=…` (a jar) or `GET /api/verify?batch=HC-…` (a whole batch; `scope: 'BATCH'`, no per-jar events) — both rendered by the public website's `/verify` page — return:
- `authenticity`: `VALID` (active jar, approved producer, intact chain, verified lab certificate with a **valid officer signature**), `NOT_CERTIFIED` (no verified certificate or the signature fails), `UNDER_REVIEW` (broken chain, flagged jar or unapproved producer), plus a plain-language `reason`.
- `product`, `producer` (name, origin, FSSAI), `laboratory` (lab, certificate, key values), `approval` (officer, designation, signed time, `signatureValid`, key fingerprint), `timeline` (event labels with block numbers), `supplyChain` (KEEPER → DISTRIBUTOR → RETAILER → CONSUMER) and chain integrity.
- Never exposed: contact details, GSTIN, finance, officer notes, event payloads.

## Keeper API (`/api/company`, approved organisations)

`GET /summary`, `GET/POST /hives`, `GET/POST /harvests` (server assigns the batch code; notes go to the private DB), `GET /batches` (capacity + packaging status), `GET/POST /finance` and `DELETE /finance/:id` (private DB; updates the shared monthly income), lab routes above, `POST /transfers` (keeper → `WHOLESALER`/`RETAILER`, after verification), `GET /notifications`, `GET /insights`, and the business ledger: `/buyers` (with invoice counts; there is no separate orders module), `/invoices` (create with line items and GST; `PATCH` to `Paid` books the amount as income in Finance and in the monthly total shared with KVIC) and read-only `/inventory` (harvested, in bottles, sent down the chain, still held). A new keeper starts with all of these empty; nothing is pre-filled. Hive and harvest locations default to the farm name the keeper registered with.

`GET /insights` is the **AI finance and production intelligence** (`statistical-v1`): next-month income, expense, profit and honey forecasts with a range and confidence that reflects how much history exists, income and cost per kg, expense categories, and written insights. It is a least-squares trend, so it needs about three months of records to say anything meaningful.

Hive health lives in the IoT monitor: `GET :5001/api/insights` (`beehive/python_app/insights.py`, `rule-based-v1`) turns recent sensor readings into a health score, risk indicators (chilled brood, overheating, chalkbrood/fungal, ventilation/CO₂, weak colony, falling weight) and actions. These are indicators, not a diagnosis. Hive weight appears when the ESP32 reports `weight_kg`.

## Admin API (`/api/admin`, scoped by jurisdiction)

`GET /overview`, `GET /organizations`, `GET /organizations/:id`, `POST /organizations/:id/decision`, `GET /lab-reviews`, `POST /lab-reviews/:id/decision`, `GET /batches`, `GET /batches/:code`, `GET /reports/organizations?month=` (state/head: income, honey, bottles per company), `GET /analytics/regions` (state/head: per-region or per-state production, verification counts, average approval times and officer decisions), officer management (`GET/POST /officers`, `PATCH /officers/:id`, `POST /officers/:id/reset-password`, head only for changes), `GET /activity`.

Blockchain (all three officer levels): `GET /chain/summary`, `POST /chain/validate`, `GET /chain/blocks`, `GET /chain/blocks/:height`, `GET /chain/events?entityType=&entityId=&orgId=`.

## Organisation closure (formal, with government formalities)

Statuses `CLOSURE_PENDING` and `CLOSED` join `PENDING_APPROVAL/APPROVED/REJECTED/SUSPENDED`. A keeper can start a closure (`POST /api/company/closure` `{ reason, password, declarations:{dues,stock,records} }`, withdraw with `DELETE`; `GET` returns the checklist), or an officer can (`POST /api/admin/organizations/:id/closure` `{ reason }`). While pending the workspace is locked.

Officers work the request under `GET /api/admin/closures?status=OPEN|ALL`: `POST /closures/:id/complete` `{ items:{fssai:{confirmed,reference},…}, note }` or `POST /closures/:id/decline` `{ note }`. The checklist covers FSSAI licence surrender (FoSCoS reference required), GST cancellation (REG-16, final return GSTR-10 — only if a GSTIN is on file), KVIC/National Bee Board (Madhukranti) / parent-organisation withdrawal, scheme dues and subsidy settlement, and records retention. It is guidance for the officer to verify on the official portals; the platform does not call them. Completion requires every applicable item confirmed, no open lab work, and a closing note; it disables the owner login, moves the private database to `data/archive/`, and records `ORGANIZATION_CLOSURE_REQUESTED` and `ORGANIZATION_CLOSED` on the chain. Jars packed earlier stay verifiable and show the producer as closed.

## Loose honey sales (keeper supply chain)

Under `/api/company/sales` (approved organisations). After a harvest the keeper sells **loose honey** to a named wholesaler (or another buyer from the Buyers list) in kg or grams at a fixed price per kg. The wholesaler tests the honey themselves and sells it on, so **no KVIC lab certificate is needed** for a loose sale (packing the keeper's own QR jars still needs one).

- `GET /stock`: per batch, harvested kg, kg reserved for QR jars, kg sold loose, and kg still available to sell.
- `POST /` `{ buyerId, batchCode, quantity, unit: 'kg'|'g', pricePerKg, gstPercent?, saleDate?, paid?, note?, publicName? }`. At least 50 g. More than is available returns `409 NOT_ENOUGH_HONEY`. It creates a bill in Billing (`INV-…`, line item with quantity and price; `paid: true` marks it paid and books the amount as income in Finance and in the monthly total shared with KVIC), stores the sale (`SAL-YYYY-NNN`) in the company's **private** database, and seals the hand-over on the chain.
- `GET /` lists sales with payment status; `POST /:id/cancel` `{ reason }` works only while the bill is unpaid: the honey returns to the batch, the bill is cancelled and the hand-over is reversed. Paying a bill uses `PATCH /api/company/invoices/:id`.
- The common database only learns the quantity (`loose_sales`), so the QR jar limit for the batch becomes `floor((harvested − loose sold − jars already reserved) / jar size)`.
- On the chain: a `CUSTODY_TRANSFER` (metadata `sale: LOOSE`, grams; **never the price**), shown on the public *batch* page as a distributor or retailer link. A jar's own page does not show loose sales of its batch. A sale to a Direct Consumer records `DIRECT_SALE_RECORDED` and never publishes a name. With `publicName: false` the buyer shows as "name withheld".
- The earlier jar-shipment endpoints were removed.

## Scanned lab certificate (optional PDF)

A keeper can attach a scanned copy of the lab certificate as proof: `PUT /api/company/lab-reviews/:id/document` with the raw PDF as the body (`Content-Type: application/pdf`, header `x-file-name`). Only PDFs (checked by content, not just the name) up to **10 MB** are accepted (`413` above that), and only while the officer has not decided yet; a new upload replaces the old one. `GET /api/company/lab-reviews/:id/document` reads it back for the keeper, and `GET /api/admin/lab-reviews/:id/document` for the officers of that jurisdiction; the review lists carry the file name, size and SHA-256. The file is stored under `data/lab-documents/`, and the chain records a `LAB_DOCUMENT_ATTACHED` event with the fingerprint. It is **optional for now**. Start the backend with `REQUIRE_LAB_DOCUMENT=true` to make it compulsory: an officer then cannot verify a certificate that has no scanned copy.

## Notice board and help desk

- `GET/POST /api/admin/announcements`, `DELETE /api/admin/announcements/:id`, `GET /api/admin/announcements/targets`. Body: `{ title, body, priority: NORMAL|IMPORTANT|URGENT, audience: { keepers, officers: ['STATE_OFFICER','REGIONAL_OFFICER'], states, regions, orgIds } }`.
  - **Regional officer:** always the keepers of their own region (optionally chosen keepers of that region). Nobody from another region can read it. The state officer of that state and the KVIC head see it as oversight.
  - **State officer:** keepers and/or regional officers of their state (all, chosen regions, or chosen keepers). Regional officers of that state read it under their notifications.
  - **KVIC head:** everyone, or any mix of keepers, state officers, regional officers, chosen states, chosen regions or individual keepers. A notice addressed to officers only is never visible to keepers. Regional officers also see, as notifications, what higher offices sent to keepers of their region.
  - Keepers read theirs at `GET /api/company/announcements` (dashboard notice board) and in `GET /api/company/notifications`.
- `GET /api/admin/notifications` feeds the officer bell: waiting registrations, lab results, closures, inspections due, keeper questions, and notices from other offices.
- `GET /api/admin/directory` lists who covers each state and region (a regional officer sees only their own line of command). `GET /api/company/support` lists the officers who cover the keeper.
- A state officer exists for every state (`state.<state>`, Tamil Nadu is `state.tn`).

## Help desk tickets

Every keeper question is a **ticket**, a conversation held apart from all others. Tickets live in the common database (`tickets`, `ticket_messages`, `ticket_escalations`).

- **Keeper** (`/api/company`): `GET/POST /tickets` (`{ subject, message }`, max 5 open), `GET /tickets/:id`, `POST /tickets/:id/messages` `{ body }`. Text only, and only the keeper's **regional officer** reads and answers it. The keeper never sees internal notes or reasons; they see events such as "escalated to the state office" and "closed". Replies reach the keeper's notifications. A closed ticket cannot receive messages.
- **Regional officer** owns the ticket: `POST /api/admin/tickets/:id/messages` `{ body }` (to the keeper) or `{ body, internal: true }`; `POST /escalate` `{ target: 'STATE', reason }` hands it to the state officer **at once**; `{ target: 'CENTRAL', reason }` is only a **request** and reaches the central office **only if the state officer approves**; `POST /close` and `POST /reopen` (**only the regional officer can close or reopen**).
- **State officer** sees tickets escalated to the state office and pending central requests in their state: internal notes only, `POST /central-decision` `{ decision: 'APPROVED'|'DECLINED', note }` (a decline needs a note), `POST /return` `{ note }` back to the regional officer.
- **KVIC head** sees only tickets the state officer approved: internal notes, and `POST /return` back to the state office.
- `GET /api/admin/tickets?filter=ALL|OPEN|ESCALATED|CLOSED`, `GET /api/admin/tickets/:id`; `openSupport` in `/api/admin/overview` counts tickets waiting for the viewer. Escalations, decisions, hand-backs and closures are written to the audit log.
- The older one-shot `support_requests` table and its endpoints were replaced by tickets.

## Inspections (audits)

Any officer can inspect organisations in their jurisdiction (`APPROVED` or `SUSPENDED` only, one open inspection per organisation).

- `POST /api/admin/inspections` `{ orgId, purpose, date, time?, instructions? }`: the date must be **at least tomorrow** (one day's notice) and within 90 days. The keeper sees the notice at once (`GET /api/company/notifications`, `GET /api/company/inspections`, `summary.inspection`) and a reminder the day before and on the day. `POST /api/company/inspections/:id/acknowledge` lets the keeper confirm.
- `POST /api/admin/inspections/:id/report`: filed on or after the notified date, with inspector, who was present, all 8 checklist points rated (`OK/MINOR/MAJOR/NA`, a note is mandatory for MAJOR), honey stock counted on site (compared with the chain's record), grade `A-D` (the UI suggests one from the checklist), outcome (`NO_ACTION`, `CORRECTIVE_ACTION`, `RE_INSPECTION`, `CLOSURE_RECOMMENDED`; `CORRECTIVE_ACTION` and `RE_INSPECTION` need a list of actions and a future deadline), remarks (shown to the keeper) and an officer-only note.
- `POST /api/admin/inspections/:id/cancel` `{ reason }` (keeper is told), `GET /api/admin/inspections?status=`, `GET /api/admin/inspections/meta`.
- `POST /api/admin/inspections/:id/closure` `{ reason }`: issues a **closure notice based on the audit** (report graded C or D, or recommending closure). It starts the normal closure workflow above, linked to the inspection, and the keeper sees the notice.
- The chain records `INSPECTION_SCHEDULED`, `INSPECTION_COMPLETED` (grade and outcome only) and `INSPECTION_CANCELLED`; the detailed report stays in the common database, and the audit log records each action. `GET /api/admin/overview` returns `inspectionsDue` (notified date reached, no report yet).

## Custody transfers (captain app)

`POST /api/traceability/batches/:batchCode/transfers` with `x-apictech-api-key`. Requires enough balance, an approved producer and a verified batch.

## Before production

1. One API key per captain installation instead of the shared `CAPTAIN_API_KEY`; idempotency keys on transfers.
2. HTTPS, login rate limiting, a real public verification domain.
3. Replace the single-validator chain with a permissioned multi-node network.
4. Change the seeded demo passwords; back up `data/validator-key.pem`.
5. Review the lab reference limits in `services/labAnalysis.js` against the current FSSAI standard, and consider a language-model layer behind the same analysis interface.

## Smart contract, IPFS and system health

| Method and path | Who | Purpose |
|---|---|---|
| `GET /api/chain/status` | public | contract address, chain id, network host, explorer URL, latest block, anchored ledger head, outbox counts |
| `GET /api/chain/outbox?limit=` | KVIC head, state officer | transactions sent to the contract, with hash, block, attempts and last error |
| `GET /api/verify/onchain?pack_id=` or `?batch=` | public | database facts plus a live read of the contract (registered, certified, officer, weights, metadata CID, jar Merkle proof) |
| `GET /api/ipfs/:cid` | public | the public metadata JSON; the header `X-Content-Integrity: cid-verified` shows the content matches its CID |
| `GET /api/admin/system/health` | KVIC head | every schema read and counted (common + one per company), latest exports, chain status, outbox |
| `POST /api/admin/system/backup` | KVIC head | write a portable export now |

## Public shop and keeper orders

| Method and path | Who | Purpose |
|---|---|---|
| `GET /api/shop/states` | public | every state with the number of sellers per region |
| `GET /api/shop/sellers?state=&region=` | public | sellers with stock |
| `GET /api/shop/sellers/:code` | public | seller address, phone, FSSAI and products with stock and lab status |
| `POST /api/shop/orders` | public | place an order (seller, product, quantity, buyer name, phone, address, PIN) |
| `GET /api/shop/orders/:code?phone=` | buyer | order, payment QR data, timeline |
| `POST /api/shop/orders/:code/paid` | buyer | send the UPI reference |
| `POST /api/shop/orders/:code/cancel` | buyer | cancel an unpaid, unshipped order |
| `GET/POST/PUT /api/company/shop/products` | keeper | products for sale |
| `GET /api/company/shop/orders` | keeper | orders with buyer details |
| `PATCH /api/company/shop/orders/:code/payment \| ship \| deliver \| cancel` | keeper | payment received, shipped (courier, tracking), delivered, cancel |
| `GET/PUT /api/auth/settings` | keeper | profile, organisation, address, UPI ID, own offices |
