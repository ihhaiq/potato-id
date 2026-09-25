import { db } from 'sdk';
import { and, eq, lt } from 'sdk/db';
import { processedUpdates, requestWindows } from 'schema';

const IDEMPOTENCY_TTL_SECONDS = 15 * 60;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function nowMilliseconds() {
  return Date.now();
}

function safeUpdateId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export async function claimUpdate(updateId) {
  const id = safeUpdateId(updateId);
  if (id == null) return true;

  const stamp = nowSeconds();
  await db.delete(processedUpdates)
    .where(lt(processedUpdates.expiresAt, stamp))
    .run();

  const inserted = await db.insert(processedUpdates).values({
    updateId: id,
    expiresAt: stamp + IDEMPOTENCY_TTL_SECONDS,
  }).onConflictDoNothing({
    target: processedUpdates.updateId,
  }).returning({
    updateId: processedUpdates.updateId,
  }).run();

  return Array.isArray(inserted) && inserted.length > 0;
}

export async function releaseUpdate(updateId) {
  const id = safeUpdateId(updateId);
  if (id == null) return;
  await db.delete(processedUpdates)
    .where(eq(processedUpdates.updateId, id))
    .run();
}

export async function allowSlidingWindow(key, limit, windowMs) {
  const safeLimit = Math.max(1, Number(limit) || 1);
  const safeWindowMs = Math.max(1, Number(windowMs) || 1000);
  const now = nowMilliseconds();
  const cutoff = now - safeWindowMs;
  const expiresAt = Math.floor((now + safeWindowMs) / 1000) + 1;

  await db.delete(requestWindows)
    .where(lt(requestWindows.expiresAt, nowSeconds()))
    .run();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const row = await db.select().from(requestWindows)
      .where(eq(requestWindows.key, key))
      .get();

    if (!row) {
      const inserted = await db.insert(requestWindows).values({
        key,
        timestamps: [now],
        version: 1,
        expiresAt,
      }).onConflictDoNothing({
        target: requestWindows.key,
      }).returning({
        key: requestWindows.key,
      }).run();
      if (Array.isArray(inserted) && inserted.length > 0) return true;
      continue;
    }

    const oldTimestamps = Array.isArray(row.timestamps) ? row.timestamps : [];
    const active = oldTimestamps
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > cutoff)
      .sort((a, b) => a - b);

    if (active.length >= safeLimit) {
      return false;
    }

    const version = Number(row.version || 0);
    const updated = await db.update(requestWindows).set({
      timestamps: [...active, now],
      version: version + 1,
      expiresAt,
    }).where(and(
      eq(requestWindows.key, key),
      eq(requestWindows.version, version),
    )).returning({
      key: requestWindows.key,
    }).run();

    if (Array.isArray(updated) && updated.length > 0) return true;
  }

  return false;
}

export async function allowMessageRequest(message) {
  const userId = Number(message?.from?.id);
  if (!Number.isSafeInteger(userId)) return true;
  // Python main applies 1.0 second throttling to every message.
  return allowSlidingWindow('message:' + userId, 1, 1000);
}

export async function allowCallbackRequest(query) {
  const userId = Number(query?.from?.id);
  if (!Number.isSafeInteger(userId)) return true;
  // Python main applies 0.5 second throttling to every callback query.
  return allowSlidingWindow('callback:' + userId, 1, 500);
}
