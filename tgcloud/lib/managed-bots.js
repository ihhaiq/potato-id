import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { managedBots } from '../schema.js';
import { fullName } from '../lib/usage.js';

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export async function findManagedBotByOwner(ownerId) {
  const id = Number(ownerId);
  if (!Number.isSafeInteger(id)) return null;
  return db.select().from(managedBots)
    .where(eq(managedBots.ownerId, id))
    .get();
}

export function generateSuggestedUsername(userId) {
  return 'pfp_' + Number(userId) + '_bot';
}

export async function sendMyBot(message) {
  const ownerId = Number(message?.from?.id);
  const chatId = Number(message?.chat?.id);
  if (!Number.isSafeInteger(ownerId) || !Number.isSafeInteger(chatId)) return null;

  const existing = await findManagedBotByOwner(ownerId);
  if (existing) {
    return api.sendMessage({
      chat_id: chatId,
      text:
        '🤖 البوت المسجّل عند المدير: @' + (existing.username || '؟') + '\n'
        + 'حالة التشغيل: ' + (existing.status || 'غير معروفة') + '\n'
        + 'التسجيل لا يعني أن استقبال رسائل البوت الفرعي مفعّل.',
    });
  }

  const me = await api.getMe();
  const managerUsername = String(me?.username || '');
  if (!managerUsername) {
    return api.sendMessage({
      chat_id: chatId,
      text: '⏳ البوت لسا يقوم بالإقلاع، جرب بعد شوي.',
    });
  }

  const suggested = generateSuggestedUsername(ownerId);
  const displayName = String(message?.from?.first_name || fullName(message.from)) + ' pfp bot';
  const url =
    'https://t.me/newbot/'
    + managerUsername
    + '/'
    + suggested
    + '?name='
    + encodeURIComponent(displayName);

  return api.sendMessage({
    chat_id: chatId,
    text:
      'اضغط الزر تحت واضغط تأكيد بشاشة تليجرام، وراح يتولد لك بوت خاص فيك '
      + 'مربوط بهذا البوت 👇',
    reply_markup: {
      inline_keyboard: [[{
        text: '🤖 أنشئ بوتك الخاص',
        url,
      }]],
    },
  });
}

export async function registerManagedBot(update) {
  const owner = update?.user;
  const botUser = update?.bot || update?.bot_user;
  const ownerId = Number(owner?.id);
  const botId = Number(botUser?.id);
  if (!Number.isSafeInteger(ownerId) || !Number.isSafeInteger(botId)) {
    throw new Error('managed_bot update is missing owner or bot id');
  }

  const existing = await db.select().from(managedBots)
    .where(eq(managedBots.botId, botId))
    .get();
  const isNew = !existing;
  const ownerChanged = Boolean(existing) && Number(existing.ownerId) !== ownerId;

  const stamp = nowSeconds();
  await db.insert(managedBots).values({
    botId,
    ownerId,
    username: botUser?.username || null,
    status: 'pending_runtime',
    createdAt: stamp,
    updatedAt: stamp,
  }).onConflictDoUpdate({
    target: managedBots.botId,
    set: {
      ownerId,
      username: botUser?.username || null,
      status: 'pending_runtime',
      updatedAt: stamp,
    },
  }).run();

  // We intentionally don't persist getManagedBotToken() output in the
  // Serverless database. The token is a secret and can be fetched again by the
  // manager when a proven child-runtime routing mechanism needs it.
  // Acknowledge every delivered lifecycle event, including duplicates/token updates.
  // This makes it possible to distinguish webhook delivery from child runtime availability.
  {
    try {
      await api.sendMessage({
        chat_id: ownerId,
        text:
          '✅ استلم المدير حدث البوت المُدار: @' + (botUser?.username || '؟') + '\n'
          + 'معرّف البوت: ' + botId + '\n'
          + 'حالة التشغيل: pending_runtime — البوت لم يُفعّل لاستقبال الرسائل بعد.',
      });
    } catch (error) {
      console.error('Could not notify managed bot owner', { ownerId, botId, message: String(error?.message || error) });
    }
  }

  console.log('Managed bot registered (runtime pending)', { botId, ownerId, isNew, ownerChanged });
  return {
    botId,
    ownerId,
    username: botUser?.username || null,
    isNew,
    ownerChanged,
  };
}
