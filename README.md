# Honey Chain

A blockchain-based system for honey traceability and smart beekeeping (SIH problem statement 26021, KVIC / Ministry of MSME).

> **AI assists. KVIC authorizes. Blockchain records. QR verifies.**

## Run everything with one command

```bash
cd "E:\vs\SIH"
npm start
```

That starts the local database, the local blockchain, the API, the Python IoT monitor, Honey Chain Keeper, Honey Chain Admin and the public website together (labelled output, Ctrl+C stops all). The first run installs any missing dependencies.

| App | URL |
|---|---|
| Public Honey Chain website (verify a jar or batch, schemes, about honey) | http://localhost:5175 |
| Honey Chain Keeper | http://localhost:5173 |
| Honey Chain Admin (KVIC Control Portal) | http://localhost:5174 |
| API | http://localhost:5000/api/health |
| IoT hive monitor | http://localhost:5001 |
| Blockchain node (JSON-RPC) | http://127.0.0.1:8545 |
| PostgreSQL | 127.0.0.1:54329 (database honeychain, user postgres, password postgres) |

Bottle QR codes open the public website's `/verify` page.

## Use it on a phone (same Wi-Fi)

The three apps and the API listen on the network, and the apps talk to the API at whatever address you opened them with, so a phone works without any setting.

1. Connect the phone to the same Wi-Fi as the computer.
2. Run `npm start`. The start-up message ends with `On your phone (same Wi-Fi)` and three addresses such as `http://192.168.1.8:5173`. Type one into the phone's browser.
3. The first time, Windows Firewall may block the phone. Either click **Allow** when Windows asks (tick **Private networks**), or run this once in PowerShell **as administrator**:

   ```powershell
   New-NetFirewallRule -DisplayName "Honey Chain" -Direction Inbound -Protocol TCP -LocalPort 5000,5173,5174,5175 -Action Allow -Profile Private
   ```

   The Wi-Fi network must be set to **Private** in Windows (Settings > Network > Wi-Fi > your network).
4. Bottle QR codes point to the computer's Wi-Fi address (`http://192.168.1.8:5175/verify?...`) so that a phone can open them. Set `PUBLIC_VERIFY_PAGE_URL` in `APICtech/backend/.env` to use another address. Codes printed on one network stop working on another; if the address changes, reprint them.

The layouts adapt to a phone: the sidebar becomes a menu that slides in, wide tables scroll sideways inside their own box, and the top bar drops its extra buttons.

## Languages

All three apps have a language menu: **English, Hindi, Tamil, Telugu, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia and Urdu** (Urdu reads right to left). Keeper and Admin translate the everyday screen text (menus, buttons, labels, statuses, form fields, help and notice-board headings) from dictionaries in `src/lang/`. The public website translates its menus, buttons and verification screens. Long explanatory sentences that are not in a dictionary stay in English, and Hindi has the widest coverage. The translations are a first draft: have a native speaker review them before public release. Edit `tools/lang/rows*.txt` (Keeper and Admin) or `tools/lang/web-rows.txt` (website), then run `node tools/lang/build.mjs` and `node tools/lang/build-web.mjs`.

## Colours

The apps use **teal `#0F766E`, blue `#2563EB` and coral `#F97360`**. `python tools/recolor.py` re-applies the palette to the source if old colours creep back in. The bee logo image is still the original yellow artwork.

## Folders

| Folder | What it is |
|---|---|
| `honeychain-web` | Public Honey Chain website (port 5175): scroll-driven bee story, verify by batch number / jar ID / QR, government schemes, about honey |
| `APICtech/frontend` | **Honey Chain Keeper** (React + Vite, port 5173) |
| `apictech-admin` | **Honey Chain Admin, KVIC Control Portal** for the KVIC Head, State and Regional Officers (port 5174) |
| `APICtech/backend` | Express API (port 5000) on PostgreSQL: a common schema plus one private schema per company |
| `APICtech/beehive` | ESP32 firmware and the Flask hive monitor with AI hive-health analysis (port 5001) |
| `APICtech/blockchain` | Notes on the ledger design |

## Run

