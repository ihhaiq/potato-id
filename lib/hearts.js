import { db } from 'sdk';
import { eq } from 'sdk/db';
import { heartTargets, heartVotes } from 'schema';
import { isDeveloper } from 'lib/developer-access';

export const DEV_HEARTS_BOOST = 106;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function safeId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function voteKey(targetUserId, voterUserId) {
  return String(targetUserId) + ':' + String(voterUserId);
}

export async function heartCountFor(targetUserId) {
  const target = safeId(targetUserId);
  if (target == null) return 0;
  const persisted = await db.$count(
    heartVotes,
    eq(heartVotes.targetUserId, target),
  );
  return Number(persisted || 0) + (isDeveloper(target) ? DEV_HEARTS_BOOST : 0);
}

export async function hasHeartVote(targetUserId, voterUserId) {
  const target = safeId(targetUserId);
  const voter = safeId(voterUserId);
  if (target == null || voter == null) return false;
  const row = await db.select({ key: heartVotes.key })
    .from(heartVotes)
    .where(eq(heartVotes.key, voteKey(target, voter)))
    .get();
  return Boolean(row);
}

export async function toggleHeart(targetUserId, voterUserId) {
  const target = safeId(targetUserId);
  const voter = safeId(voterUserId);
  if (target == null || voter == null) {
    return { count: target == null ? 0 : await heartCountFor(target), voted: false };
  }

  await db.insert(heartTargets).values({
    targetUserId: target,
    createdAt: nowSeconds(),
  }).onConflictDoNothing({ target: heartTargets.targetUserId }).run();

  const key = voteKey(target, voter);
  const inserted = await db.insert(heartVotes).values({
    key,
    targetUserId: target,
    voterUserId: voter,
    createdAt: nowSeconds(),
  }).onConflictDoNothing({
    target: heartVotes.key,
  }).returning({
    key: heartVotes.key,
  }).run();

  let voted = Array.isArray(inserted) && inserted.length > 0;
  if (!voted) {
    await db.delete(heartVotes)
      .where(eq(heartVotes.key, key))
      .run();
  }

  return {
    count: await heartCountFor(target),
    voted,
  };
}
