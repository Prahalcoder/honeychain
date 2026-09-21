// Database tools:   node scripts/db.mjs verify | backup | list | check <backup-folder>
//
//   verify   reads every schema (the common one and one per company) and counts tables and rows
//   backup   writes a portable export now (JSON lines per table + a SHA-256 manifest)
//   list     shows the exports
//   check    re-computes the SHA-256 of every file of an export
//
// The data lives in the database named by DATABASE_URL (Supabase). Restoring is done with Supabase's own
// backups (Dashboard > Database > Backups); the exports here are a portable copy you can keep and audit.
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'

const [command, folderArg] = process.argv.slice(2)
const backup = await import('../src/services/backup.js')
const { default: db } = await import('../src/database/database.js')
const { closeDatabase } = await import('../src/database/connection.js')

const finish = async (code) => { await closeDatabase().catch(() => {}); process.exit(code) }

if (command === 'verify') {
  console.log(`Database: ${backup.databaseKind()}`)
  const results = await backup.verifyDatabases()
  for (const item of results) console.log(`${item.result === 'ok' ? 'ok ' : 'BAD'}  ${item.name.padEnd(36)} ${String(item.tables).padStart(3)} tables ${String(item.rows).padStart(7)} rows  ${item.result === 'ok' ? '' : item.result}`)
  await finish(results.every((item) => item.result === 'ok') ? 0 : 1)
} else if (command === 'backup') {
  const made = await backup.backupNow(db)
  console.log(`Export ${made.name}: ${made.files} tables, ${made.rows} rows, ledger head ${made.ledgerHead ? `#${made.ledgerHead.height}` : 'empty'} -> ${path.join(backup.BACKUP_DIR, made.name)}`)
  await finish(0)
} else if (command === 'list') {
  for (const item of backup.listBackups()) console.log(`${item.name}  ${item.files} tables  ledger #${item.ledgerHead?.height ?? '-'}`)
  await finish(0)
} else if (command === 'check') {
  if (!folderArg) { console.error('Usage: node scripts/db.mjs check <export-folder>'); await finish(1) }
  const source = path.isAbsolute(folderArg) ? folderArg : fs.existsSync(folderArg) ? path.resolve(folderArg) : path.join(backup.BACKUP_DIR, folderArg)
  const { manifest, bad } = backup.verifyBackup(source)
  console.log(bad.length ? `DAMAGED: ${bad.length} of ${manifest.files.length} file(s) do not match: ${bad.map((item) => item.path).join(', ')}` : `Intact: all ${manifest.files.length} files match the manifest.`)
  await finish(bad.length ? 1 : 0)
} else {
  console.log('Usage: node scripts/db.mjs verify | backup | list | check <export-folder>')
  await finish(1)
}
