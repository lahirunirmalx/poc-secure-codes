import { createHash, createHmac, randomUUID } from "crypto";
import { getDbClient } from "@/lib/db";

interface AuditEventInput {
  eventType: "resolve" | "consume" | "issue" | "revoke";
  outcome: string;
  mainKeyId?: string | null;
  subKeyId?: string | null;
  keyRaw?: string | null;
  actor?: string | null;
  meta?: Record<string, unknown>;
}

function hashKeyMaterial(input: string): string {
  const secret = process.env.KEY_SIGNING_SECRET ?? "dev-fallback-secret";
  return createHmac("sha256", secret).update(input).digest("hex");
}

function stableMeta(meta: Record<string, unknown> | undefined): string {
  if (!meta) {
    return "{}";
  }
  return JSON.stringify(meta, Object.keys(meta).sort());
}

export async function writeAuditEvent(input: AuditEventInput): Promise<void> {
  const db = getDbClient();
  const keyHash = input.keyRaw ? hashKeyMaterial(input.keyRaw.trim().toUpperCase()) : null;
  const metaJson = stableMeta(input.meta);
  const actorHash = input.actor
    ? createHash("sha256").update(input.actor.trim()).digest("hex")
    : null;

  await db.execute({
    sql: `
      INSERT INTO audit_events (
        id, event_type, outcome, main_key_id, sub_key_id, key_hash, actor_hash, meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      randomUUID(),
      input.eventType,
      input.outcome,
      input.mainKeyId ?? null,
      input.subKeyId ?? null,
      keyHash,
      actorHash,
      metaJson,
    ],
  });
}
