import { API_URL, getToken } from './api'

export const MAX_PDF_BYTES = 10 * 1024 * 1024

// Returns a message when the chosen file cannot be used, otherwise ''.
export function checkPdf(file) {
  if (!file) return ''
  const looksLikePdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (!looksLikePdf) return 'Please choose a PDF file.'
  if (file.size > MAX_PDF_BYTES) return `This PDF is ${(file.size / 1048576).toFixed(1)} MB. The limit is 10 MB.`
  if (file.size === 0) return 'This file is empty.'
  return ''
}

export const sizeLabel = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

export async function uploadLabDocument(reviewId, file) {
  const response = await fetch(`${API_URL}/company/lab-reviews/${reviewId}/document`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/pdf',
      'x-file-name': encodeURIComponent(file.name),
      Authorization: `Bearer ${getToken()}`,
    },
    body: file,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || 'The PDF could not be uploaded')
  return payload
}

// Opens the scanned certificate in a new tab.
export async function openLabDocument(reviewId) {
  const response = await fetch(`${API_URL}/company/lab-reviews/${reviewId}/document`, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || 'The PDF could not be opened')
  }
  const url = URL.createObjectURL(await response.blob())
  window.open(url, '_blank', 'noopener')
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}
