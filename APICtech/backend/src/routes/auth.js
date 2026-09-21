import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

import db from '../database/database.js'
import { authenticateToken } from '../middleware/auth.js'
import { ORGANIZATION_TYPES, isValidJurisdiction } from '../config/regions.js'
import { OFFICER_ROLES } from '../services/access.js'
import { recordAudit } from '../services/audit.js'
import { sealPendingBlock } from '../services/blockchain.js'
import { nextCode } from '../services/codes.js'
import { createCompanyDb } from '../services/companyDb.js'
import { appendTraceabilityEvent } from '../services/traceabilityLog.js'

const router = express.Router()

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const FSSAI_PATTERN = /^\d{14}$/
const REGISTRATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_-]{3,39}$/

function createToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '8h' },
  )
}

async function organizationFor(userId) {
  return await db.prepare(`
    SELECT id, organization_code AS code, legal_name AS name, organization_type AS type,
      status, state, region, review_note AS reviewNote, reviewed_at AS reviewedAt
    FROM organizations WHERE owner_user_id = ?
  `).get(userId) || null
}

async function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    state: user.state || null,
    region: user.region || null,
    organization: user.role === 'BEEKEEPER' ? await organizationFor(user.id) : null,
  }
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({
      message: 'Username and password are required',
    })
  }

  const user = await db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(username).trim())

  // Same response for unknown user and wrong password.
  const validPassword = user && await bcrypt.compare(password, user.password)

  if (!validPassword) {
    return res.status(401).json({
      message: 'Invalid username or password',
    })
  }

  if (!user.active) {
    const closed = await db.prepare("SELECT 1 FROM organizations WHERE owner_user_id = ? AND status = 'CLOSED'").get(user.id)
    return res.status(403).json({ message: closed ? 'This organisation has been formally closed with KVIC, so this login is no longer active.' : 'This account has been deactivated' })
  }

  await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), user.id)
  if (OFFICER_ROLES.includes(user.role)) await recordAudit(user, 'LOGIN')

  res.json({
    token: createToken(user),
    user: await publicUser(user),
  })
})

router.get('/catalog', (req, res) => {
  res.json({ organizationTypes: ORGANIZATION_TYPES })
})

