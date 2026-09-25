import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '../config/paths.js'

// Sends the order-confirmation e-mails. With SMTP_HOST / SMTP_USER / SMTP_PASS set (a Gmail
// account needs an "app password", not the normal one: myaccount.google.com/apppasswords) it sends for real
// through nodemailer, loaded only then, so the project needs no mail dependency until one is configured. Set
// SMTP_FROM to the address it should send as (falls back to SMTP_USER).
//
// Without SMTP configured, nothing goes out: the message is written to data/outbox (one file per e-mail) and
// logged, so the whole order flow can be tried and demonstrated without a real mail account.
let transporter = null
let transporterTried = false

async function getTransporter() {
  if (transporterTried) return transporter
  transporterTried = true
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null

  try {
    const nodemailer = await import('nodemailer')
    transporter = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  } catch (error) {
    console.error('[mailer] SMTP is configured but the "nodemailer" package is not installed (npm install nodemailer). E-mails will be logged instead.', error.message)
    transporter = null
  }
  return transporter
}

const outboxDir = path.join(DATA_DIR, 'outbox')

function writeToOutbox({ to, subject, text, html }) {
  try {
    fs.mkdirSync(outboxDir, { recursive: true })
    const file = path.join(outboxDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
    fs.writeFileSync(file, `To: ${to || '(SMS / no address given)'}\nSubject: ${subject}\n\n${text}${html ? `\n\n[HTML version omitted from this file]` : ''}\n`)
    return file
  } catch (error) {
    console.error('[mailer] could not write to the local outbox:', error.message)
    return null
  }
}

// to may be null for messages meant for an SMS gateway rather than e-mail.
export async function sendMail({ to, subject, text, html }) {
  const client = await getTransporter()

  if (!client) {
    const file = writeToOutbox({ to, subject, text, html })
    console.log(`[mailer] (not sent, no SMTP configured) "${subject}" to ${to || 'no address'}${file ? ` — saved to ${file}` : ''}`)
    return { sent: false, savedTo: file }
  }

  if (!to) return { sent: false, savedTo: null } // nothing to send an SMS-only message to over SMTP

  try {
    await client.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html })
    return { sent: true }
  } catch (error) {
    console.error(`[mailer] sending "${subject}" to ${to} failed:`, error.message)
    writeToOutbox({ to, subject, text, html })
    return { sent: false, error: error.message }
  }
}
