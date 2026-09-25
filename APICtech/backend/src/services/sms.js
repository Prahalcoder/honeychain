import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '../config/paths.js'

// Sends a text message through an internet SMS API instead of a GSM module on the hive hardware.
//
//   SMS_PROVIDER=fast2sms   FAST2SMS_API_KEY=...                                   (Indian numbers)
//   SMS_PROVIDER=twilio     TWILIO_ACCOUNT_SID=...  TWILIO_AUTH_TOKEN=...  TWILIO_FROM=+1...
//
// With no provider configured nothing is sent: the message is written to data/outbox/sms-*.txt and reported as
// DRY_RUN, so the alert flow can be shown without an SMS account (same approach as services/mailer.js).
// In India, commercial SMS must use DLT-registered sender IDs and templates (TRAI); a provider's quick / test route
// is fine for a demo, but a real rollout needs the DLT registration done with the provider.
const TIMEOUT_MS = 10000
const outboxDir = path.join(DATA_DIR, 'outbox')

export const smsProvider = () => {
  const name = String(process.env.SMS_PROVIDER || '').toLowerCase()
  if (name === 'fast2sms' && process.env.FAST2SMS_API_KEY) return 'fast2sms'
  if (name === 'twilio' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) return 'twilio'
  return null
}

// A 10-digit Indian mobile number, or null.
export function indianMobile(value) {
  const digits = String(value || '').replace(/[^\d]/g, '').replace(/^(91|0)(?=\d{10}$)/, '')
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

export const maskMobile = (mobile) => (mobile ? `XXXXXX${mobile.slice(-4)}` : '')

function dryRun(to, text) {
  try {
    fs.mkdirSync(outboxDir, { recursive: true })
    const file = path.join(outboxDir, `sms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
    fs.writeFileSync(file, `SMS to: +91 ${to}\n\n${text}\n`)
    console.log(`[sms] (not sent, no SMS_PROVIDER configured) to ${maskMobile(to)}, saved to ${file}`)
  } catch (error) {
    console.error('[sms] could not write to the local outbox:', error.message)
  }
  return { status: 'DRY_RUN', ref: null, error: null }
}

async function post(url, options) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const body = await response.json().catch(() => ({}))
    return { ok: response.ok, body }
  } finally {
    clearTimeout(timer)
  }
}

async function viaFast2sms(to, text) {
  const { ok, body } = await post('https://www.fast2sms.com/dev/bulkV2', {
    method: 'POST',
    headers: { authorization: process.env.FAST2SMS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ route: process.env.FAST2SMS_ROUTE || 'q', message: text, language: 'english', flash: 0, numbers: to }),
  })
  if (!ok || body.return === false) throw new Error(Array.isArray(body.message) ? body.message.join(' ') : body.message || 'Fast2SMS refused the message')
  return body.request_id || null
}

async function viaTwilio(to, text) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const { ok, body } = await post(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: `+91${to}`, From: process.env.TWILIO_FROM, Body: text }),
  })
  if (!ok) throw new Error(body.message || 'Twilio refused the message')
  return body.sid || null
}

// Never throws: returns { status: 'SENT' | 'DRY_RUN' | 'FAILED', ref, error }.
export async function sendSms(to, text) {
  const mobile = indianMobile(to)
  if (!mobile) return { status: 'FAILED', ref: null, error: 'No valid 10-digit mobile number' }
  const provider = smsProvider()
  if (!provider) return dryRun(mobile, text)

  try {
    const ref = provider === 'fast2sms' ? await viaFast2sms(mobile, text) : await viaTwilio(mobile, text)
    return { status: 'SENT', ref, error: null }
  } catch (error) {
    const message = error.name === 'AbortError' ? `${provider} did not answer in time` : error.message
    console.error(`[sms] ${provider} failed for ${maskMobile(mobile)}: ${message}`)
    return { status: 'FAILED', ref: null, error: String(message).slice(0, 300) }
  }
}
