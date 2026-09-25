import { api, db } from 'sdk';
import { eq, lt } from 'sdk/db';
import { pendingExternalRequests } from 'schema';
import { getConfig } from 'lib/config';
import { editRichProfile, sendRichProfile } from 'lib/profile';
import { fullName } from 'lib/usage';

const EXTERNAL_REPLY_TTL_SECONDS = 8;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function pendingKey(chatId, commandMessageId) {
  return String(chatId) + ':' + String(commandMessageId);
}

async function cleanupExpired(stamp = nowSeconds()) {
  await db.delete(pendingExternalRequests)
    .where(lt(pendingExternalRequests.expiresAt, stamp))
    .run();
}

function pendingUser(row) {
  return {
    id: Number(row.profileUserId),
    is_bot: false,
    first_name: row.profileFullName || 'مستخدم',
    username: row.profileUsername || undefined,
    is_premium: Boolean(row.profileIsPremium),
  };
}

async function finishPending(row) {
  if (!row?.responseMessageId || !row?.externalValue) return false;

  try {
    await editRichProfile(
      row.chatId,
      row.responseMessageId,
      pendingUser(row),
      [row.externalLabel, row.externalValue],
      {
        contextChatUsername: row.contextChatUsername || null,
        contextMessageId: row.originalMessageId,
      },
    );
  } finally {
    await db.delete(pendingExternalRequests)
      .where(eq(pendingExternalRequests.key, row.key))
      .run();
  }
  return true;
}

export async function sendProfileWithExternalLookup(message) {
  const chatId = Number(message?.chat?.id);
  const userId = Number(message?.from?.id);
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(userId)) return null;

  const config = await getConfig();
  const ext = config?.external_bot || {};
  const chatType = String(message?.chat?.type || '');

  if (
    !ext.username
    || !ext.regex
    || !['group', 'supergroup'].includes(chatType)
  ) {
    return sendRichProfile(chatId, message.from, {
      contextChatUsername: message?.chat?.username || null,
      contextMessageId: message?.message_id || null,
    });
  }

  await cleanupExpired();

  let commandMessage;
  try {
    commandMessage = await api.sendMessage({
      chat_id: chatId,
      text: String(ext.command || '/info') + '@' + String(ext.username),
      reply_parameters: {
        message_id: Number(message.message_id),
      },
    });
  } catch (error) {
    console.warn('External bot command failed; sending base profile', error);
    return sendRichProfile(chatId, message.from, {
      contextChatUsername: message?.chat?.username || null,
      contextMessageId: message?.message_id || null,
    });
  }

  const commandMessageId = Number(commandMessage?.message_id);
  if (!Number.isSafeInteger(commandMessageId)) {
    return sendRichProfile(chatId, message.from, {
      contextChatUsername: message?.chat?.username || null,
      contextMessageId: message?.message_id || null,
    });
  }

  const stamp = nowSeconds();
  const key = pendingKey(chatId, commandMessageId);
  await db.insert(pendingExternalRequests).values({
    key,
    chatId,
    commandMessageId,
    requesterUserId: userId,
    profileUserId: userId,
    profileFullName: fullName(message.from),
    profileUsername: message?.from?.username || null,
    profileIsPremium: message?.from?.is_premium ? 1 : 0,
    originalMessageId: Number(message.message_id),
    contextChatUsername: message?.chat?.username || null,
    responseMessageId: null,
    externalUsername: String(ext.username),
    externalRegex: String(ext.regex),
    externalLabel: String(ext.label || 'قيمة'),
    externalValue: null,
    createdAt: stamp,
    expiresAt: stamp + EXTERNAL_REPLY_TTL_SECONDS,
  }).onConflictDoUpdate({
    target: pendingExternalRequests.key,
    set: {
      requesterUserId: userId,
      profileUserId: userId,
      profileFullName: fullName(message.from),
      profileUsername: message?.from?.username || null,
      profileIsPremium: message?.from?.is_premium ? 1 : 0,
      originalMessageId: Number(message.message_id),
      contextChatUsername: message?.chat?.username || null,
      responseMessageId: null,
      externalUsername: String(ext.username),
      externalRegex: String(ext.regex),
      externalLabel: String(ext.label || 'قيمة'),
      externalValue: null,
      createdAt: stamp,
      expiresAt: stamp + EXTERNAL_REPLY_TTL_SECONDS,
    },
  }).run();

  const sentProfile = await sendRichProfile(chatId, message.from, {
    contextChatUsername: message?.chat?.username || null,
    contextMessageId: message?.message_id || null,
  });

  const responseMessageId = Number(sentProfile?.message_id);
  if (Number.isSafeInteger(responseMessageId)) {
    await db.update(pendingExternalRequests).set({
      responseMessageId,
    }).where(eq(pendingExternalRequests.key, key)).run();

    const latest = await db.select().from(pendingExternalRequests)
      .where(eq(pendingExternalRequests.key, key))
      .get();
    if (latest?.externalValue) await finishPending(latest);
  }

  return sentProfile;
}

export async function handleExternalBotMessage(message) {
  if (!message?.from?.is_bot) return false;
  const chatId = Number(message?.chat?.id);
  const repliedId = Number(message?.reply_to_message?.message_id);
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(repliedId)) return false;

  await cleanupExpired();
  const key = pendingKey(chatId, repliedId);
  const row = await db.select().from(pendingExternalRequests)
    .where(eq(pendingExternalRequests.key, key))
    .get();
  if (!row) return false;

  const actualUsername = String(message?.from?.username || '').toLocaleLowerCase();
  const expectedUsername = String(row.externalUsername || '').toLocaleLowerCase();
  if (!actualUsername || actualUsername !== expectedUsername) return false;

  let match;
  try {
    match = new RegExp(String(row.externalRegex)).exec(
      String(message?.text || message?.caption || ''),
    );
  } catch (error) {
    console.error('Invalid external bot regex', error);
    await db.delete(pendingExternalRequests)
      .where(eq(pendingExternalRequests.key, key))
      .run();
    return true;
  }

  if (!match?.[1]) {
    await db.delete(pendingExternalRequests)
      .where(eq(pendingExternalRequests.key, key))
      .run();
    return true;
  }

  await db.update(pendingExternalRequests).set({
    externalValue: String(match[1]),
  }).where(eq(pendingExternalRequests.key, key)).run();

  const latest = await db.select().from(pendingExternalRequests)
    .where(eq(pendingExternalRequests.key, key))
    .get();

  if (latest?.responseMessageId) {
    await finishPending(latest);
  }
  return true;
}
