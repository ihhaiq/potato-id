import { api } from 'sdk';
import { commandMatchesAlias } from 'lib/config';
import { sendRichProfile } from 'lib/profile';
import { claimUpdate, allowMessageRequest, releaseUpdate } from 'lib/request-guard';
import { sendWelcome } from 'lib/welcome';

function commandName(text) {
  if (typeof text !== 'string') return '';
  const first = text.trim().split(/\s+/, 1)[0].toLocaleLowerCase();
  if (!first.startsWith('/')) return '';
  return first.split('@', 1)[0];
}

function matchesCommand(text, command) {
  return commandName(text) === '/' + command;
}

async function matchesCommandOrAlias(text, command) {
  if (matchesCommand(text, command)) return true;
  return commandMatchesAlias(text, command);
}

async function sendMyId(message) {
  const userId = Number(message?.from?.id);
  if (!Number.isSafeInteger(userId) || !message?.chat?.id) return;
  await api.sendMessage({
    chat_id: message.chat.id,
    text: ' \`' + userId + '\`',
    parse_mode: 'Markdown',
  });
}

async function sendProfile(message) {
  if (!message?.chat?.id || !message?.from?.id) return;
  await sendRichProfile(message.chat.id, message.from, {
    contextChatUsername: message.chat.username || null,
    contextMessageId: message.message_id || null,
  });
}

export default async function (message, ctx = {}) {
  const updateId = ctx?.update?.update_id;
  if (!await claimUpdate(updateId)) return;

  try {
    if (!await allowMessageRequest(message)) return;

    const text = message?.text;
    if (matchesCommand(text, 'myid')) {
      await sendMyId(message);
      return;
    }

    if (await matchesCommandOrAlias(text, 'start')) {
      await sendWelcome(message);
      return;
    }

    if (await matchesCommandOrAlias(text, 'id')) {
      await sendProfile(message);
      return;
    }

    // Phase 2/3 intentionally leaves /top, /secret, /mybot, /admin,
    // Guest Mode and the external-bot continuation to their later migration
    // phases. Unknown ordinary messages stay silent, matching main.
  } catch (error) {
    await releaseUpdate(updateId);
    console.error('message handler failed', error);
    throw error;
  }
}
