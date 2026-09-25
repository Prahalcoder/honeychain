import crypto from 'node:crypto'

import db from '../database/database.js'
import { sendMail } from './mailer.js'
import { indianMobile, maskMobile, sendSms } from './sms.js'

// One-time codes: 6 digits, valid 5 minutes, 5 wrong tries, at most one every 45 seconds and 6 an hour for the
// same subject. Only a hash of the code is stored. Used to sign in without a password and for a beekeeper to
// confirm a wholesaler's receipt.
export class OtpError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const TTL_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 5
const now = () => new Date().toISOString()
const hashOf = (purpose, subjectKey, code) =>
  crypto.createHash('sha256').update(`${purpose}|${subjectKey}|${code}|${process.env.JWT_SECRET || 'honeychain'}`).digest('hex')

export async function issueOtp({ purpose, subjectKey, meta = {} }) {
  const hourAgo = new Date(Date.now() - 3600000).toISOString()
  const recent = await db.prepare('SELECT created_at FROM otp_codes WHERE purpose = ? AND subject_key = ? AND created_at > ? ORDER BY id DESC')
    .all(purpose, subjectKey, hourAgo)
  if (recent.length && Date.now() - Date.parse(recent[0].created_at) < 45000) throw new OtpError('An OTP was just sent. Wait a few seconds before asking for another one.', 429)
  if (recent.length >= 6) throw new OtpError('Too many OTPs were requested. Try again in an hour.', 429)

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0')
  await db.transaction(async () => {
    // Only the newest code counts.
    await db.prepare('UPDATE otp_codes SET consumed_at = ? WHERE purpose = ? AND subject_key = ? AND consumed_at IS NULL').run(now(), purpose, subjectKey)
    await db.prepare('INSERT INTO otp_codes (purpose, subject_key, code_hash, meta_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(purpose, subjectKey, hashOf(purpose, subjectKey, code), JSON.stringify(meta), new Date(Date.now() + TTL_MS).toISOString(), now())
  })()
  return code
}

export async function verifyOtp({ purpose, subjectKey, code }) {
  const entered = String(code ?? '').replace(/\D/g, '')
  const row = await db.prepare('SELECT * FROM otp_codes WHERE purpose = ? AND subject_key = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1').get(purpose, subjectKey)
  if (!row) throw new OtpError('No OTP is waiting. Ask for a new one.')
  if (Date.parse(row.expires_at) < Date.now()) throw new OtpError('This OTP has expired. Ask for a new one.')
  if (row.attempts >= MAX_ATTEMPTS) throw new OtpError('Too many wrong tries. Ask for a new OTP.', 429)

  const expected = Buffer.from(row.code_hash, 'hex')
  const given = Buffer.from(hashOf(purpose, subjectKey, entered), 'hex')
  if (entered.length !== 6 || !crypto.timingSafeEqual(expected, given)) {
    await db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id)
    const left = MAX_ATTEMPTS - row.attempts - 1
    throw new OtpError(left > 0 ? `Wrong OTP. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Wrong OTP. Ask for a new one.', 400)
  }
  // Claim it, so the same code can never be used twice (even by two requests at once).
  const claimed = await db.prepare('UPDATE otp_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').run(now(), row.id)
  if (!claimed.changes) throw new OtpError('This OTP was already used. Ask for a new one.')
  try { return JSON.parse(row.meta_json) } catch { return {} }
}

// Sends a code by SMS (a mobile number) or e-mail. Without an SMS / mail provider nothing leaves the server
// (the message is saved in data/outbox); outside production the code is then handed back so the demo still works.
export async function deliverOtp({ to, text, subject = 'Honey Chain one-time code', code }) {
  const mobile = indianMobile(to)
  let delivered = false
  let channel
  let masked
  if (mobile) {
    channel = 'SMS'
    masked = `+91 ${maskMobile(mobile)}`
    const result = await sendSms(mobile, text)
    if (result.status === 'FAILED') throw new OtpError(`The SMS could not be sent: ${result.error}`, 502)
    delivered = result.status === 'SENT'
  } else {
    channel = 'EMAIL'
    const [name, domain] = String(to).split('@')
    masked = `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`
    const result = await sendMail({ to, subject, text })
    delivered = Boolean(result?.sent)
  }
  const demo = !delivered && process.env.NODE_ENV !== 'production'
  return { channel, to: masked, delivered, ...(demo ? { demoOtp: code } : {}) }
}
