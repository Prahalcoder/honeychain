import { pgDdl } from './ddl.js'

// Hive-health SMS alerts. The ESP32 has no GSM module: the hive monitor (beehive/python_app) runs the hive-health
// analysis, and when it finds a serious problem it calls this API, which texts the keeper through an SMS API
// (services/sms.js). A monitor is linked to one keeper's hive with a random token; only its hash is stored.
export async function ensureAlertSchema(db, addColumn) {
  await db.exec(pgDdl(`
    CREATE TABLE IF NOT EXISTS monitor_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      hive_code TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY (org_id) REFERENCES organizations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_links_org ON monitor_links(org_id, hive_code);

    -- One row per problem the monitor reported. sms_status: SENT, DRY_RUN (no SMS provider configured), FAILED,
    -- SKIPPED (keeper turned SMS off or has no mobile number) or COOLDOWN (same problem texted recently).
    CREATE TABLE IF NOT EXISTS hive_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      hive_code TEXT NOT NULL,
      risk_name TEXT NOT NULL,
      level TEXT NOT NULL,
      hive_status TEXT,
      score INTEGER,
      reason TEXT,
      action TEXT,
      sms_status TEXT NOT NULL,
      sms_to TEXT,
      sms_text TEXT,
      sms_error TEXT,
      provider_ref TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (org_id) REFERENCES organizations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_hive_alerts_org ON hive_alerts(org_id, created_at);
  `))
  await db.refresh()

  // The keeper can turn hive SMS alerts off (on by default).
  await addColumn('user_settings', 'sms_alerts', 'INTEGER NOT NULL DEFAULT 1')
}
