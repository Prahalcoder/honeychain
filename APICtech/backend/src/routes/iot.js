import express from 'express'

import { AlertError, receiveReport } from '../services/hiveAlerts.js'

// Called by the hive monitor (beehive/python_app/alerts.py), not by people: it reports what the hive-health
// analysis found, authenticated with the monitor token the keeper created when linking the hive.
const router = express.Router()

router.post('/alerts', async (req, res) => {
  const header = String(req.get('authorization') || '')
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  try {
    res.json(await receiveReport(token, req.body || {}))
  } catch (error) {
    if (error instanceof AlertError) return res.status(error.status).json({ message: error.message })
    throw error
  }
})

export default router
