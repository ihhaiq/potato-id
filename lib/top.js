import { api, db } from 'sdk';
import { desc } from 'sdk/db';
import { heartTargets, usageUsers } from 'schema';
import { DEV_HEARTS_BOOST, heartCountFor } from 'lib/hearts';
import { DEV_USAGE_BOOST } from 'lib/usage';
import { isDeveloper } from 'lib/developer-access';

export const TOP_LIST_LIMIT = 56;

function mentionLine(userId, name, emoji, count) {
  const safeName = String(name || 'مستخدم');
  return [
    {
      type: 'text_mention',
      text: safeName,
      user: {
        id: Number(userId),
        is_bot: false,
        first_name: safeName,
      },
    },
    ' — ID: ' + userId + ' — ' + emoji + ' ',
    { type: 'marked', text: String(count) },
    '\n',
  ];
}

export function topKeyboard() {
  return {
    inline_keyboard: [[{
      text: '🔄 تحديث',
      callback_data: 'top_refresh',
    }]],
  };
}

async function usageRows() {
  const rows = await db.select().from(usageUsers)
    .orderBy(desc(usageUsers.count))
    .all();

  return rows
    .map((row) => ({
      userId: Number(row.userId),
      name: row.fullName || 'مستخدم',
      username: row.username ?? null,
      count: Number(row.count || 0)
        + (isDeveloper(row.userId) ? DEV_USAGE_BOOST : 0),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_LIST_LIMIT);
}

async function heartRows() {
  const targets = await db.select().from(heartTargets).all();
  const rows = [];
  for (const target of targets) {
    const userId = Number(target.targetUserId);
    rows.push({
      userId,
      count: await heartCountFor(userId),
    });
  }
  return rows
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_LIST_LIMIT);
}

export async function buildTopUsersRichMessage() {
  const [usage, hearts, knownUsers] = await Promise.all([
    usageRows(),
    heartRows(),
    db.select().from(usageUsers).all(),
  ]);

  const names = new Map(
    knownUsers.map((row) => [Number(row.userId), row.fullName || 'مستخدم']),
  );

  const usageLines = [];
  if (usage.length) {
    for (const row of usage) {
      usageLines.push(...mentionLine(row.userId, row.name, '🔢', row.count));
    }
  } else {
    usageLines.push('ماكو بيانات لهسه.');
  }

  const likesLines = [];
  if (hearts.length) {
    for (const row of hearts) {
      likesLines.push(
        ...mentionLine(
          row.userId,
          names.get(row.userId) || 'مستخدم',
          '❤️',
          row.count,
        ),
      );
    }
  } else {
    likesLines.push('ماكو بيانات لهسه.');
  }

  return {
    blocks: [
      {
        type: 'heading',
        text: '🏆 Top Users',
        size: 2,
      },
      {
        type: 'details',
        summary: 'الأكثر استخدام للبوت',
        blocks: [{
          type: 'paragraph',
          text: usageLines,
        }],
      },
      {
        type: 'details',
        summary: 'الأكثر حصولاً على لايكات ❤️',
        blocks: [{
          type: 'paragraph',
          text: likesLines,
        }],
      },
    ],
  };
}

export async function sendTopUsers(chatId) {
  return api.sendRichMessage({
    chat_id: chatId,
    rich_message: await buildTopUsersRichMessage(),
    reply_markup: topKeyboard(),
  });
}
