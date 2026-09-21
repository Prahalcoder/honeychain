import crypto from 'node:crypto'

export function nextCode(prefix) {
  return `${prefix}-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
}
