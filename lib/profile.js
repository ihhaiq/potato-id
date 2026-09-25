import { api, BotApiError } from 'sdk';
import { heartCountFor } from 'lib/hearts';
import { fullName, recordUsage } from 'lib/usage';

const DEV_BUTTON_TEXT = 'Huge Dev';
const DEV_BUTTON_URL = 'https://t.me/ihhai';
const PROFILE_PHOTO_LIMIT = 50;
const PHOTOS_FORBIDDEN_HEADING = '⚠️ المجموعة مقيدة من إرسال الصور';

function descriptionOf(error) {
  return String(error?.description || error?.message || error || '');
}

function isPhotosForbiddenError(error) {
  return descriptionOf(error).includes('CHAT_SEND_PHOTOS_FORBIDDEN');
}

function isPhotoInvalidError(error) {
  return descriptionOf(error).includes('RICH_MESSAGE_PHOTO_INVALID');
}

function isRecoverablePhotoError(error) {
  return isPhotosForbiddenError(error) || isPhotoInvalidError(error);
}

function fallbackHeadingFor(error) {
  return isPhotosForbiddenError(error)
    ? PHOTOS_FORBIDDEN_HEADING
    : '⚠️ تعذر تحميل صورة البروفايل، جرب مرة ثانية بعدين';
}

function bestPhotoFileId(photoSizes) {
  if (!Array.isArray(photoSizes) || photoSizes.length === 0) return null;
  const best = photoSizes[photoSizes.length - 1];
  return best?.file_id ? String(best.file_id) : null;
}

export function buildMessageLink(chatId, chatUsername, messageId) {
  if (!chatId || !messageId) return null;
  if (chatUsername) return 'https://t.me/' + chatUsername + '/' + messageId;

  let cid = String(chatId);
  if (cid.startsWith('-100')) cid = cid.slice(4);
  else if (cid.startsWith('-')) cid = cid.slice(1);
  return 'https://t.me/c/' + cid + '/' + messageId;
}

export function buildErrorContextFooter(
  chatId,
  chatUsername,
  messageId,
  user,
) {
  const parts = [];
  const link = buildMessageLink(chatId, chatUsername, messageId);
  if (link) parts.push('🔗 الرسالة الأصلية: ' + link);
  const who = user?.username ? '@' + user.username : 'ID ' + (user?.id ?? '؟');
  parts.push('👤 المستخدم: ' + who);
  return parts.join('\n');
}

export async function profileKeyboard(targetUserId) {
  const count = await heartCountFor(targetUserId);
  return {
    inline_keyboard: [[
      {
        text: DEV_BUTTON_TEXT,
        url: DEV_BUTTON_URL,
      },
      {
        text: '❤️ ' + count,
        callback_data: 'heart_like:' + targetUserId,
      },
    ]],
  };
}

export async function buildProfileRichMessage(
  user,
  {
    externalField = null,
    includePhotos = true,
    warningHeading = null,
    extraFooterText = null,
  } = {},
) {
  const userId = Number(user?.id);
  if (!Number.isSafeInteger(userId)) {
    throw new Error('Profile user id is missing or invalid');
  }

  const photos = await api.getUserProfilePhotos({
    user_id: userId,
    limit: includePhotos ? PROFILE_PHOTO_LIMIT : 1,
  });

  const name = fullName(user);
  const isPremium = Boolean(user?.is_premium);
  const totalCount = Number(photos?.total_count || 0);

  const infoText = [
    '🆔 ID: ',
    { type: 'code', text: String(userId) },
    '\n',
    '👤 Mention: ',
    { type: 'text_mention', text: name, user },
    '\n',
    '🔗 userName: @' + (user?.username || 'بدون يوزر') + '\n',
    '💎 Premium: ' + (isPremium ? '✅ نعم' : '❌ لا') + '\n',
    '🔢 TotAl pfp: ' + totalCount
      + (externalField ? '\n💬 ' + externalField[0] + ': ' + externalField[1] : ''),
  ];

  const headingText = warningHeading
    || (totalCount === 0 ? 'YOU DONT HAVE ONE !.' : '📸 ' + name + ' pfp ');

  const blocks = [
    {
      type: 'heading',
      text: headingText,
      size: 2,
    },
    {
      type: 'details',
      summary: 'user info',
      blocks: [{
        type: 'paragraph',
        text: infoText,
      }],
    },
  ];

  if (includePhotos && Array.isArray(photos?.photos) && photos.photos.length > 0) {
    const photoBlocks = photos.photos
      .map(bestPhotoFileId)
      .filter(Boolean)
      .map((fileId) => ({
        type: 'photo',
        photo: {
          type: 'photo',
          media: fileId,
        },
      }));

    if (photoBlocks.length > 0) {
      blocks.push({
        type: 'slideshow',
        blocks: photoBlocks,
      });
    }
  }

  if (extraFooterText) {
    blocks.push({
      type: 'paragraph',
      text: String(extraFooterText),
    });
  }

  return { blocks };
}

