import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;
let schemaReady = false;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getDbClient(): Client {
  if (client) {
    return client;
  }

  client = createClient({
    url: requiredEnv("TURSO_DATABASE_URL"),
    authToken: requiredEnv("TURSO_AUTH_TOKEN"),
  });

  return client;
}

export async function ensureSchema(): Promise<void> {
  if (schemaReady) {
    return;
  }

  const db = getDbClient();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS main_keys (
      id TEXT PRIMARY KEY,
      public_key TEXT NOT NULL UNIQUE,
      short_key TEXT UNIQUE,
      current_generation INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Backward-compatible migration for existing databases.
  try {
    await db.execute("ALTER TABLE main_keys ADD COLUMN short_key TEXT");
  } catch {
    // Ignore when column already exists.
  }
  try {
    await db.execute(
      "ALTER TABLE main_keys ADD COLUMN current_generation INTEGER NOT NULL DEFAULT 1"
    );
  } catch {
    // Ignore when column already exists.
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sub_keys (
      id TEXT PRIMARY KEY,
      main_key_id TEXT NOT NULL,
      public_key TEXT NOT NULL UNIQUE,
      generation INTEGER NOT NULL DEFAULT 1,
      consumed_at TEXT NULL,
      consumed_via TEXT NULL,
      revoked_at TEXT NULL,
      revoked_reason TEXT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (main_key_id) REFERENCES main_keys(id)
    )
  `);

  try {
    await db.execute("ALTER TABLE sub_keys ADD COLUMN generation INTEGER NOT NULL DEFAULT 1");
  } catch {
    // Ignore when column already exists.
  }
  try {
    await db.execute("ALTER TABLE sub_keys ADD COLUMN revoked_at TEXT NULL");
  } catch {
    // Ignore when column already exists.
  }
  try {
    await db.execute("ALTER TABLE sub_keys ADD COLUMN revoked_reason TEXT NULL");
  } catch {
    // Ignore when column already exists.
  }

  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_sub_keys_main_key_id ON sub_keys(main_key_id)"
  );
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_sub_keys_consumed_at ON sub_keys(consumed_at)"
  );
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_sub_keys_main_generation ON sub_keys(main_key_id, generation)"
  );
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_sub_keys_revoked_at ON sub_keys(revoked_at)"
  );
  await db.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_main_keys_short_key ON main_keys(short_key)"
  );

  await db.execute(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      outcome TEXT NOT NULL,
      main_key_id TEXT NULL,
      sub_key_id TEXT NULL,
      key_hash TEXT NULL,
      actor_hash TEXT NULL,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (main_key_id) REFERENCES main_keys(id),
      FOREIGN KEY (sub_key_id) REFERENCES sub_keys(id)
    )
  `);
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_audit_events_type_created ON audit_events(event_type, created_at)"
  );
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_audit_events_main_created ON audit_events(main_key_id, created_at)"
  );
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_audit_events_sub_created ON audit_events(sub_key_id, created_at)"
  );

  schemaReady = true;
}
