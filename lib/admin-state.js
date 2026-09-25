import { db } from 'sdk';
import { eq, lt } from 'sdk/db';
import { adminStates } from 'schema';

export const ADMIN_STATE_TTL_SECONDS = 2 * 60 * 60;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function userIdValue(userId) {
  const id = Number(userId);
  return Number.isSafeInteger(id) ? id : null;
}

export async function cleanupExpiredAdminStates(stamp = nowSeconds()) {
  await db.delete(adminStates)
    .where(lt(adminStates.expiresAt, stamp))
    .run();
}

export async function getAdminState(userId) {
  const id = userIdValue(userId);
  if (id == null) return null;

  const stamp = nowSeconds();
  const row = await db.select().from(adminStates)
    .where(eq(adminStates.userId, id))
    .get();

  if (!row) return null;
  if (Number(row.expiresAt || 0) <= stamp) {
    await db.delete(adminStates)
      .where(eq(adminStates.userId, id))
      .run();
    return null;
  }

  return {
    userId: id,
    state: String(row.state || ''),
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    updatedAt: Number(row.updatedAt || 0),
    expiresAt: Number(row.expiresAt || 0),
  };
}

export async function setAdminState(
  userId,
  state,
  payload = {},
  ttlSeconds = ADMIN_STATE_TTL_SECONDS,
) {
  const id = userIdValue(userId);
  if (id == null) return null;

  const stamp = nowSeconds();
  const expiresAt = stamp + Math.max(60, Number(ttlSeconds) || ADMIN_STATE_TTL_SECONDS);
  const safePayload = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? JSON.parse(JSON.stringify(payload))
    : {};

  await db.insert(adminStates).values({
    userId: id,
    state: String(state || ''),
    payload: safePayload,
    updatedAt: stamp,
    expiresAt,
  }).onConflictDoUpdate({
    target: adminStates.userId,
    set: {
      state: String(state || ''),
      payload: safePayload,
      updatedAt: stamp,
      expiresAt,
    },
  }).run();

  return getAdminState(id);
}

export async function updateAdminStatePayload(userId, patch = {}) {
  const current = await getAdminState(userId);
  if (!current) return null;
  const payload = {
    ...current.payload,
    ...(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}),
  };
  return setAdminState(userId, current.state, payload);
}

export async function clearAdminState(userId) {
  const id = userIdValue(userId);
  if (id == null) return;
  await db.delete(adminStates)
    .where(eq(adminStates.userId, id))
    .run();
}
