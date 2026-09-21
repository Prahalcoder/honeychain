import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'

import db from '../database/database.js'

// Officer digital signatures. Each officer has an ed25519 key pair. The private
// key is stored AES-256-GCM encrypted under a key derived (scrypt) from the
// officer's password, so a signature can only be produced by someone who can
// re-enter that password at the moment of approval. Changing or resetting the
// password makes the old key undecryptable; a fresh key is created on the next
// signature and old signatures stay verifiable through the stored public key.

export class SigningError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const fingerprintOf = (publicKeyPem) => crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16)

function wrapPrivateKey(privateKey, password) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = crypto.scryptSync(password, salt, 32)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(privateKey.export({ type: 'pkcs8', format: 'pem' })),
    cipher.final(),
  ])

  return {
    encrypted_private: encrypted.toString('base64'),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

function unwrapPrivateKey(row, password) {
  try {
    const key = crypto.scryptSync(password, Buffer.from(row.salt, 'base64'), 32)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(row.tag, 'base64'))
    const pem = Buffer.concat([
      decipher.update(Buffer.from(row.encrypted_private, 'base64')),
      decipher.final(),
    ])

    return crypto.createPrivateKey(pem)
  } catch {
    return null
  }
}

async function createKey(userId, password) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
  const wrapped = wrapPrivateKey(privateKey, password)

  await db.prepare('UPDATE officer_keys SET active = 0 WHERE user_id = ?').run(userId)
  const result = await db.prepare(`
    INSERT INTO officer_keys (user_id, public_key, fingerprint, encrypted_private, salt, iv, tag, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(userId, publicPem, fingerprintOf(publicPem), wrapped.encrypted_private, wrapped.salt, wrapped.iv, wrapped.tag, new Date().toISOString())

  return { id: result.lastInsertRowid, privateKey, fingerprint: fingerprintOf(publicPem) }
}

// Confirms the officer's password and signs `payload` (canonical JSON).
export async function signAsOfficer(user, password, payload) {
  const account = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)

  if (!password || !(await bcrypt.compare(String(password), account.password))) {
    throw new SigningError('Password confirmation failed. Enter your account password to sign.', 400)
  }

  let key = null
  const active = await db.prepare('SELECT * FROM officer_keys WHERE user_id = ? AND active = 1').get(user.id)

  if (active) {
    const privateKey = unwrapPrivateKey(active, password)
    if (privateKey) key = { id: active.id, privateKey, fingerprint: active.fingerprint }
  }

  key ||= await createKey(user.id, password)

  const signedPayload = JSON.stringify(payload)
  const signature = crypto.sign(null, Buffer.from(signedPayload), key.privateKey).toString('base64')

  return { signedPayload, signature, keyId: key.id, fingerprint: key.fingerprint }
}

export async function verifySignature({ signedPayload, signature, keyId }) {
  if (!signedPayload || !signature || !keyId) return { valid: false, fingerprint: null }

  const key = await db.prepare('SELECT public_key, fingerprint FROM officer_keys WHERE id = ?').get(keyId)
  if (!key) return { valid: false, fingerprint: null }

  const valid = crypto.verify(
    null,
    Buffer.from(signedPayload),
    crypto.createPublicKey(key.public_key),
    Buffer.from(signature, 'base64'),
  )

  return { valid, fingerprint: key.fingerprint }
}
