import jwt from 'jsonwebtoken'

import db from '../database/database.js'

// Verifies the token, then reloads the account so deactivation and role
// changes take effect immediately instead of when the token expires.
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization

  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : null

  if (!token) {
    return res.status(401).json({
      message: 'Authentication required',
    })
  }

  let decoded
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    return res.status(403).json({
      message: 'Invalid or expired token',
    })
  }

  const user = await db
    .prepare('SELECT id, username, name, role, state, region, active, password_changed_at FROM users WHERE id = ?')
    .get(decoded.id)

  if (!user || !user.active) {
    return res.status(403).json({ message: 'This account is no longer active' })
  }

  // A token issued before the last password change or reset no longer works.
  if (user.password_changed_at && decoded.iat && decoded.iat < Math.floor(Date.parse(user.password_changed_at) / 1000)) {
    return res.status(403).json({ message: 'Invalid or expired token: your password was changed, please sign in again' })
  }

  req.user = user
  next()
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Your role cannot access this resource' })
    }

    next()
  }
}

// Beekeeper routes work on the caller's own company.
export async function loadOrganization(req, res, next) {
  const organization = await db
    .prepare('SELECT * FROM organizations WHERE owner_user_id = ?')
    .get(req.user.id)

  if (!organization) {
    return res.status(403).json({ message: 'No organisation is linked to this account' })
  }

  req.org = organization
  next()
}

// Anything that writes to the shared blockchain needs an accepted organisation.
export function requireApprovedOrg(req, res, next) {
  if (req.org.status !== 'APPROVED') {
    const messages = {
      PENDING_APPROVAL: 'Your organisation is waiting for regional officer approval.',
      REJECTED: 'Your organisation was not accepted into the KVIC monitoring chain.',
      SUSPENDED: 'Your organisation is suspended from the KVIC monitoring chain.',
      CLOSURE_PENDING: 'Your organisation is being closed. No new records can be added.',
      CLOSED: 'This organisation has been closed.',
    }

    return res.status(403).json({
      code: 'ORG_NOT_APPROVED',
      orgStatus: req.org.status,
      message: messages[req.org.status] || 'Organisation is not approved',
    })
  }

  next()
}

// Packaging, QR codes and Sellers nearby listings are for a company that registered to sell packaged jars. A
// wholesale-only company (no way to print or stick a QR label) skips this entirely and only ever sells loose
// honey by invoice, until a senior officer switches the company to RETAIL or BOTH.
export function requireRetailSelling(req, res, next) {
  if (req.org.selling_mode === 'WHOLESALE') {
    return res.status(403).json({
      code: 'WHOLESALE_ONLY',
      message: 'This company registered as wholesale-only (loose honey, no jars or QR codes). Ask KVIC to enable packaged selling if that has changed.',
    })
  }
  next()
}
