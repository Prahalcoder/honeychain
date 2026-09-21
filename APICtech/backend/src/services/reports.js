import db from '../database/database.js'
import { getCompanyDb } from './companyDb.js'

// Publishes the aggregate income per month from a company's private database
// to the common database. Individual finance entries are never copied.
export async function syncMonthlyReport(organization) {
  if (organization.status === 'CLOSED') return
  const rows = await (await getCompanyDb(organization.organization_code)).prepare(`
    SELECT substr(entry_date, 1, 7) AS month, SUM(amount_inr) AS income
    FROM finance_entries
    WHERE type = 'INCOME'
    GROUP BY month
  `).all()

  await db.transaction(async () => {
    await db.prepare('DELETE FROM monthly_reports WHERE org_id = ?').run(organization.id)

    const insert = db.prepare(`
      INSERT INTO monthly_reports (org_id, month, income_inr, updated_at) VALUES (?, ?, ?, ?)
    `)

    for (const row of rows) await insert.run(organization.id, row.month, row.income, new Date().toISOString())
  })()
}

export function currentMonth() {
  return new Date().toLocaleDateString('en-CA').slice(0, 7)
}

// Last `count` month keys ending with the current month, oldest first.
export function recentMonths(count) {
  const now = new Date()

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1)
    return date.toLocaleDateString('en-CA').slice(0, 7)
  })
}
