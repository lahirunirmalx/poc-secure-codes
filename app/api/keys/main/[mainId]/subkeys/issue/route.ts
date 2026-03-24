import { randomUUID } from "crypto";
import { ensureSchema, getDbClient } from "@/lib/db";
import { createSubKey } from "@/lib/keys";
import { writeAuditEvent } from "@/lib/audit";

interface Params {
  params: Promise<{ mainId: string }>;
}

interface IssueRequestBody {
  count?: number;
  strategy?: "append" | "replace";
  reason?: string;
}

async function insertUniqueSubKey(
  mainId: string,
  generation: number
): Promise<{ id: string; key: string }> {
  const db = getDbClient();
  for (let tries = 0; tries < 30; tries += 1) {
    const subId = randomUUID();
    const subKey = createSubKey();
    try {
      await db.execute({
        sql: "INSERT INTO sub_keys (id, main_key_id, public_key, generation) VALUES (?, ?, ?, ?)",
        args: [subId, mainId, subKey, generation],
      });
      return { id: subId, key: subKey };
    } catch {
      // Retry on possible unique collision.
    }
  }

  throw new Error("Failed to allocate unique sub key");
}

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const actor = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
  try {
    await ensureSchema();
    const { mainId } = await params;
    if (!mainId) {
      return Response.json({ error: "invalid", message: "mainId is required" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as IssueRequestBody;
    const requestedCount = Number(body.count ?? 10);
    const strategy = body.strategy ?? "append";
    const reason = body.reason?.trim() || "rotation";

    if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 100) {
      return Response.json(
        { error: "invalid", message: "count must be an integer between 1 and 100" },
        { status: 400 }
      );
    }

    if (strategy !== "append" && strategy !== "replace") {
      return Response.json(
        { error: "invalid", message: "strategy must be append or replace" },
        { status: 400 }
      );
    }

    const db = getDbClient();
    const main = await db.execute({
      sql: "SELECT id, current_generation FROM main_keys WHERE id = ?",
      args: [mainId],
    });
    if (main.rows.length === 0) {
      return Response.json({ error: "not_found", message: "Main key not found" }, { status: 404 });
    }

    const currentGeneration = Number(main.rows[0].current_generation ?? 1);
    let targetGeneration = currentGeneration;
    let revokedCount = 0;
    const issued: Array<{ id: string; key: string; consumed: boolean; revoked: boolean; generation: number }> = [];

    await db.execute("BEGIN IMMEDIATE");
    try {
      if (strategy === "replace") {
        targetGeneration = currentGeneration + 1;
        const now = new Date().toISOString();

        await db.execute({
          sql: "UPDATE main_keys SET current_generation = ? WHERE id = ?",
          args: [targetGeneration, mainId],
        });

        const revokeResult = await db.execute({
          sql: `
            UPDATE sub_keys
            SET revoked_at = ?, revoked_reason = ?
            WHERE main_key_id = ?
              AND revoked_at IS NULL
              AND consumed_at IS NULL
          `,
          args: [now, reason, mainId],
        });
        revokedCount = Number(revokeResult.rowsAffected ?? 0);
      }

      for (let i = 0; i < requestedCount; i += 1) {
        const record = await insertUniqueSubKey(mainId, targetGeneration);
        issued.push({
          id: record.id,
          key: record.key,
          consumed: false,
          revoked: false,
          generation: targetGeneration,
        });
      }

      await db.execute("COMMIT");
    } catch (txError) {
      await db.execute("ROLLBACK");
      throw txError;
    }

    await writeAuditEvent({
      eventType: strategy === "replace" ? "revoke" : "issue",
      outcome: "ok",
      mainKeyId: mainId,
      actor,
      meta: {
        strategy,
        requestedCount,
        issuedCount: issued.length,
        revokedCount,
        generation: targetGeneration,
      },
    });

    return Response.json({
      mainId,
      strategy,
      currentGeneration: targetGeneration,
      issuedCount: issued.length,
      revokedCount,
      issued,
    });
  } catch (error) {
    try {
      const { mainId } = await params;
      if (mainId) {
        await writeAuditEvent({
          eventType: "issue",
          outcome: "error",
          mainKeyId: mainId,
          actor,
          meta: {
            message: error instanceof Error ? error.message : "Failed to issue sub keys",
          },
        });
      }
    } catch {
      // Do not mask the main error path because of audit logging failure.
    }
    const message = error instanceof Error ? error.message : "Failed to issue sub keys";
    return Response.json({ error: "invalid", message }, { status: 500 });
  }
}
