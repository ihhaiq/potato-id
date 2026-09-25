import { api, db } from 'sdk';
import { desc, sql } from 'sdk/db';
import { usageUsers } from 'schema';
import { DEV_HEARTS_BOOST } from 'lib/hearts';
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
  const raw = await db.all(sql.raw(
    'SELECT ht.target_user_id AS user_id, COUNT(hv.key) AS vote_count '
    + 'FROM heart_targets ht '
    + 'LEFT JOIN heart_votes hv ON hv.target_user_id = ht.target_user_id '
    + 'GROUP BY ht.target_user_id',
  ));

  return raw
    .map((row) => {
      const userId = Number(row.user_id);
      return {
        userId,
        count: Number(row.vote_count || 0)
          + (isDeveloper(userId) ? DEV_HEARTS_BOOST : 0),
      };
    })
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
