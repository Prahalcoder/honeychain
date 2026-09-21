import crypto from 'node:crypto'
import express from 'express'

import db from '../database/database.js'
import { lockDown, pgDdl } from '../database/ddl.js'
import { sealPendingBlock } from './blockchain.js'
import { appendTraceabilityEvent } from './traceabilityLog.js'

// Scanned copy of a laboratory certificate (PDF, up to 10 MB). Optional for now:
// set REQUIRE_LAB_DOCUMENT=true to make it compulsory before an officer can review.
// The file is stored in the lab_documents table of the same database; the chain records its SHA-256 fingerprint, so
// anyone can later prove the copy the officer saw is the copy the keeper uploaded.
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
export const REQUIRE_LAB_DOCUMENT = process.env.REQUIRE_LAB_DOCUMENT === 'true'

await db.exec(pgDdl(`
  CREATE TABLE IF NOT EXISTS lab_documents (
    review_id INTEGER PRIMARY KEY,
    content BYTEA NOT NULL
  );
`))
await db.refresh()
await lockDown('public')

export const documentFields = `r.document_name, r.document_size, r.document_sha256, r.document_uploaded_at`

// Reads the raw PDF body. Runs before the route so a too-large or wrong-type upload gets a clear message.
export const pdfBody = (req, res, next) => {
  express.raw({ type: () => true, limit: MAX_DOCUMENT_BYTES })(req, res, (error) => {
    if (!error) return next()
    if (error.type === 'entity.too.large') return res.status(413).json({ message: 'The PDF is larger than 10 MB. Please upload a smaller scan.' })
    return res.status(400).json({ message: 'The upload could not be read. Please try again.' })
  })
}

export function cleanFileName(value) {
  const name = String(value || '').replace(/[^\w.\- ()]+/g, '_').trim().slice(0, 80)
  return name || 'certificate.pdf'
}

// Stores the PDF for a review that is still waiting for the officer.
export async function saveDocument({ review, buffer, fileName, userId, orgCode }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { error: 'Choose a PDF file to upload', status: 400 }
  if (buffer.length > MAX_DOCUMENT_BYTES) return { error: 'The PDF is larger than 10 MB. Please upload a smaller scan.', status: 413 }
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return { error: 'Only PDF files are accepted', status: 400 }
  if (review.status !== 'PENDING') return { error: 'The officer has already decided on this certificate, so the file can no longer be changed', status: 409 }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  const stored = `db:${review.id}`
  const name = cleanFileName(fileName)

  await db.transaction(async () => {
    await db.prepare('INSERT INTO lab_documents (review_id, content) VALUES (?, ?) ON CONFLICT (review_id) DO UPDATE SET content = excluded.content').run(review.id, buffer)
    await db.prepare(`
      UPDATE lab_reviews SET document_file = ?, document_name = ?, document_size = ?, document_sha256 = ?, document_uploaded_at = ?
      WHERE id = ?
    `).run(stored, name, buffer.length, sha256, new Date().toISOString(), review.id)

    await appendTraceabilityEvent({
      entityType: 'BATCH',
      entityId: review.batch_code,
      eventType: 'LAB_DOCUMENT_ATTACHED',
      payload: { organizationCode: orgCode, reviewId: review.id, fileName: name, sizeBytes: buffer.length, sha256 },
      createdBy: userId,
    })
    await sealPendingBlock()
  })()

  return { name, size: buffer.length, sha256 }
}

// Sends the stored PDF. `row` needs document_file and document_name.
export async function sendDocument(res, row) {
  const reviewId = /^db:(\d+)$/.exec(row?.document_file || '')?.[1]
  const stored = reviewId && await db.prepare('SELECT content FROM lab_documents WHERE review_id = ?').get(Number(reviewId))

  if (!stored) {
    return res.status(404).json({ message: 'No scanned certificate was uploaded for this result' })
  }

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${cleanFileName(row.document_name)}"`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-store')
  return res.send(stored.content)
}
