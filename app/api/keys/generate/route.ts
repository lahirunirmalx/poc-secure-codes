import { randomUUID } from "crypto";
import { ensureSchema, getDbClient } from "@/lib/db";
import { createMainKeyPair, createSubKey } from "@/lib/keys";

async function insertUniqueMainKey(
  mainId: string
): Promise<{ longKey: string; shortKey: string }> {
  const db = getDbClient();
  for (let tries = 0; tries < 30; tries += 1) {
    const { longKey, shortKey } = createMainKeyPair();
    try {
      await db.execute({
        sql: "INSERT INTO main_keys (id, public_key, short_key) VALUES (?, ?, ?)",
        args: [mainId, longKey, shortKey],
      });
      return { longKey, shortKey };
    } catch {
      // Retry on possible unique collision.
    }
  }
  throw new Error("Failed to allocate unique main key pair");
}

async function insertUniqueSubKey(
  mainId: string,
  subId: string,
  generation: number
): Promise<string> {
  const db = getDbClient();
  for (let tries = 0; tries < 30; tries += 1) {
    const subKey = createSubKey();
    try {
      await db.execute({
        sql: "INSERT INTO sub_keys (id, main_key_id, public_key, generation) VALUES (?, ?, ?, ?)",
        args: [subId, mainId, subKey, generation],
      });
      return subKey;
    } catch {
      // Retry on possible unique collision.
    }
  }
  throw new Error("Failed to allocate unique 6-digit sub key");
}

export async function POST(): Promise<Response> {
  try {
    await ensureSchema();

    const mainId = randomUUID();
    const mainKeyPair = await insertUniqueMainKey(mainId);

    const subKeys: Array<{ id: string; key: string; consumed: boolean; revoked: boolean }> = [];
    const generation = 1;
    for (let i = 0; i < 10; i += 1) {
      const subId = randomUUID();
      const subKey = await insertUniqueSubKey(mainId, subId, generation);
      subKeys.push({ id: subId, key: subKey, consumed: false, revoked: false });
    }

    return Response.json(
      {
        main: { id: mainId, longKey: mainKeyPair.longKey, shortKey: mainKeyPair.shortKey },
        subKeys,
      },
      { status: 201 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate keys";
    return Response.json({ error: message }, { status: 500 });
  }
}
