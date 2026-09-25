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
import {
  BEE_SPECIES, BUSINESS_TYPES, CATEGORIES, CONTAINER_TYPES, EDUCATION, GENDERS, LAND_TYPES, MONTHS, NOMINEE_RELATIONS, OTHER_PRODUCTS,
  PACKAGING_TYPES, SOCIAL_CATEGORIES, SOLD_TO, SOURCING_STATES, TRADER_TYPE, TRAINING_NAMES, TRAINING_ORGANISERS, FEE_SLABS,
  SMS_CHARGE, CONVENIENCE_FEE, documentsFor, registrationFee,
} from '../config/registration.js'
import { RegistrationError, buildProfile } from '../services/registrationProfile.js'
import { saveProfile } from '../services/profiles.js'
import { ALL_HONEY_TYPES } from '../config/honeyCatalogue.js'
import { OtpError, deliverOtp, issueOtp, verifyOtp } from '../services/otp.js'

const router = express.Router()

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const FSSAI_PATTERN = /^\d{14}$/
const REGISTRATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_-]{3,39}$/
const PINCODE_PATTERN = /^\d{6}$/
// RETAIL: packaged jars with QR codes. WHOLESALE: loose honey only, no jars or QR codes (no printer / phone for
// them). BOTH: either. Chosen at registration; a senior officer can change it later.
const SELLING_MODES = ['RETAIL', 'WHOLESALE', 'BOTH']

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

// A keeper's own login stays valid much longer than an officer's: the phone (often the same one, running the
// installed app) is normally used by one keeper in the field, sometimes with long offline stretches, and
// re-logging in every 8 hours defeats offline recording more than it protects anything. An officer's session
// stays short, matching how KVIC office logins have always worked here.
// Beekeepers and wholesalers own a company on the chain; officers do not.
const ORG_ROLES = ['BEEKEEPER', 'WHOLESALER']

function createToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: ORG_ROLES.includes(user.role) ? '30d' : '8h' },
  )
}

