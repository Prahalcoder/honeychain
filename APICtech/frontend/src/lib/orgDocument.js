import { API_URL, getToken } from './api'
import { MAX_PDF_BYTES, checkPdf, sizeLabel } from './labDocument'

export { MAX_PDF_BYTES, checkPdf, sizeLabel }

// Registration paperwork (bee-colony photo, ID proof, FSSAI licence, bye-laws, trade licence ...): one current file
// per document type, a PDF scan or a JPEG / PNG photo. The server checks the file's real type from its bytes.
// `token` lets this be used right after registration, before that response's token is stored anywhere else.
export const DOCUMENT_ACCEPT = 'application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png'

// Returns a message when the chosen file cannot be used, otherwise ''.
export function checkDocumentFile(file) {
  if (!file) return ''
  const allowed = ['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || /\.(pdf|jpe?g|png)$/i.test(file.name)
  if (!allowed) return 'Please choose a PDF, JPG or PNG file.'
  if (file.size > MAX_PDF_BYTES) return `This file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 10 MB.`
  if (file.size === 0) return 'This file is empty.'
  return ''
}

export async function uploadOrgDocument(docType, file, token = getToken()) {
  const response = await fetch(`${API_URL}/org/documents/${docType}`, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), Authorization: `Bearer ${token}` },
    body: file,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || 'The file could not be uploaded')
  return payload
}

export async function openOrgDocument(docType, token = getToken()) {
  const response = await fetch(`${API_URL}/org/documents/${docType}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || 'The file could not be opened')
  }
  const url = URL.createObjectURL(await response.blob())
  window.open(url, '_blank', 'noopener')
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}
