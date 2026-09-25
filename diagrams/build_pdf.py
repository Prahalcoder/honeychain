import base64, os, html

HERE = os.path.dirname(os.path.abspath(__file__))

pages = [
    ('1-system-architecture.png', '1. System architecture',
     'Honey Chain is built in four layers. People and devices (beekeepers, KVIC officers, consumers and the ESP32 hive device) use three web apps. All three talk to one secure API. The API keeps its records in two places that back each other up: a PostgreSQL database and an Ethereum smart contract.',
     ['Keeper app (5173), Admin portal (5174) and public website (5175) are React 19 + Vite + Tailwind, in English and Hindi, and work on a phone.',
      'The API (Node.js, Express 5, port 5000) holds the security layer (Helmet, CORS, rate limits, JWT, roles and jurisdiction), the business services, the rule-based analysis and the trust services (ledger, chain outbox, signing).',
      'A separate Python Flask service (port 5001) receives ESP32 readings over Wi-Fi, streams the OpenCV camera and analyses hive health.',
      'Everything runs on one laptop with one command, npm start. No paid cloud is needed; a hosted database and a public test network are optional.']),
    ('2-tech-stack.png', '2. Technology stack',
     'The tools used in each part of the project, and the protections built into all of them.',
     ['Frontend: React 19, Vite 8, Tailwind CSS 4, React Router 7, Recharts, qrcode, Fraunces and Source Sans 3 fonts.',
      'Backend: Node.js 20+, Express 5, JWT, bcrypt, Helmet, express-rate-limit, IPFS-style content identifiers.',
      'Database: PostgreSQL 18 with one schema per company, row-level security, advisory locks and immutable ledger triggers.',
      'Blockchain: a Solidity 0.8.24 contract on a local Hardhat chain, ethers v6, EIP-712 signatures, Merkle proofs for jars, custodial wallets; the public Polygon Amoy testnet is optional.',
      'IoT and AI: ESP32 with two DHT11 sensors, a gas sensor, an OLED and fan and heater relays; Python, Flask and OpenCV; rule-based engines (not machine learning).']),
    ('3-data-and-blockchain.png', '3. Data and blockchain architecture',
     'Private business data stays private. Only codes and hashes are public and tamper-evident.',
     ['Every action follows five steps: validate, write business rows, append a ledger event, seal a block in the hash chain, and queue a chain job. Steps 2 to 4 share one database transaction.',
      'Schema public holds the shared official records: users, batches, lab reviews, jars, the immutable ledger and the shop listings.',
      'Each approved company gets its own private schema (co_org_...) with hives, harvests, finance, buyers, invoices and buyer orders. Officers and other keepers cannot read it.',
      'A background relayer sends signed transactions to the smart contract, retries failures and waits for dependencies. The contract records batch registration, certification, the Merkle root of every jar, loose sales and ledger anchors.',
      'Lab report metadata becomes a real IPFS CIDv1; the contract stores only the CID.']),
    ('4-process-flow.png', '4. End-to-end process',
     'From a hive to the buyer: every step is recorded, and officers verify what matters.',
     ['A keeper registers with FSSAI, address and region; the regional officer approves and the private company schema is created.',
      'Hives and harvests are recorded (with live sensor data). A lab result and certificate are uploaded, then the officer checks the limits and signs.',
      'Only after verification can jars be packaged, and the number of QR codes can never exceed the honey held.',
      'Honey is sold loose with an invoice, or the jars are listed on Sellers nearby. A buyer orders without an account, pays by the seller UPI QR, and the keeper confirms payment, ships and updates the status.',
      'Any consumer can scan the jar QR and see the batch, the lab certificate, the officer signature, the Merkle proof and the on-chain transaction.']),
    ('5-roles-and-jurisdiction.png', '5. Users, roles and jurisdiction',
     'Each person sees only their own area, and the ledger records who did what.',
     ['KVIC Head (1 central office): sees every state and region. State officers (8 offices): one state. Regional officers (22 offices): one region.',
      'Officers approve registrations, verify lab results with a password and signature, schedule and grade inspections, run closures and publish notices to their scope.',
      'Beekeepers see only their own data; other keepers and regional officers cannot read a company private schema or income.',
      'The public can verify a QR, browse sellers by state and region, order without an account and track the order with the code and phone number.',
      'Old logins end when a password changes, and repeated wrong passwords lock an account for a while.']),
]

css = '''
@page { size: 297mm 210mm; margin: 0 }
* { box-sizing: border-box }
body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; color: #1f3b3f }
.page { width: 297mm; height: 210mm; page-break-after: always; position: relative; overflow: hidden; background: #f7fbfa }
.page:last-child { page-break-after: auto }
.top { background: #0a3d43; color: #fff; padding: 6mm 12mm 4mm; border-bottom: 1.6mm solid #f5a524; display: flex; justify-content: space-between; align-items: baseline }
.top h1 { margin: 0; font-size: 21pt }
.top span { color: #f5a524; font-weight: 700; font-size: 13pt }
.img { padding: 3mm 0 0; text-align: center }
.img img { width: 214mm; display: inline-block; border: 0.3mm solid #b7d3cf; border-radius: 2mm }
.text { padding: 3mm 12mm 0 }
.text p.lead { margin: 0 0 1.5mm; font-size: 10.5pt; font-weight: 600; color: #0a3d43 }
.text ul { margin: 0; padding-left: 5mm; font-size: 9pt; line-height: 1.3 }
.foot { position: absolute; bottom: 3mm; left: 12mm; right: 12mm; font-size: 7.5pt; color: #6b8583; display: flex; justify-content: space-between }
.cover { background: #0a3d43; color: #fff; display: flex; flex-direction: column; justify-content: center; padding: 0 24mm }
.cover h1 { font-size: 40pt; margin: 0 0 4mm; color: #f5a524 }
.cover h2 { font-size: 20pt; font-weight: 400; margin: 0 0 12mm }
.cover li { font-size: 14pt; margin: 2mm 0 }
'''

out = ['<html><head><meta charset="utf-8"><style>' + css + '</style></head><body>']
out.append('<div class="page cover"><h1>Honey Chain</h1><h2>Architecture, technology stack and process diagrams</h2>'
           '<p style="font-size:13pt;max-width:220mm;line-height:1.5">Blockchain-backed honey traceability and compliance for KVIC and MSME beekeepers. Smart India Hackathon 2026, problem statement 26021.</p>'
           '<ol>' + ''.join(f'<li>{html.escape(t)}</li>' for _, t, _, _ in pages) + '</ol></div>')
for n, (file, title, lead, points) in enumerate(pages, 1):
    b64 = base64.b64encode(open(os.path.join(HERE, file), 'rb').read()).decode()
    out.append(f'<div class="page"><div class="top"><h1>{html.escape(title)}</h1><span>Honey Chain</span></div>'
               f'<div class="img"><img src="data:image/png;base64,{b64}"></div>'
               f'<div class="text"><p class="lead">{html.escape(lead)}</p><ul>' + ''.join(f'<li>{html.escape(p)}</li>' for p in points) + '</ul></div>'
               f'<div class="foot"><span>Honey Chain · SIH 2026 · Problem 26021</span><span>{n} / {len(pages)}</span></div></div>')
out.append('</body></html>')
open(os.path.join(HERE, 'diagrams.html'), 'w', encoding='utf-8').write('\n'.join(out))
print('ok')
