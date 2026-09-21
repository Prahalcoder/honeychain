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
import { officeOfOfficer, officesForOrganization } from '../services/offices.js'
import { formatAddress } from '../config/sampleData.js'
import { validUpi } from '../services/shop.js'
import { appendTraceabilityEvent } from '../services/traceabilityLog.js'

const router = express.Router()

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const FSSAI_PATTERN = /^\d{14}$/
const REGISTRATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_-]{3,39}$/
const PINCODE_PATTERN = /^\d{6}$/

// Wrong passwords per account: after LOGIN_ATTEMPTS misses in a quarter of an hour the account waits, on top of
// the per-address limit in server.js. Kept in memory, so it resets when the API restarts.
const LOGIN_ATTEMPTS = Number(process.env.LOGIN_ATTEMPTS_PER_ACCOUNT || 10)
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const failures = new Map()
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10)

function isLockedOut(account) {
  const entry = failures.get(account)
  if (!entry) return false
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) { failures.delete(account); return false }
  return entry.count >= LOGIN_ATTEMPTS
}

function recordFailure(account) {
  const entry = failures.get(account)
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) failures.set(account, { count: 1, first: Date.now() })
  else entry.count += 1
  if (failures.size > 5000) failures.clear()
}

// +91 98765 43210, 098765 43210 and 9876543210 all mean the same number.
const normalisePhone = (value) => String(value ?? '').replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '')

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
    office: user.role === 'BEEKEEPER' ? null : await officeOfOfficer(user),
  }
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({
      message: 'Username and password are required',
    })
  }

  const account = String(username).trim().toLowerCase()
  if (isLockedOut(account)) {
    return res.status(429).json({ message: 'Too many wrong passwords for this account. Please wait a few minutes and try again.' })
  }

  const user = await db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(username).trim())

  // Same response, and the same amount of work, for an unknown user and a wrong password.
  const validPassword = await bcrypt.compare(String(password), user ? user.password : DUMMY_HASH) && Boolean(user)

  if (!validPassword) {
    recordFailure(account)
    return res.status(401).json({
      message: 'Invalid username or password',
    })
  }

  failures.delete(account)

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
    addressLine = '',
    locality = '',
    district = '',
    pincode = '',
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

  const mobile = normalisePhone(phone)
  if (mobile && !/^[6-9]\d{9}$/.test(mobile)) {
    return res.status(400).json({ message: 'Enter a 10-digit mobile number' })
  }

  const address = { addressLine: clean(addressLine).slice(0, 160), locality: clean(locality).slice(0, 80), district: clean(district).slice(0, 80) || region, pincode: clean(pincode) }
  if (address.addressLine.length < 5) {
    return res.status(400).json({ message: 'Enter your apiary or business address (house / plot, street)' })
  }
  if (address.locality.length < 2) {
    return res.status(400).json({ message: 'Enter your village or town' })
  }
  if (!PINCODE_PATTERN.test(address.pincode)) {
    return res.status(400).json({ message: 'PIN code must be 6 digits' })
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
      `).run(userId, clean(email), mobile, clean(farmName) || clean(organizationName), address.locality,
        clean(organizationName), gst, formatAddress({ ...address, state }), clean(email))

      const organizationCode = await nextCode('ORG')
      const privateDbFile = await createCompanyDb(organizationCode)

      await db.prepare(`
        INSERT INTO organizations
        (organization_code, organization_type, legal_name, madhukranti_id, registration_body,
          fssai_license, gstin, status, owner_user_id, state, region, private_db_file,
          address_line, locality, district, pincode)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL', ?, ?, ?, ?, ?, ?, ?, ?)
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
        address.addressLine,
        address.locality,
        address.district,
        address.pincode,
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

  await db.prepare('UPDATE users SET password = ?, password_changed_at = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), new Date().toISOString(), user.id)
  if (OFFICER_ROLES.includes(user.role)) await recordAudit(user, 'PASSWORD_CHANGED')

  // Every earlier session ends; this device gets a fresh token.
  res.json({ message: 'Password updated', token: createToken(user) })
})

