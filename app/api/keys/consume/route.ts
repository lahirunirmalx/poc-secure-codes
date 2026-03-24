import { ensureSchema, getDbClient } from "@/lib/db";
import { parseAndVerifyKey } from "@/lib/keys";
import { writeAuditEvent } from "@/lib/audit";

interface ConsumeRequestBody {
  key?: string;
  via?: "scan" | "manual" | "main-selection";
}

export async function POST(request: Request): Promise<Response> {
  const actor = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
  try {
    await ensureSchema();
    const body = (await request.json()) as ConsumeRequestBody;
    const key = body.key?.trim();
    const via = body.via ?? "manual";

    if (!key) {
      return Response.json({ error: "invalid", message: "Key is required" }, { status: 400 });
    }

    const parsed = parseAndVerifyKey(key);
    if (!parsed) {
      await writeAuditEvent({
        eventType: "consume",
        outcome: "tampered",
        keyRaw: key,
        actor,
      });
      return Response.json(
        { error: "tampered", message: "Invalid or tampered key" },
        { status: 400 }
      );
    }

    if (parsed.type !== "sub") {
      await writeAuditEvent({
        eventType: "consume",
        outcome: "invalid_type",
        keyRaw: parsed.key,
        actor,
      });
      return Response.json(
        { error: "invalid", message: "Only sub keys can be consumed" },
        { status: 400 }
      );
    }

    const db = getDbClient();
    const now = new Date().toISOString();
    const result = await db.execute({
      sql: `
        UPDATE sub_keys
        SET consumed_at = ?, consumed_via = ?
        WHERE public_key = ? AND consumed_at IS NULL AND revoked_at IS NULL
      `,
      args: [now, via, parsed.key],
    });

    if ((result.rowsAffected ?? 0) === 0) {
      const existing = await db.execute({
        sql: "SELECT id, main_key_id, consumed_at, revoked_at FROM sub_keys WHERE public_key = ?",
        args: [parsed.key],
      });
      if (existing.rows.length === 0) {
        await writeAuditEvent({
          eventType: "consume",
          outcome: "not_found",
          keyRaw: parsed.key,
          actor,
        });
        return Response.json(
          { error: "not_found", message: "Sub key not found" },
          { status: 404 }
        );
      }
      if (existing.rows[0].revoked_at) {
        await writeAuditEvent({
          eventType: "consume",
          outcome: "revoked",
          mainKeyId: String(existing.rows[0].main_key_id),
          subKeyId: String(existing.rows[0].id),
          keyRaw: parsed.key,
          actor,
        });
        return Response.json(
          { error: "revoked", message: "Sub key was revoked and cannot be used" },
          { status: 409 }
        );
      }
      await writeAuditEvent({
        eventType: "consume",
        outcome: "already_consumed",
        mainKeyId: String(existing.rows[0].main_key_id),
        subKeyId: String(existing.rows[0].id),
        keyRaw: parsed.key,
        actor,
      });
      return Response.json(
        { error: "already_consumed", message: "Sub key already consumed" },
        { status: 409 }
      );
    }

    const consumedRow = await db.execute({
      sql: "SELECT id, main_key_id FROM sub_keys WHERE public_key = ?",
      args: [parsed.key],
    });
    if (consumedRow.rows.length === 0) {
      return Response.json(
        { error: "not_found", message: "Sub key not found" },
        { status: 404 }
      );
    }

    const subId = String(consumedRow.rows[0].id);
    const mainId = String(consumedRow.rows[0].main_key_id);
    await writeAuditEvent({
      eventType: "consume",
      outcome: "ok",
      mainKeyId: mainId,
      subKeyId: subId,
      keyRaw: parsed.key,
      actor,
      meta: { via },
    });

    return Response.json({ status: "consumed", consumedAt: now });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to consume key";
    return Response.json({ error: "invalid", message }, { status: 500 });
  }
}
