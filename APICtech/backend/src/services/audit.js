import db from '../database/database.js'

// Append-only record of what officers do. Read by the KVIC head (everyone),
// state officers (their regional officers) and regional officers (themselves).
export async function recordAudit(user, action, targetType = null, targetId = null, detail = null) {
  await db.prepare(`
    INSERT INTO audit_log (actor_user_id, actor_role, action, target_type, target_id, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    user.role,
    action,
    targetType,
    targetId === null ? null : String(targetId),
    detail ? JSON.stringify(detail) : null,
    new Date().toISOString(),
  )
}
