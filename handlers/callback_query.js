import { api, BotApiError } from 'sdk';
import { reportHandlerError } from 'lib/errors';
import { handleAdminCallback } from 'lib/admin';
import { profileKeyboard } from 'lib/profile';
import { toggleHeart } from 'lib/hearts';
import { sendSecretForCallback } from 'lib/secret';
import { buildTopUsersRichMessage, topKeyboard } from 'lib/top';
import {
  allowCallbackRequest,
  claimUpdate,
  releaseUpdate,
} from 'lib/request-guard';

function descriptionOf(error) {
  return String(error?.description || error?.message || error || '').toLocaleLowerCase();
}

function isNotModified(error) {
  return error instanceof BotApiError
    && descriptionOf(error).includes('message is not modified');
}

async function handleHeart(query) {
  const raw = String(query?.data || '').slice('heart_like:'.length);
  const targetId = Number(raw);
  if (!Number.isSafeInteger(targetId)) {
    await api.answerCallbackQuery({ callback_query_id: query.id });
    return true;
  }

  const result = await toggleHeart(targetId, query?.from?.id);
  const replyMarkup = await profileKeyboard(targetId);

  try {
    if (query?.inline_message_id) {
      await api.editMessageReplyMarkup({
        inline_message_id: query.inline_message_id,
        reply_markup: replyMarkup,
      });
    } else if (query?.message?.chat?.id && query?.message?.message_id) {
      await api.editMessageReplyMarkup({
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        reply_markup: replyMarkup,
      });
    }
  } catch (error) {
    if (!isNotModified(error)) {
      console.warn('Could not refresh heart keyboard', error);
    }
  }

  await api.answerCallbackQuery({
    callback_query_id: query.id,
    text: result.voted ? '❤️ شكراً على تصويتك!' : '💔 تم إلغاء تصويتك',
  });
  return true;
}

async function handleTopRefresh(query) {
  const richMessage = await buildTopUsersRichMessage();

  try {
    if (query?.inline_message_id) {
      await api.editMessageText({
        inline_message_id: query.inline_message_id,
        rich_message: richMessage,
        reply_markup: topKeyboard(),
      });
    } else if (query?.message?.chat?.id && query?.message?.message_id) {
      await api.editMessageText({
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        rich_message: richMessage,
        reply_markup: topKeyboard(),
      });
    }
  } catch (error) {
    if (!isNotModified(error)) throw error;
  }

  await api.answerCallbackQuery({
    callback_query_id: query.id,
    text: '🔄 تم التحديث',
  });
  return true;
}

export default async function (query, ctx = {}) {
  const updateId = ctx?.update?.update_id;
  if (!await claimUpdate(updateId)) return;

  try {
    if (!query?.id) return;

    if (!await allowCallbackRequest(query)) {
      await api.answerCallbackQuery({
        callback_query_id: query.id,
        text: '⏳ روّق شوي وجرب مرة ثانية',
        show_alert: false,
      });
      return;
    }

    const data = String(query?.data || '');

    if (await handleAdminCallback(query)) return;

    if (data === 'show_secret') {
      await sendSecretForCallback(query);
      return;
    }

    if (data.startsWith('heart_like:')) {
      await handleHeart(query);
      return;
    }

    if (data === 'top_refresh') {
      await handleTopRefresh(query);
      return;
    }

    await api.answerCallbackQuery({ callback_query_id: query.id });
  } catch (error) {
    await releaseUpdate(updateId);
    await reportHandlerError('callback_query', error, ctx, query);
    throw error;
  }
}
