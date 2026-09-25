import { db } from 'sdk';
import { eq, sql } from 'sdk/db';
import { usageUsers } from 'schema';
import { isDeveloper } from 'lib/developer-access';

export const DEV_USAGE_BOOST = 2006;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function cleanText(value, max) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

export function fullName(user) {
  const joined = [user?.first_name, user?.last_name]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim())
    .join(' ');
  return joined || cleanText(user?.first_name, 128) || 'مستخدم';
}

export async function recordUsage(user) {
  const userId = Number(user?.id);
  if (!Number.isSafeInteger(userId)) return;

  const stamp = nowSeconds();
  const name = fullName(user);
  const username = cleanText(user?.username, 64);

  await db.insert(usageUsers).values({
    userId,
    fullName: name,
    username,
    count: 1,
    updatedAt: stamp,
  }).onConflictDoUpdate({
    target: usageUsers.userId,
    set: {
      fullName: name,
      username,
      count: sql`${usageUsers.count} + 1`,
      updatedAt: stamp,
    },
  }).run();
}

export async function usageCountFor(userId) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id)) return 0;
  const row = await db.select({ count: usageUsers.count })
    .from(usageUsers)
    .where(eq(usageUsers.userId, id))
    .get();
  return Number(row?.count || 0) + (isDeveloper(id) ? DEV_USAGE_BOOST : 0);
}