```bash
cd APICtech/backend && npm install && npm run dev      # API :5000 (also starts the Flask monitor)
cd APICtech/frontend && npm install && npm run dev     # Keeper :5173
cd apictech-admin && npm install && npm run dev        # Admin :5174
```

The first backend start migrates an existing `apictech.db` in place and seals existing events into block 1. Back up `apictech.db*` first if you want a way back. Keep `APICtech/backend/data/validator-key.pem` safe.

## Login details (demo, also shown on the login pages)

| App | Username | Password |
|---|---|---|
| Keeper | *(none seeded — register a new organisation in the keeper app)* | |
| Admin, Regional Officer (one per location) | `region.<location>`, e.g. `region.madurai`, `region.coimbatore`, `region.kochi` | `region@12345` |
| Admin, State Officer (one per state) | `state.tn`, `state.kerala`, `state.karnataka`, `state.maharashtra`, `state.uttar-pradesh`, `state.punjab`, `state.uttarakhand`, `state.himachal-pradesh` | `state@12345` |
| Admin, KVIC Head | `kvic.head` | `kvic@12345` |

## Inspections and audits

Regional officers, state officers and the KVIC Head can schedule an inspection of any organisation in their jurisdiction from **Inspections** in the admin app (or from an organisation's page). The date must be at least a day ahead; the keeper is notified immediately in Honey Chain Keeper and reminded the day before. After the visit the officer files a report: checklist ratings, stock counted against the blockchain record, grade A-D, outcome and remarks (the keeper sees the grade and remarks, not the officer-only note). A report graded C or D, or one recommending closure, lets the officer issue a **closure notice** that starts the formal closure workflow.

## Notice board, help and schemes

- **Notice board.** A regional officer's notice reaches only the keepers of that region (state and national offices see it as oversight). State officers reach their state's keepers and regional officers. The KVIC head can address everyone or pick exactly who: keepers, state officers, regional officers, chosen states or regions, even individual keepers. Officer-only notices are never visible to keepers. Keepers see notices on the dashboard and in the bell; officers see them in the bell too.
- **Help & Support with tickets.** Keepers get a guide, FAQ, official contacts and tickets (the `?` in the top bar). Each question is a separate ticket, a private conversation held only with the keeper's regional officer, who alone can close it. The regional officer can hand a ticket to the state officer straight away, or ask to take an urgent one to the central office, which happens **only if the state officer approves**. State and central officers add internal notes that keepers never see. Officers get **Help & roles**: what each role can and cannot do, who covers every state and region, guides, and the Tickets tab.
- **Government Schemes** in the keeper sidebar lists NBHM, Madhukranti, KVIC Honey Mission, PMEGP and FSSAI with links to the official portals, in English and Hindi.

## Sellers nearby, orders and addresses

- **Addresses.** A keeper enters an address (street, village or town, district, PIN code) when registering, and can change it in Keeper > Settings > **Organisation and address**, which also shows the state, region, registration number and the keeper's own KVIC offices. Keepers registered before addresses existed got a made-up sample address, marked "sample" until they save a real one. The central, state and regional offices are in the `offices` table and are shown in Admin > Help and roles > Who covers what. The KVIC head office address is the real one; the state and regional office streets are made up (marked sample), the town PIN codes are real.
- **Selling.** Keeper > **Orders** > Products for sale: pick a packaging run of a lab-verified batch, set a price per jar and how many jars to sell. The jars appear on the website at **/sellers** (state, region, seller, address, phone, stock).
- **Buying.** No account: the buyer chooses a product, enters name, mobile number and delivery address, and lands on an order page (`/order/ORD-...`) with the seller's **UPI QR code**, a box for the UPI reference number after paying, and the order steps. The buyer tracks the order with the order code and the mobile number. If the seller has not entered a UPI ID (Settings), the page shows a clearly marked demo QR.
- **Fulfilment.** Keeper > Orders shows each order with the buyer's details, the payment status (not paid / buyer says paid / payment received) and the parcel status. The keeper confirms the payment, then marks it shipped (courier and tracking number), then delivered. Cancelling puts the jars back on sale.
- **Privacy.** Products, prices and stock are public. Buyer names, phone numbers and delivery addresses stay in the seller's private schema (`shop_orders`); the common database only keeps the order code and the seller (`shop_order_index`).
- The website text for this page is in English and Hindi; other languages fall back to English. Payment is not checked automatically: the seller confirms it after seeing the UPI reference.

## Database and blockchain: everything runs on this computer

`npm start` starts, before anything else:

| Service | What it is | Where |
|---|---|---|
| **db** | a real **PostgreSQL 18** server (downloaded automatically from npm the first time, nothing to install by hand) | `127.0.0.1:54329`, database `honeychain`, user `postgres`, password `postgres`. Data in `APICtech/backend/data/pgdata`, kept between runs |
| **chain** | a local Ethereum chain with the HoneyChain smart contract | `http://127.0.0.1:8545` (chain id 31337). It is free and needs no wallet, faucet or account |

Both listen on this computer only. Ctrl+C stops everything and shuts the database down cleanly.

### See the database (like any Postgres)

Install a free viewer such as **pgAdmin** (pgadmin.org) or **DBeaver** (dbeaver.io) and connect with:

```
Host 127.0.0.1    Port 54329    Database honeychain    User postgres    Password postgres
```

(or `psql "postgresql://postgres:postgres@127.0.0.1:54329/honeychain"`). What you will see:

| Schema | What it holds |
|---|---|
| `public` | the **common database**: `users`, `organizations`, `lab_reviews`, `tickets`, `audit_log`, the ledger (`traceability_events`, `chain_blocks`, `chain_validators`), the batch and jar records (`batches`, `pack_batches`, `packs`), lab PDFs (`lab_documents`), public metadata (`ipfs_objects`) and the smart-contract queue (`chain_outbox`, `chain_wallets`) |
| `co_org_2026_xxxxxxxx` | one **private database per company**: `hives`, `harvests`, `finance_entries`, `buyers`, `honey_sales`, `invoices`. The admin API never reads these |
| `archive_org_...` | a closed company's private data, kept for the statutory period |

Only start the database on its own with `npm run db:local` in `APICtech/backend`.

### See the blockchain

There are two layers and both can be shown:

- **Audit ledger, as SQL tables.** In pgAdmin/DBeaver open `public.traceability_events` (every action, each row holding the hash of the row before it) and `public.chain_blocks` (Merkle root, previous hash, validator signature). Admin > Blockchain re-verifies every hash.
- **Smart contract.** Admin > Blockchain > Smart contract shows the contract address, the block number and every transaction sent to it (`public.chain_outbox` lists the same with their hashes). The local chain has no public block explorer; the inspector below decodes its events.

### One-page inspector

With `npm start` running, in a second terminal:

```bash
npm run inspect
```

It opens http://localhost:5177: the common tables, each company's private tables, the ledger re-verified hash by hash, and the smart contract read live from the chain (events, transactions, signing accounts, queue). Nothing is generated; it reads the real data. Password hashes and encrypted keys are never displayed.

### How to tell it is working

1. The start-up banner says `Database: PostgreSQL running on this computer` and the API log says `[chain] connected to chain 31337, contract 0x...`.
2. `npm run db:verify` in `APICtech/backend` prints `ok  common ... 33 tables`.
3. In pgAdmin, `public.users` already holds the officer logins.
4. Register a keeper in the app, approve it as the regional officer, harvest a batch, and verify its lab result as the officer. A new `co_org_...` schema appears, `traceability_events` and `chain_blocks` grow, and `chain_outbox` rows turn `CONFIRMED` with a transaction hash.
5. Scan or open the jar on the public website: the on-chain card shows the contract and the checks.

The local chain forgets everything when it stops; the API notices and re-sends every record from the database, so the chain is filled again a few seconds after `npm start`. The database itself is kept.

### Exports and checks

```bash
npm run db:verify      # reads every schema and counts tables and rows
npm run db:backup      # portable export (one file per table + SHA-256 manifest); also taken daily
npm run db:list
npm run db:check -- <export-folder>
```

Copy the folder `APICtech/backend/data/pgdata` (with the database stopped) to keep a full copy of the database.

### Optional, later: hosted database and public testnet

Nothing above needs an account. If you ever want the data on the internet:

- **Supabase**: put its Session pooler string in `APICtech/backend/.env` as `DATABASE_URL=...`. `npm start` then no longer starts the local database. Tables are created automatically.
- **Polygon Amoy** (public test network, free test funds from a faucet): set `CHAIN_RPC_URL=https://polygon-amoy-bor-rpc.publicnode.com` and `CHAIN_PRIVATE_KEY=0x...` (a new account with test funds only), then `npm run deploy` in `blockchain/`. `npm start` then no longer starts the local chain, and transactions link to https://amoy.polygonscan.com. Details: `blockchain/README.md`. This was not tested against the real services.

Keep `WALLET_MASTER_KEY` (in `.env`) with the data if you set it: it encrypts the keeper and officer signing accounts. Without it, a key file `data/wallet-master.key` is created and must be kept.

### What the smart contract does (`blockchain/contracts/HoneyChain.sol`)

- **Dual-signature minting (EIP-712).** A batch is registered with the **harvester's** signature and becomes *certified* only with a second signature from a **certified officer** account.
- **Jars** are registered as one Merkle root; the contract enforces `jars + loose sales <= harvested weight`, and a jar is proven with a Merkle proof.
- **Loose sales** and their reversals count against the same weight.
- **Anchoring.** The head of the audit ledger is written to the contract every few minutes, so the two layers vouch for each other.
- **Public metadata** (batch, lab result, officer, no private data) is a content-addressed JSON with a real CIDv1, stored in `ipfs_objects` and served at `/api/ipfs/<cid>` (pinned to an IPFS node as well when `IPFS_API_URL` is set). The contract stores the CID.
- **Reliable link.** The API never waits for the chain. It writes an intent to `chain_outbox` in the same step as the business action; a worker signs and sends it, retries on failure, and waits (without losing anything) when the relayer has no gas.

### Hardening

Login / register / verify rate limits, security headers, a refusal to start in production with a weak `JWT_SECRET`, the ledger tables refuse update, delete and truncate (database triggers), the ledger and the batch / invoice numbers are written one at a time (advisory locks), and the API refuses to start if it cannot read every schema.

Found in a review of the whole flow and fixed:

- **Sessions.** Changing or resetting a password ends every older sign-in (the device that changed it gets a new one).
- **Login.** An unknown user takes as long to reject as a wrong password, and ten wrong passwords for one account within 15 minutes make that account wait (`LOGIN_ATTEMPTS_PER_ACCOUNT`).
- **Honey stock.** Packing jars and selling loose honey re-check the remaining honey under a lock, so two requests at the same instant cannot both take the last kilograms.
- **Orders.** A buyer cannot cancel after sending the payment; an order nobody pays is cancelled after `SHOP_HOLD_HOURS` (24) and its jars go back on the shelf; a seller cannot set the stock higher than the jars packed minus the jars already ordered; a company with open orders cannot request closure, and an officer's closure cannot be completed until they are shipped or cancelled.
- **Harvest dates** older than two years are refused.
- **IoT server.** It listens on the network (the ESP32 needs that) but the Flask debugger is off unless `IOT_DEBUG=1`; set `IOT_HOST=127.0.0.1` when no hardware is used.

## Showing the databases and the chain to the jury (one page)

Start everything with `npm start`, use the apps for a while (register a keeper, approve, harvest, verify the lab result, create jars, sell loose honey), then in a second terminal:

```bash
npm run inspect
```

opens http://localhost:5177, a read-only inspector of the **real** data (nothing is generated or seeded). Tabs: the **common database**, **every company's private schema** (with the proof that only the monthly income total is shared), the **blockchain ledger** (re-verified hash by hash) and the **smart contract**, read directly from the chain: contract address, block number, decoded events, transactions with the function called and the signer, the signing accounts and the outbox, with links to Polygonscan. Password hashes and encrypted keys are never displayed. `npm run jury` writes the same view as one offline file, `Honey-Chain-Data-Explorer.html`.

The public website's verify page shows the same proof to a consumer: the contract, whether the batch is registered and certified on chain, the transaction (linked to Polygonscan) and block, the metadata CID and, for a jar, the Merkle-proof check done by the contract.

## Comparison with "Beevil Knievel" (another SIH 2026 entry)

| Topic | Beevil Knievel | Honey Chain |
|---|---|---|
| Hive sensing | STM32 + MEMS microphones, on-device 512-point FFT, queen piping 300 to 500 Hz, LoRaWAN gateway, ANSYS hive model | ESP32 monitor with temperature, humidity, gas and (optional) weight. Sound analysis, LoRaWAN and simulation are hardware work and are not part of this project |
| Blockchain | Polygon PoS, Solidity, dual-EOA minting, IPFS metadata, dynamic QR | **Same core ideas, on a local chain (Polygon Amoy ready):** Solidity contract, dual-signature (harvester then officer) EIP-712 minting, real CIDs, Merkle-proof jars. **Additional:** ledger anchoring, on-chain loose-sale accounting against the same weight, outbox with retry |
| Database | not stated | PostgreSQL: a common schema plus a **private schema per company**, immutable ledger tables, portable exports (runs locally; can be pointed at Supabase) |
| Governance | officer certifies | KVIC hierarchy (regional, state, head), approvals, inspections, closures, tickets, notices, audit log |
| Access | trilingual offline PWA | 12 languages in the apps (offline PWA is not built) |

## The journey

1. **Registration** with a KVIC Madhukranti ID (or parent-organisation number) and FSSAI licence. This does **not** activate the account: the keeper sees only a status screen.
2. The **Regional Officer** reviews the credentials in the Admin review queue and approves or rejects. On approval the keeper gets the workspace.
3. **Hives, IoT, AI hive health, finance and AI forecasts** (private company database).
4. **Harvest** creates a batch on the chain, with a server-assigned ID.
5. **Lab request**, then the laboratory certificate is submitted.
6. **AI-assisted review:** the officer sees findings, anomalies and risk (decision support only).
7. The **officer verifies and digitally signs** (password-confirmed ed25519). The signature is chained.
8. **Packaging unlocks** only now. QR codes are limited by the batch weight (5 kg in 500 g jars = 10 QR codes).
9. **Supply chain:** keeper → distributor → retailer, each transfer chained.
10. **Consumer scans the QR:** the public page shows product, producer, lab result, officer approval and signature validity, traceability history, supply-chain journey and a clear VALID / NOT CERTIFIED / UNDER REVIEW verdict.

State officers and the KVIC Head additionally see income, production, region/state performance and the blockchain; the Head supervises officers, their activity and approvals.

Details: `APICtech/backend/API.md`, `APICtech/backend/IMMUTABLE_LEDGER.md`, `APICtech/backend/LEDGER_DEMO.md`.

## Honest status

- **AI is decision support, and today it is not machine learning.** Lab review and hive health are deterministic rule engines (`rule-based-v1`) over reference limits and sensor data; finance forecasts are a least-squares trend (`statistical-v1`) that needs about three months of records. Each response names its engine. The interfaces allow a real model to replace them.
- The audit ledger has a **single validator** (proof of authority; its signing key is the file `APICtech/backend/data/validator-key.pem`): tamper-evident, not a decentralised network. The smart contract is on a public **test** network (Polygon Amoy), not the main network, once you set `CHAIN_RPC_URL`; without it a local development chain is used, which forgets everything when stopped (the API refills it from the database).
- Keeper and officer signing accounts are **custodial**: the server holds them, encrypted with `WALLET_MASTER_KEY`, and signs when the user acts. The relayer pays the gas and cannot forge a signature. Losing `WALLET_MASTER_KEY` means losing those accounts.
- The database is a single PostgreSQL server on this computer: no replica, no failover. Data from the earlier SQLite version is not migrated (`APICtech/backend/apictech.db` and `data/companies` are left untouched).
- Honey stock checks (how much can still be sold or packed) are re-run under a lock inside the transaction, and the smart contract enforces the same limit on chain.
- Lab certificates need an uploaded document only when `REQUIRE_LAB_DOCUMENT=true`; turn it on for real use. The failed-login counter lives in memory and resets when the API restarts.
- Hive weight needs an HX711 load cell on the ESP32 (the firmware does not read one yet); the UI and analysis use it when `weight_kg` is reported.
- Internal identifiers (`APICTECH` party type, `apictech_*` storage keys) keep their old names on purpose; display text says Honey Chain.
