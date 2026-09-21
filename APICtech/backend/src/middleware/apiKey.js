import crypto from 'node:crypto'

import db from '../database/database.js'

function hashApiKey(apiKey) {
  return crypto
    .createHash('sha256')
    .update(apiKey)
    .digest('hex')
}

export async function authenticateCaptainApiKey(req, res, next) {
  const apiKey = req.headers['x-apictech-api-key']

  if (!apiKey) {
    return res.status(401).json({
      message: 'APICtech API key is required',
    })
  }

  // Development bridge: set CAPTAIN_API_KEY until client provisioning is added.
  const configuredKey = process.env.CAPTAIN_API_KEY
  const configuredHash = configuredKey ? hashApiKey(configuredKey) : null
  const client = await db
    .prepare(`
      SELECT id, client_name, client_type
      FROM api_clients
      WHERE api_key_hash = ? AND active = 1
    `)
    .get(hashApiKey(apiKey))

  if (!client && (!configuredHash || configuredHash !== hashApiKey(apiKey))) {
    return res.status(403).json({
      message: 'Invalid or inactive APICtech API key',
    })
  }

  req.apiClient = client || {
    id: 'environment-key',
    client_name: 'Configured captain app',
    client_type: 'CAPTAIN_APP',
  }

  next()
}