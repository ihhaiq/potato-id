import { api } from 'sdk';
import { getConfig } from 'lib/config';

export async function welcomeKeyboard(config = null) {
  const resolved = config || await getConfig();
  const button = resolved?.welcome_button;
  if (!button?.text || !button?.url) return undefined;
  return {
    inline_keyboard: [[{
      text: button.text,
      url: button.url,
    }]],
  };
}

export async function sendWelcome(message) {
  if (!message?.chat?.id) return null;
  const config = await getConfig();
  return api.sendMessage({
    chat_id: message.chat.id,
    text: config.texts.welcome,
    reply_markup: await welcomeKeyboard(config),
  });
}
