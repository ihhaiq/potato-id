import { api } from 'sdk';
import { reportHandlerError } from 'lib/errors';
import { commandMatchesAlias } from 'lib/config';
import { answerGuestProfile } from 'lib/profile';
import { buildTopUsersRichMessage, topKeyboard } from 'lib/top';
import { claimUpdate, releaseUpdate } from 'lib/request-guard';

async function botUsername() {
  const me = await api.getMe();
  return String(me?.username || '').trim();
}

function containsExplicitMention(text, username) {
  if (!text || !username) return false;
  return String(text).toLocaleLowerCase().includes('@' + username.toLocaleLowerCase());
}

function textAfterMention(text, username) {
  const source = String(text || '');
  const target = '@' + String(username || '');
  const lower = source.toLocaleLowerCase();
  const idx = lower.indexOf(target.toLocaleLowerCase());
  const withoutMention = idx >= 0
    ? source.slice(0, idx) + source.slice(idx + target.length)
    : source;
  return withoutMention.replaceAll('،،', '').trim();
}

async function answerGuestTop(guestQueryId) {
  return api.answerGuestQuery({
    guest_query_id: guestQueryId,
    result: {
      type: 'article',
      id: 'guest_top_reply',
      title: 'Top Users',
      input_message_content: {
        rich_message: await buildTopUsersRichMessage(),
      },
      reply_markup: topKeyboard(),
    },
  });
}

export default async function (message, ctx = {}) {
  const updateId = ctx?.update?.update_id;
  if (!await claimUpdate(updateId)) return;

  try {
    if (!message?.guest_query_id) return;

    const username = await botUsername();
    const text = String(message?.text || '');
    if (!containsExplicitMention(text, username)) return;

    const remaining = textAfterMention(text, username);
    if (await commandMatchesAlias(remaining, 'top')) {
      await answerGuestTop(message.guest_query_id);
      return;
    }

    const caller = message?.reply_to_message?.from && text.includes('،،')
      ? message.reply_to_message.from
      : (message?.guest_bot_caller_user || message?.from);

    if (!caller?.id) return;

    await answerGuestProfile(message.guest_query_id, caller, {
      contextChatId: message?.chat?.id || null,
      contextChatUsername: message?.chat?.username || null,
      contextMessageId: message?.message_id || null,
    });
  } catch (error) {
    await releaseUpdate(updateId);
    await reportHandlerError('guest_message', error, ctx, message);
    throw error;
  }
}
