import { api } from 'sdk';
import { getConfig } from 'lib/config';
import { fullName } from 'lib/usage';

export function secretPromptKeyboard() {
  return {
    inline_keyboard: [[{
      text: '🤫 اضغط تشوف السر',
      callback_data: 'show_secret',
    }]],
  };
}

export async function sendSecretPrompt(message) {
  if (!message?.chat?.id) return null;

  if (String(message.chat.type || '') === 'private') {
    return api.sendMessage({
      chat_id: message.chat.id,
      text: '⚠️ هذا الأمر يشتغل بس داخل الكروبات، مو بالخاص.',
    });
  }

  return api.sendMessage({
    chat_id: message.chat.id,
    text: 'بالأسفل زر — بس اللي يضغطه راح يشوف رسالة سرية له وحده 👇',
    reply_markup: secretPromptKeyboard(),
  });
}

export async function sendSecretForCallback(query) {
  const chat = query?.message?.chat;
  const user = query?.from;
  if (!chat?.id || !user?.id) return false;

  if (String(chat.type || '') === 'private') {
    await api.answerCallbackQuery({
      callback_query_id: query.id,
      text: '⚠️ هذا الأمر يشتغل بس داخل الكروبات.',
      show_alert: true,
    });
    return true;
  }

  const ephemeral = {
    receiver_user_id: Number(user.id),
    callback_query_id: query.id,
  };

  const photos = await api.getUserProfilePhotos({
    user_id: Number(user.id),
    limit: 1,
  });

  if (!Number(photos?.total_count || 0) || !Array.isArray(photos?.photos) || !photos.photos.length) {
    await api.sendMessage({
      chat_id: chat.id,
      text: '🤫 هلا ' + fullName(user) + '! بس ماكو عندك صورة بروفايل أعرضها.',
      ephemeral_message_parameters: ephemeral,
    });
    await api.answerCallbackQuery({ callback_query_id: query.id });
    return true;
  }

  const sizes = photos.photos[0];
  const currentPhoto = Array.isArray(sizes) && sizes.length ? sizes[sizes.length - 1] : null;
  if (!currentPhoto?.file_id) {
    await api.sendMessage({
      chat_id: chat.id,
      text: '🤫 هلا ' + fullName(user) + '! بس ماكو عندك صورة بروفايل أعرضها.',
      ephemeral_message_parameters: ephemeral,
    });
    await api.answerCallbackQuery({ callback_query_id: query.id });
    return true;
  }

  const config = await getConfig();
  const caption = String(config.texts.secret || '').replaceAll('{name}', fullName(user));

  await api.sendPhoto({
    chat_id: chat.id,
    photo: currentPhoto.file_id,
    caption,
    ephemeral_message_parameters: ephemeral,
  });
  await api.answerCallbackQuery({ callback_query_id: query.id });
  return true;
}
