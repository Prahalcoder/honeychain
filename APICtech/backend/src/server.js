import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

import db from './database/database.js'
import authRoutes from './routes/auth.js'
import companyRoutes from './routes/company.js'
import adminRoutes from './routes/admin.js'
import traceabilityRoutes, { qrRouter } from './routes/traceability.js'
import platformRoutes, { verificationRouter } from './routes/platform.js'
import shopRoutes from './routes/shop.js'
import tradeRoutes from './routes/trade.js'
import orgRoutes from './routes/org.js'
import iotRoutes from './routes/iot.js'
import { REGIONS } from './config/regions.js'
import { sealPendingBlock } from './services/blockchain.js'
import { syncMonthlyReport } from './services/reports.js'
import { authenticateToken, requireRole } from './middleware/auth.js'
import { chainStatus, recentOutbox, startChain } from './services/chain.js'
import { readPinned } from './services/ipfs.js'
import { isAllowedOrigin } from './config/network.js'
import { databaseKind, startBackups, verifyDatabases } from './services/backup.js'
import { expireUnpaidOrders } from './services/shop.js'
import { categoryFor, sampleProfileInput } from './config/sampleProfiles.js'
import { buildProfile } from './services/registrationProfile.js'
import { saveProfile } from './services/profiles.js'

// In production the API refuses to start with a weak or default signing secret.
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || /replace-with/.test(process.env.JWT_SECRET))) {
  console.error('Set JWT_SECRET to a random value of at least 32 characters before running in production.')
  process.exit(1)
}

const app = express()
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY)

const extraOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()) : []
const originAllowed = (origin, callback) => callback(null, !origin || isAllowedOrigin(origin) || extraOrigins.includes(origin))

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(cors({ origin: originAllowed }))

// Slow down password guessing and scraping of the public verification endpoint.
const limit = (max, windowMinutes) => rateLimit({ windowMs: windowMinutes * 60 * 1000, limit: max, standardHeaders: 'draft-7', legacyHeaders: false, message: { message: 'Too many requests. Please wait a little and try again.' } })
app.use('/api/auth/login', limit(Number(process.env.LOGIN_RATE_LIMIT || 100), 15))
app.use('/api/auth/register', limit(Number(process.env.REGISTER_RATE_LIMIT || 50), 60))
app.use('/api/auth/otp', limit(Number(process.env.OTP_RATE_LIMIT || 30), 15))
app.use('/api/verify', limit(Number(process.env.VERIFY_RATE_LIMIT || 240), 1))
app.use('/api/iot', limit(Number(process.env.IOT_RATE_LIMIT || 30), 1))
app.use(express.json({ limit: '200kb' }))

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    application: 'Honey Chain',
    message: 'Backend is running',
  })
})

// Public: registration form and officer forms use this catalogue.
app.get('/api/regions', (req, res) => {
  res.json(REGIONS)
})

app.use('/api/auth', authRoutes)
app.use('/api/company', companyRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/traceability', traceabilityRoutes)
app.use('/api/qr', qrRouter)
app.use('/api/platform', platformRoutes)
app.use('/api/verify', verificationRouter)
app.use('/api/shop', shopRoutes)
app.use('/api/trade', tradeRoutes)
app.use('/api/org', orgRoutes)
app.use('/api/iot', iotRoutes)

// Blockchain: public status of the smart-contract link, the outbox for the KVIC head, and the
// content-addressed metadata (IPFS CIDs) that the contract points to.
app.get('/api/chain/status', async (req, res) => res.json(await chainStatus()))
app.get('/api/chain/outbox', authenticateToken, requireRole('KVIC_HEAD', 'STATE_OFFICER'), async (req, res) => res.json(await recentOutbox(Math.min(Number(req.query.limit) || 50, 200))))
app.get('/api/ipfs/:cid', async (req, res) => {
  const pinned = await readPinned(req.params.cid)
  if (!pinned) return res.status(404).json({ message: 'Not found' })
  res.set('Cache-Control', 'public, max-age=31536000, immutable')
  res.set('X-Content-Integrity', pinned.intact ? 'cid-verified' : 'CID-MISMATCH')
  res.json(pinned.json)
})

app.use((req, res) => {
  res.status(404).json({ message: 'Not found' })
})

app.use((error, req, res, next) => {
  console.error(error)
  if (res.headersSent) return next(error)
  res.status(500).json({ message: 'Something went wrong on the server' })
})

// Seal events left over from before blocks existed and refresh the income
// aggregates that admins see.
await sealPendingBlock()
for (const organization of await db.prepare('SELECT * FROM organizations').all()) {
  await syncMonthlyReport(organization)
}

// The demo farms and wholesalers (tools/seedFarms.mjs, tools/seedTraders.mjs) register through the normal form
// with made-up details: label those as samples too.
await db.prepare(`
  UPDATE organization_profiles SET is_sample = 1
  WHERE is_sample = 0 AND org_id IN (SELECT id FROM organizations WHERE madhukranti_id LIKE 'MK-DEMO-%' OR madhukranti_id LIKE 'NBB-DEMO-%')
`).run()

// Companies that registered before the full registration form existed get made-up details, stored as a sample
// (config/sampleProfiles.js) and put through the same checks as a real applicant.
for (const org of await db.prepare(`
  SELECT o.id, o.legal_name, o.organization_type, o.state, o.district, o.address_line, o.locality, u.name AS owner_name
  FROM organizations o LEFT JOIN users u ON u.id = o.owner_user_id
  LEFT JOIN organization_profiles p ON p.org_id = o.id
  WHERE p.org_id IS NULL OR p.is_sample = 1
`).all()) {
  const category = categoryFor(org)
  // A sample made earlier is only redone when the category rules have changed since; a keeper's own details
  // (is_sample = 0) are never touched.
  const current = await db.prepare('SELECT applicant_category FROM organization_profiles WHERE org_id = ?').get(org.id)
  if (current?.applicant_category === category) continue
  const address = [org.address_line, org.locality].filter(Boolean).join(', ')
  try {
    const input = sampleProfileInput({ seed: org.id, category, state: org.state, district: org.district || '', address, name: org.legal_name })
    await saveProfile(org.id, buildProfile(category, input, { name: org.owner_name || org.legal_name }), { sample: true })
  } catch (error) {
    console.error(`Sample profile for company ${org.id} failed:`, error.message)
  }
}

// Refuse to run when the database cannot be read (every schema: common plus one per company).
const checked = await verifyDatabases()
if (process.env.SKIP_DB_CHECK !== '1') {
  const damaged = checked.filter((item) => item.result !== 'ok')
  if (damaged.length) {
    console.error('Database check failed:')
    for (const item of damaged) console.error(`  ${item.name}: ${item.result}`)
    console.error('Fix the connection or the schema, or set SKIP_DB_CHECK=1 to start anyway.')
    process.exit(1)
  }
}

startBackups(db)

const PORT = process.env.PORT || 5000

await startChain()

// Every ten minutes: cancel orders that were never paid and put their jars back.
setInterval(() => { expireUnpaidOrders().catch((error) => console.error('Order expiry failed:', error.message)) }, 10 * 60 * 1000).unref()

app.listen(PORT, () => {
  console.log(`
🐝 Honey Chain Backend
────────────────────────
Server: http://localhost:${PORT}
Health: http://localhost:${PORT}/api/health
Database: ${databaseKind()}, common schema + ${Math.max(checked.length - 1, 0)} private company schema(s)
Status: Running
  `)
})
