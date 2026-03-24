import { ensureSchema, getDbClient } from "@/lib/db";

interface Params {
  params: Promise<{ mainId: string }>;
}

export async function GET(_request: Request, { params }: Params): Promise<Response> {
  try {
    await ensureSchema();
    const { mainId } = await params;
    if (!mainId) {
      return Response.json({ error: "invalid", message: "mainId is required" }, { status: 400 });
    }

    const db = getDbClient();

    const mainResult = await db.execute({
      sql: "SELECT id, short_key FROM main_keys WHERE id = ?",
      args: [mainId],
    });
    if (mainResult.rows.length === 0) {
      return Response.json({ error: "not_found", message: "Main key not found" }, { status: 404 });
    }

    const subResult = await db.execute({
      sql: `
        SELECT id, public_key, consumed_at, consumed_via, created_at, revoked_at, revoked_reason, generation
        FROM sub_keys
        WHERE main_key_id = ?
        ORDER BY created_at ASC
      `,
      args: [mainId],
    });

    return Response.json({
      mainId,
      mainShortKey: mainResult.rows[0].short_key
        ? String(mainResult.rows[0].short_key)
        : null,
      subKeys: subResult.rows.map((row) => ({
        id: String(row.id),
        key: String(row.public_key),
        consumed: Boolean(row.consumed_at),
        consumedAt: row.consumed_at ? String(row.consumed_at) : null,
        consumedVia: row.consumed_via ? String(row.consumed_via) : null,
        revoked: Boolean(row.revoked_at),
        revokedAt: row.revoked_at ? String(row.revoked_at) : null,
        revokedReason: row.revoked_reason ? String(row.revoked_reason) : null,
        generation: Number(row.generation),
      })),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch sub keys";
    return Response.json({ error: "invalid", message }, { status: 500 });
  }
}
