import { ensureSchema, getDbClient } from "@/lib/db";
import { isMainLongKey, parseAndVerifyKey } from "@/lib/keys";
import { writeAuditEvent } from "@/lib/audit";

interface ResolveRequestBody {
  key?: string;
}

export async function POST(request: Request): Promise<Response> {
  const actor = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
  try {
    await ensureSchema();
    const body = (await request.json()) as ResolveRequestBody;
    const key = body.key?.trim();
    if (!key) {
      return Response.json({ error: "invalid", message: "Key is required" }, { status: 400 });
    }

    const parsed = parseAndVerifyKey(key);
    if (!parsed) {
      await writeAuditEvent({
        eventType: "resolve",
        outcome: "tampered",
        keyRaw: key,
        actor,
      });
      return Response.json(
        { error: "tampered", message: "Invalid or tampered key" },
        { status: 400 }
      );
    }

    const db = getDbClient();

    if (parsed.type === "main") {
      const mainWhereSql = isMainLongKey(parsed.key)
        ? "SELECT id, public_key, short_key, created_at FROM main_keys WHERE public_key = ?"
        : "SELECT id, public_key, short_key, created_at FROM main_keys WHERE short_key = ?";

      const mainResult = await db.execute({
        sql: mainWhereSql,
        args: [parsed.key],
      });

      if (mainResult.rows.length === 0) {
        await writeAuditEvent({
          eventType: "resolve",
          outcome: "not_found",
          keyRaw: parsed.key,
          actor,
        });
        return Response.json({ error: "not_found", message: "Main key not found" }, { status: 404 });
      }

      const mainId = String(mainResult.rows[0].id);
      await writeAuditEvent({
        eventType: "resolve",
        outcome: "ok_main",
        mainKeyId: mainId,
        keyRaw: parsed.key,
        actor,
      });

      return Response.json({
        type: "main",
        mainId,
      });
    }

    const subResult = await db.execute({
      sql: "SELECT id, main_key_id, public_key, consumed_at, revoked_at, generation FROM sub_keys WHERE public_key = ?",
      args: [parsed.key],
    });

    if (subResult.rows.length === 0) {
      await writeAuditEvent({
        eventType: "resolve",
        outcome: "not_found",
        keyRaw: parsed.key,
        actor,
      });
      return Response.json({ error: "not_found", message: "Sub key not found" }, { status: 404 });
    }

    const row = subResult.rows[0];
    const subId = String(row.id);
    const mainId = String(row.main_key_id);
    await writeAuditEvent({
      eventType: "resolve",
      outcome: "ok_sub",
      mainKeyId: mainId,
      subKeyId: subId,
      keyRaw: parsed.key,
      actor,
      meta: {
        consumed: Boolean(row.consumed_at),
        revoked: Boolean(row.revoked_at),
        generation: Number(row.generation),
      },
    });

    return Response.json({
      type: "sub",
      mainId,
      consumed: Boolean(row.consumed_at),
      revoked: Boolean(row.revoked_at),
      generation: Number(row.generation),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve key";
    return Response.json({ error: "invalid", message }, { status: 500 });
  }
}
