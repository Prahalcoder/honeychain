import express from 'express'

import { authenticateToken, loadOrganization, requireRole } from '../middleware/auth.js'
import { RegistrationError, buildProfile } from '../services/registrationProfile.js'
import { getProfile, saveProfile } from '../services/profiles.js'
import { checkDocType, listOrgDocuments, pdfBody, saveOrgDocument, sendOrgDocument } from '../services/orgDocuments.js'

// A company's own registration record, for its owner (a beekeeper or a wholesaler): the details declared at
// registration, which can be corrected any time, and the documents behind them. Works before approval, so a
// new applicant can add a missing document while the officer is still reviewing.
const router = express.Router()
router.use(authenticateToken, requireRole('BEEKEEPER', 'WHOLESALER'), loadOrganization)

router.get('/profile', async (req, res) => {
  res.json({ profile: await getProfile(req.org.id), documents: await listOrgDocuments(req.org.id) })
})

router.put('/profile', async (req, res) => {
  const current = await getProfile(req.org.id)
  const category = current?.category || (req.user.role === 'WHOLESALER' ? 'WHOLESALER' : String(req.body.category || 'INDIVIDUAL'))
  // A beekeeper cannot turn into a wholesaler (or back) by editing: that is a different kind of account.
  if ((category === 'WHOLESALER') !== (req.user.role === 'WHOLESALER')) return res.status(400).json({ message: 'This account cannot use that category' })

  try {
    await saveProfile(req.org.id, buildProfile(category, req.body.profile || {}, { name: req.user.name }, current))
  } catch (error) {
    if (error instanceof RegistrationError) return res.status(400).json({ message: error.message })
    throw error
  }
  res.json({ profile: await getProfile(req.org.id), documents: await listOrgDocuments(req.org.id) })
})

router.get('/documents', async (req, res) => {
  res.json(await listOrgDocuments(req.org.id))
})

router.put('/documents/:type', pdfBody, async (req, res) => {
  try {
    checkDocType(req.params.type)
  } catch (error) { return res.status(error.status).json({ message: error.message }) }

  const saved = await saveOrgDocument({
    orgId: req.org.id, orgCode: req.org.organization_code, docType: req.params.type,
    buffer: req.body, fileName: decodeURIComponent(String(req.get('x-file-name') || '')), userId: req.user.id,
  })
  if (saved.error) return res.status(saved.status).json({ message: saved.error })
  res.status(201).json(saved)
})

router.get('/documents/:type', async (req, res) => {
  try {
    checkDocType(req.params.type)
  } catch (error) { return res.status(error.status).json({ message: error.message }) }
  return sendOrgDocument(res, req.org.id, req.params.type)
})

export default router
