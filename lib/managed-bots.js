import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { managedBots } from 'schema';
import { fullName } from 'lib/usage';

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
        '❤️ عندك بوت خاص فيك بالفعل: @' + (existing.username || '؟') + '\n'
        + 'البوت مسجل عند المدير، لكن child updates على Telegram Serverless '
        + 'بعدها تحتاج مسار رسمي مثبت قبل تشغيل /id و/secret عليه.',
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
    status: 'active',
    createdAt: stamp,
    updatedAt: stamp,
  }).onConflictDoUpdate({
    target: managedBots.botId,
    set: {
      ownerId,
      username: botUser?.username || null,
      status: 'active',
      updatedAt: stamp,
    },
  }).run();

  // We intentionally don't persist getManagedBotToken() output in the
  // Serverless database. The token is a secret and can be fetched again by the
  // manager when a proven child-runtime routing mechanism needs it.
  if (isNew || ownerChanged) {
    try {
      await api.sendMessage({
        chat_id: ownerId,
        text:
          '✅ صار عندك بوت خاص فيك: @' + (botUser?.username || '؟') + '\n\n'
          + 'تم تسجيله عند البوت المدير. تشغيل تحديثات البوت الفرعي داخل Telegram '
          + 'Serverless يعتمد على مسار child-update رسمي؛ ما راح نشغل polling دائم '
          + 'أو نخزن التوكن كحل وهمي.',
      });
    } catch (error) {
      console.warn('Could not notify managed bot owner', error);
    }
  }

  return {
    botId,
    ownerId,
    username: botUser?.username || null,
    isNew,
    ownerChanged,
  };
}