async function organizationFor(userId) {
  return await db.prepare(`
    SELECT o.id, o.organization_code AS code, o.legal_name AS name, o.organization_type AS type,
      o.status, o.state, o.region, o.selling_mode AS "sellingMode", o.review_note AS "reviewNote", o.reviewed_at AS "reviewedAt",
      p.applicant_category AS category
    FROM organizations o LEFT JOIN organization_profiles p ON p.org_id = o.id WHERE o.owner_user_id = ?
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
    organization: ORG_ROLES.includes(user.role) ? await organizationFor(user.id) : null,
    office: ORG_ROLES.includes(user.role) ? null : await officeOfOfficer(user),
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

// ---------------------------------------------------------------- forgot password: sign in with an OTP
// A beekeeper or wholesaler (any registration category) who forgot the password signs in with a one-time code
// sent to the mobile number or e-mail on their account, and can set a new password at the same time.
async function orgAccountsFor(identifier) {
  const raw = String(identifier ?? '').trim()
  if (raw.length < 5) return []
  const email = raw.includes('@') ? raw.toLowerCase() : null
  const mobile = email ? null : normalisePhone(raw)
  if (!email && !/^[6-9]\d{9}$/.test(mobile)) return []
  const rows = await db.prepare(`
    SELECT u.*, s.phone AS settings_phone, s.email AS settings_email, s.contact_email AS settings_contact_email
    FROM users u LEFT JOIN user_settings s ON s.user_id = u.id
    WHERE u.role IN ('BEEKEEPER', 'WHOLESALER')
  `).all()
  return rows.filter((row) => (email
    ? [row.settings_email, row.settings_contact_email].some((value) => String(value || '').trim().toLowerCase() === email)
    : normalisePhone(row.settings_phone) === mobile))
}

const otpFail = (error, res) => {
  if (error instanceof OtpError) return res.status(error.status).json({ message: error.message })
  throw error
}

router.post('/otp/request', async (req, res) => {
  const identifier = String(req.body?.identifier ?? '').trim()
  const isEmail = identifier.includes('@')
  if (!isEmail && !/^[6-9]\d{9}$/.test(normalisePhone(identifier))) {
    return res.status(400).json({ message: 'Enter the 10-digit mobile number or the e-mail on your account' })
  }
  const accounts = await orgAccountsFor(identifier)
  if (accounts.length > 1) {
    return res.status(409).json({ message: 'This is on more than one account. Use the other one (mobile number or e-mail), or ask your regional officer.' })
  }
  if (accounts.length === 0) {
    // Same answer as for a real account, so the form cannot be used to find out who is registered.
    return res.json({ sent: true, channel: isEmail ? 'EMAIL' : 'SMS', to: isEmail ? 'your e-mail' : 'your mobile', expiresInMinutes: 5 })
  }
  const user = accounts[0]
  try {
    const code = await issueOtp({ purpose: 'LOGIN', subjectKey: `user:${user.id}`, meta: { userId: user.id } })
    const delivery = await deliverOtp({
      to: isEmail ? identifier : normalisePhone(identifier), code,
      subject: 'Your Honey Chain sign-in code',
      text: `Honey Chain: your sign-in code is ${code}. It is valid for 5 minutes. Do not share it with anyone.`,
    })
    res.json({ sent: true, ...delivery, expiresInMinutes: 5 })
  } catch (error) { otpFail(error, res) }
})

router.post('/otp/verify', async (req, res) => {
  const { identifier, otp, newPassword } = req.body || {}
  const accounts = await orgAccountsFor(identifier)
  if (accounts.length !== 1) return res.status(400).json({ message: 'Wrong OTP. Ask for a new one.' })
  const user = accounts[0]
  if (newPassword !== undefined && newPassword !== '' && String(newPassword).length < 8) {
    return res.status(400).json({ message: 'The new password must be at least 8 characters' })
  }
  try {
    await verifyOtp({ purpose: 'LOGIN', subjectKey: `user:${user.id}`, code: otp })
  } catch (error) { return otpFail(error, res) }

  if (!user.active) {
    const closed = await db.prepare("SELECT 1 FROM organizations WHERE owner_user_id = ? AND status = 'CLOSED'").get(user.id)
    return res.status(403).json({ message: closed ? 'This organisation has been formally closed with KVIC, so this login is no longer active.' : 'This account has been deactivated' })
  }
  const stamp = new Date().toISOString()
  if (newPassword) {
    // A new password ends every earlier session (password_changed_at), like a normal password change.
    await db.prepare('UPDATE users SET password = ?, password_changed_at = ? WHERE id = ?').run(bcrypt.hashSync(String(newPassword), 10), stamp, user.id)
  }
  await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(stamp, user.id)
  failures.delete(String(user.username).toLowerCase())
  const fresh = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
  res.json({ token: createToken(fresh), user: await publicUser(fresh), passwordChanged: Boolean(newPassword) })
})

// Everything the registration form offers, so the form and the server can never disagree.
router.get('/catalog', (req, res) => {
  res.json({
    organizationTypes: ORGANIZATION_TYPES,
    categories: Object.fromEntries(Object.entries(CATEGORIES).map(([key, item]) => [key, { ...item, documents: documentsFor(key) }])),
    options: {
      genders: GENDERS, education: EDUCATION, socialCategories: SOCIAL_CATEGORIES, species: BEE_SPECIES, soldTo: SOLD_TO,
      landTypes: LAND_TYPES, months: MONTHS, nomineeRelations: NOMINEE_RELATIONS, containerTypes: CONTAINER_TYPES,
      trainingNames: TRAINING_NAMES, trainingOrganisers: TRAINING_ORGANISERS, otherProducts: OTHER_PRODUCTS,
      businessTypes: BUSINESS_TYPES, packagingTypes: PACKAGING_TYPES, sourcingStates: SOURCING_STATES, honeyTypes: ALL_HONEY_TYPES,
    },
    fees: { slabs: FEE_SLABS, sms: SMS_CHARGE, convenience: CONVENIENCE_FEE },
  })
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
    sellingMode = 'BOTH',
    category = 'INDIVIDUAL',
    profile = {},
  } = req.body

  const clean = (value) => String(value ?? '').trim()
  const trader = category === 'WHOLESALER'

  if (!clean(name) || !clean(username) || !password || !clean(organizationName)) {
    return res.status(400).json({
      message: 'Name, username, password and organisation name are required',
    })
  }

  if (String(password).length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' })
  }

  if (!CATEGORIES[category]) {
    return res.status(400).json({ message: 'Choose how you are registering: individual, firm, society, company or wholesaler' })
  }

  // A wholesaler's number comes from the National Bee Board's Madhukranti register of traders and packers.
  const orgType = trader ? TRADER_TYPE : organizationType
  if (!trader && !ORGANIZATION_TYPES[organizationType]) {
    return res.status(400).json({ message: 'Choose who issued your beekeeping registration number' })
  }

  const registration = clean(registrationId)
  if (!REGISTRATION_ID_PATTERN.test(registration)) {
    return res.status(400).json({
      message: trader
        ? 'Enter your National Bee Board (Madhukranti) trader / packer registration number'
        : 'Enter the registration number issued by KVIC (Madhukranti ID) or your parent organisation',
    })
  }

  if (!trader && organizationType !== 'KVIC_BEEKEEPER' && !clean(registrationBody)) {
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
  if (trader && !gst) {
    return res.status(400).json({ message: 'A wholesaler / trader needs a GSTIN' })
  }

  if (!trader && !SELLING_MODES.includes(sellingMode)) {
    return res.status(400).json({ message: 'Choose how you plan to sell your honey' })
  }

  if (!isValidJurisdiction(state, region) || !region) {
    return res.status(400).json({ message: 'Select your state and KVIC region' })
  }

  const mobile = normalisePhone(phone)
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    return res.status(400).json({ message: 'Enter a 10-digit mobile number' })
  }

  let details
  try {
    details = buildProfile(category, profile, { name: clean(name) })
  } catch (error) {
    if (error instanceof RegistrationError) return res.status(400).json({ message: error.message })
    throw error
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
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(clean(username), bcrypt.hashSync(password, 10), clean(name), CATEGORIES[category].role, state, region)

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
          address_line, locality, district, pincode, selling_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        organizationCode,
        orgType,
        clean(organizationName),
        registration,
        trader ? 'National Bee Board (Madhukranti)' : organizationType === 'KVIC_BEEKEEPER' ? 'KVIC' : clean(registrationBody),
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
        trader ? 'WHOLESALE' : sellingMode,
      )

      const orgId = (await db.prepare('SELECT id FROM organizations WHERE organization_code = ?').get(organizationCode)).id
      await saveProfile(orgId, details)

      // Only identifiers go on the chain, never contact or business details.
      await appendTraceabilityEvent({
        entityType: 'ORGANIZATION',
        entityId: organizationCode,
        eventType: 'ORGANIZATION_REGISTERED',
        payload: { organizationCode, organizationType: orgType, category, state, region },
        createdBy: userId,
      })
      await sealPendingBlock()

      return await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    })()

    res.status(201).json({ token: createToken(result), user: await publicUser(result), fee: registrationFee(details.details.beekeeping?.colonies) })
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
    addressSample: Boolean(org.address_sample), upiId: org.upi_id || '', sellingMode: org.selling_mode,
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