router.get('/settings', authenticateToken, async (req, res) => {
  const settings = await db.prepare(`
    SELECT email, phone, farm_name AS farmName, farm_location AS farmLocation,
      business_name AS businessName, gstin, business_address AS businessAddress,
      contact_email AS contactEmail, updated_at AS updatedAt
    FROM user_settings WHERE user_id = ?
  `).get(req.user.id)

  // Where the company is registered and answers to: shown on the profile page.
  const org = await db.prepare('SELECT * FROM organizations WHERE owner_user_id = ?').get(req.user.id)
  const organization = org ? {
    code: org.organization_code, name: org.legal_name, status: org.status, state: org.state, region: org.region,
    registrationId: org.madhukranti_id, registrationBody: org.registration_body, fssai: org.fssai_license,
    addressLine: org.address_line || '', locality: org.locality || '', district: org.district || '', pincode: org.pincode || '',
    addressSample: Boolean(org.address_sample), upiId: org.upi_id || '',
  } : null

  res.json({ settings, organization, offices: org ? await officesForOrganization(org) : null })
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
  const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max)
  const {
    email = '',
    phone = '',
    farmName = '',
    businessName = '',
    gstin = '',
    contactEmail = '',
  } = req.body

  const org = await db.prepare('SELECT * FROM organizations WHERE owner_user_id = ?').get(req.user.id)

  const gst = clean(gstin, 15).toUpperCase()
  if (gst && !GSTIN_PATTERN.test(gst)) {
    return res.status(400).json({ message: 'GSTIN format is invalid' })
  }

  const phoneDigits = normalisePhone(clean(phone, 20))
  if (phoneDigits && !/^[6-9]\d{9}$/.test(phoneDigits)) {
    return res.status(400).json({ message: 'Enter a 10-digit mobile number' })
  }

  // The address is kept on the organisation. It is only changed when the form sends it.
  const sendsAddress = ['addressLine', 'locality', 'district', 'pincode'].some((key) => req.body[key] !== undefined)
  const address = {
    addressLine: clean(req.body.addressLine ?? org?.address_line, 160),
    locality: clean(req.body.locality ?? org?.locality, 80),
    district: clean(req.body.district ?? org?.district, 80),
    pincode: clean(req.body.pincode ?? org?.pincode, 6),
  }
  if (org && sendsAddress) {
    if (address.addressLine.length < 5) return res.status(400).json({ message: 'Enter your apiary or business address (house / plot, street)' })
    if (address.locality.length < 2) return res.status(400).json({ message: 'Enter your village or town' })
    if (!PINCODE_PATTERN.test(address.pincode)) return res.status(400).json({ message: 'PIN code must be 6 digits' })
  }

  const upi = req.body.upiId === undefined ? undefined : clean(req.body.upiId, 80)
  if (upi && !validUpi(upi)) {
    return res.status(400).json({ message: 'UPI ID looks like name@bank, for example ravi@okhdfcbank' })
  }

  await db.transaction(async () => {
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
      clean(email, 120),
      phoneDigits,
      clean(farmName, 120),
      address.locality,
      clean(businessName, 120),
      gst,
      formatAddress({ ...address, state: org?.state }),
      clean(contactEmail, 120),
    )

    if (org) {
      // GSTIN and the address live on the organisation too: keep the two copies equal.
      await db.prepare('UPDATE organizations SET gstin = ? WHERE id = ?').run(gst, org.id)

      if (sendsAddress) {
        await db.prepare('UPDATE organizations SET address_line = ?, locality = ?, district = ?, pincode = ?, address_sample = 0 WHERE id = ?')
          .run(address.addressLine, address.locality, address.district, address.pincode, org.id)
      }
      if (upi !== undefined) {
        await db.prepare('UPDATE organizations SET upi_id = ? WHERE id = ?').run(upi || null, org.id)
      }
    }
  })()

  res.json({ message: 'Settings saved' })
})

export default router