export async function sendRichProfile(
  chatId,
  user,
  {
    externalField = null,
    contextChatUsername = null,
    contextMessageId = null,
  } = {},
) {
  await recordUsage(user);

  const replyMarkup = await profileKeyboard(user.id);
  const richMessage = await buildProfileRichMessage(user, { externalField });

  try {
    return await api.sendRichMessage({
      chat_id: chatId,
      rich_message: richMessage,
      reply_markup: replyMarkup,
    });
  } catch (error) {
    if (!(error instanceof BotApiError) || !isRecoverablePhotoError(error)) {
      throw error;
    }

    const footer = buildErrorContextFooter(
      chatId,
      contextChatUsername,
      contextMessageId,
      user,
    );
    const fallback = await buildProfileRichMessage(user, {
      externalField,
      includePhotos: false,
      warningHeading: fallbackHeadingFor(error),
      extraFooterText: footer,
    });

    return api.sendRichMessage({
      chat_id: chatId,
      rich_message: fallback,
      reply_markup: replyMarkup,
    });
  }
}


export async function answerGuestProfile(
  guestQueryId,
  user,
  {
    contextChatId = null,
    contextChatUsername = null,
    contextMessageId = null,
  } = {},
) {
  await recordUsage(user);
  const replyMarkup = await profileKeyboard(user.id);
  const richMessage = await buildProfileRichMessage(user);

  try {
    return await api.answerGuestQuery({
      guest_query_id: guestQueryId,
      result: {
        type: 'article',
        id: 'guest_reply',
        title: 'رد البوت',
        input_message_content: {
          rich_message: richMessage,
        },
        reply_markup: replyMarkup,
      },
    });
  } catch (error) {
    if (!(error instanceof BotApiError) || !isRecoverablePhotoError(error)) {
      throw error;
    }

    const footer = buildErrorContextFooter(
      contextChatId,
      contextChatUsername,
      contextMessageId,
      user,
    );
    const fallback = await buildProfileRichMessage(user, {
      includePhotos: false,
      warningHeading: fallbackHeadingFor(error),
      extraFooterText: footer,
    });

    return api.answerGuestQuery({
      guest_query_id: guestQueryId,
      result: {
        type: 'article',
        id: 'guest_reply',
        title: 'رد البوت',
        input_message_content: {
          rich_message: fallback,
        },
        reply_markup: replyMarkup,
      },
    });
  }
}

export async function editRichProfile(
  chatId,
  messageId,
  user,
  externalField,
  {
    contextChatUsername = null,
    contextMessageId = null,
  } = {},
) {
  const replyMarkup = await profileKeyboard(user.id);
  const richMessage = await buildProfileRichMessage(user, { externalField });

  try {
    return await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      rich_message: richMessage,
      reply_markup: replyMarkup,
    });
  } catch (error) {
    if (!(error instanceof BotApiError) || !isRecoverablePhotoError(error)) {
      throw error;
    }

    const footer = buildErrorContextFooter(
      chatId,
      contextChatUsername,
      contextMessageId,
      user,
    );
    const fallback = await buildProfileRichMessage(user, {
      externalField,
      includePhotos: false,
      warningHeading: fallbackHeadingFor(error),
      extraFooterText: footer,
    });

    return api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      rich_message: fallback,
      reply_markup: replyMarkup,
    });
  }
}

export const PROFILE_LIMITS = Object.freeze({
  profilePhotos: PROFILE_PHOTO_LIMIT,
});
