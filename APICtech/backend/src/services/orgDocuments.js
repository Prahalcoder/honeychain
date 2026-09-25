import crypto from 'node:crypto'

import db from '../database/database.js'
import { DOC_TYPES, documentsFor } from '../config/registration.js'
import { sealPendingBlock } from './blockchain.js'
import { appendTraceabilityEvent } from './traceabilityLog.js'
import { MAX_DOCUMENT_BYTES, cleanFileName, pdfBody } from './labDocuments.js'

// Registration paperwork, one current file per document type per company: the photo of the bee colonies with the
// beekeeper, ID proof, FSSAI licence, society bye-laws, certificate of incorporation, trade licence and the rest
// (config/registration.js lists which ones each category needs). A PDF or a JPEG / PNG photo. Set
// REQUIRE_REGISTRATION_DOCUMENTS=true to refuse approval until every required document is on file; off by
// default so the demo farms and the existing test suite need no changes.
export const REQUIRE_REGISTRATION_DOCUMENTS = process.env.REQUIRE_REGISTRATION_DOCUMENTS === 'true'

export { DOC_TYPES, pdfBody }

export function checkDocType(type) {
  if (!DOC_TYPES[type]) throw Object.assign(new Error('Unknown document type'), { status: 400 })
  return type
}

// What the file really is, from its first bytes (never trust the name or the header the browser sent).
function sniff(buffer) {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  return null
}

export async function saveOrgDocument({ orgId, orgCode, docType, buffer, fileName, userId }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { error: 'Choose a file to upload', status: 400 }
  if (buffer.length > MAX_DOCUMENT_BYTES) return { error: 'The file is larger than 10 MB. Please upload a smaller scan or photo.', status: 413 }
  const contentType = sniff(buffer)
  if (!contentType) return { error: 'Only PDF, JPEG or PNG files are accepted', status: 400 }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  const name = cleanFileName(fileName)
  const now = new Date().toISOString()

  await db.transaction(async () => {
    await db.prepare(`
      INSERT INTO organization_documents (org_id, doc_type, file_name, size_bytes, sha256, content, content_type, uploaded_by, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (org_id, doc_type) DO UPDATE SET
        file_name = excluded.file_name, size_bytes = excluded.size_bytes, sha256 = excluded.sha256, content = excluded.content,
        content_type = excluded.content_type, uploaded_by = excluded.uploaded_by, uploaded_at = excluded.uploaded_at
    `).run(orgId, docType, name, buffer.length, sha256, buffer, contentType, userId, now)

    // Only the fingerprint goes on the chain, so anyone can later prove the file an officer saw is unchanged.
    await appendTraceabilityEvent({
      entityType: 'ORGANIZATION',
      entityId: orgCode,
      eventType: 'ORGANIZATION_DOCUMENT_UPLOADED',
      payload: { organizationCode: orgCode, docType, fileName: name, sizeBytes: buffer.length, sha256 },
      createdBy: userId,
    })
    await sealPendingBlock()
  })()

  return { docType, fileName: name, sizeBytes: buffer.length, sha256, contentType, uploadedAt: now }
}

async function categoryOf(orgId) {
  const row = await db.prepare('SELECT applicant_category FROM organization_profiles WHERE org_id = ?').get(orgId)
  return row?.applicant_category || 'INDIVIDUAL'
}

// What a company has on file, in the order its category needs them, each marked required or optional.
export async function listOrgDocuments(orgId) {
  const rows = await db.prepare(`
    SELECT doc_type AS "docType", file_name AS "fileName", size_bytes AS "sizeBytes", sha256, content_type AS "contentType", uploaded_at AS "uploadedAt"
    FROM organization_documents WHERE org_id = ?
  `).all(orgId)
  const byType = new Map(rows.map((row) => [row.docType, row]))
  const expected = documentsFor(await categoryOf(orgId))
  const listed = expected.map((item) => ({ ...(byType.get(item.type) || { fileName: null }), docType: item.type, label: item.label, required: item.required }))
  // Anything uploaded under a type the category no longer lists still shows, so nothing on file is hidden.
  for (const row of rows) {
    if (!expected.some((item) => item.type === row.docType)) listed.push({ ...row, label: DOC_TYPES[row.docType] || row.docType, required: false })
  }
  return listed
}

export async function missingRequiredDocuments(orgId) {
  return (await listOrgDocuments(orgId)).filter((item) => item.required && !item.fileName).map((item) => item.label)
}

export async function hasFssai(orgId) {
  return Boolean(await db.prepare("SELECT 1 AS found FROM organization_documents WHERE org_id = ? AND doc_type = 'FSSAI'").get(orgId))
}

export async function sendOrgDocument(res, orgId, docType) {
  const row = await db.prepare('SELECT content, file_name, content_type FROM organization_documents WHERE org_id = ? AND doc_type = ?').get(orgId, docType)
  if (!row) return res.status(404).json({ message: 'No document of this type has been uploaded' })

  res.setHeader('Content-Type', row.content_type || 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${cleanFileName(row.file_name)}"`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-store')
  return res.send(row.content)
}