router.post('/register', async (req, res) => {
  const {
    name,
    username,
    password,
    organizationName,
    organizationType,
    registrationBody = '',
    registrationId,
    fssaiLicense,
    gstin = '',
    state,
    region,
    email = '',
    phone = '',
    farmName = '',
    farmLocation = '',
    businessAddress = '',
  } = req.body

  const clean = (value) => String(value ?? '').trim()

  if (!clean(name) || !clean(username) || !password || !clean(organizationName)) {
    return res.status(400).json({
      message: 'Name, username, password and organisation name are required',
    })
  }

  if (String(password).length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' })
  }

  if (!ORGANIZATION_TYPES[organizationType]) {
    return res.status(400).json({ message: 'Choose how your organisation is registered' })
  }

  const registration = clean(registrationId)
  if (!REGISTRATION_ID_PATTERN.test(registration)) {
    return res.status(400).json({
      message: 'Enter the registration number issued by KVIC (Madhukranti ID) or your parent organisation',
    })
  }

  if (organizationType !== 'KVIC_BEEKEEPER' && !clean(registrationBody)) {
    return res.status(400).json({ message: 'Enter the name of the organisation that issued your registration number' })
  }

  const fssai = clean(fssaiLicense)
  if (!FSSAI_PATTERN.test(fssai)) {
    return res.status(400).json({ message: 'FSSAI licence / registration number must be 14 digits' })
  }

  const gst = clean(gstin).toUpperCase()
  if (gst && !GSTIN_PATTERN.test(gst)) {
    return res.status(400).json({ message: 'GSTIN format is invalid' })
  }

  if (!isValidJurisdiction(state, region) || !region) {
    return res.status(400).json({ message: 'Select your state and KVIC region' })
  }

  const duplicate = await db.prepare(`
    SELECT madhukranti_id, fssai_license FROM organizations
    WHERE madhukranti_id = ? OR fssai_license = ?
  `).get(registration, fssai)

  if (duplicate) {
    return res.status(409).json({
      message: duplicate.madhukranti_id === registration
        ? 'This registration number is already used by another organisation'
        : 'This FSSAI number is already used by another organisation',
    })
  }

  try {
    const result = await db.transaction(async () => {
      const userResult = await db.prepare(`
        INSERT INTO users (username, password, name, role, state, region)
        VALUES (?, ?, ?, 'BEEKEEPER', ?, ?)
      `).run(clean(username), bcrypt.hashSync(password, 10), clean(name), state, region)

      const userId = userResult.lastInsertRowid

      await db.prepare(`
        INSERT INTO user_settings
        (user_id, email, phone, farm_name, farm_location, business_name, gstin, business_address, contact_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, clean(email), clean(phone), clean(farmName) || clean(organizationName), clean(farmLocation),
        clean(organizationName), gst, clean(businessAddress), clean(email))

      const organizationCode = await nextCode('ORG')
      const privateDbFile = await createCompanyDb(organizationCode)

      await db.prepare(`
        INSERT INTO organizations
        (organization_code, organization_type, legal_name, madhukranti_id, registration_body,
          fssai_license, gstin, status, owner_user_id, state, region, private_db_file)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL', ?, ?, ?, ?)
      `).run(
        organizationCode,
        organizationType,
        clean(organizationName),
        registration,
        organizationType === 'KVIC_BEEKEEPER' ? 'KVIC' : clean(registrationBody),
        fssai,
        gst,
        userId,
        state,
        region,
        privateDbFile,
      )

      // Only identifiers go on the chain, never contact or business details.
      await appendTraceabilityEvent({
        entityType: 'ORGANIZATION',
        entityId: organizationCode,
        eventType: 'ORGANIZATION_REGISTERED',
        payload: { organizationCode, organizationType, state, region },
        createdBy: userId,
      })
      await sealPendingBlock()

      return await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    })()

    res.status(201).json({ token: createToken(result), user: await publicUser(result) })
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Username already exists' })
    }

    console.error('Registration failed', error)
    return res.status(400).json({ message: 'Unable to create profile' })
  }
})

router.get('/me', authenticateToken, async (req, res) => {
  const user = await db.prepare(`
    SELECT id, username, name, role, state, region, created_at
    FROM users WHERE id = ?
  `).get(req.user.id)

  if (!user) return res.status(404).json({ message: 'User not found' })
  res.json({ user: { ...await publicUser(user), created_at: user.created_at } })
})

router.put('/password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body

  if (!currentPassword || !newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ message: 'Enter your current password and a new one of at least 8 characters' })
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)

  if (!(await bcrypt.compare(currentPassword, user.password))) {
    return res.status(401).json({ message: 'Current password is incorrect' })
  }

  await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), user.id)
  if (OFFICER_ROLES.includes(user.role)) await recordAudit(user, 'PASSWORD_CHANGED')

  res.json({ message: 'Password updated' })
})

router.get('/settings', authenticateToken, async (req, res) => {
  const settings = await db.prepare(`
    SELECT email, phone, farm_name AS farmName, farm_location AS farmLocation,
      business_name AS businessName, gstin, business_address AS businessAddress,
      contact_email AS contactEmail, updated_at AS updatedAt
    FROM user_settings WHERE user_id = ?
  `).get(req.user.id)

  res.json({ settings })
})

router.put('/profile', authenticateToken, async (req, res) => {
  const { name, username } = req.body

  if (!name?.trim() || !username?.trim()) {
    return res.status(400).json({ message: 'Name and username are required' })
  }

  try {
    await db.prepare('UPDATE users SET name = ?, username = ? WHERE id = ?')
      .run(name.trim(), username.trim(), req.user.id)

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)

    res.json({ token: createToken(user), user: await publicUser(user) })
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Username already exists' })
    }

    return res.status(400).json({ message: 'Unable to update profile' })
  }
})

router.put('/settings', authenticateToken, async (req, res) => {
  const {
    email = '',
    phone = '',
    farmName = '',
    farmLocation = '',
    businessName = '',
    gstin = '',
    businessAddress = '',
    contactEmail = '',
  } = req.body

  await db.prepare(`
    INSERT INTO user_settings
    (user_id, email, phone, farm_name, farm_location, business_name, gstin, business_address, contact_email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      email = excluded.email,
      phone = excluded.phone,
      farm_name = excluded.farm_name,
      farm_location = excluded.farm_location,
      business_name = excluded.business_name,
      gstin = excluded.gstin,
      business_address = excluded.business_address,
      contact_email = excluded.contact_email,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    req.user.id,
    email,
    phone,
    farmName,
    farmLocation,
    businessName,
    gstin,
    businessAddress,
    contactEmail,
  )

  res.json({ message: 'Settings saved' })
})

export default router
