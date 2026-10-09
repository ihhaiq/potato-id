import { api } from 'sdk';
import { reportHandlerError } from '../lib/errors.js';
import { handleAdminMessage } from '../lib/admin.js';
import { commandMatchesAlias } from '../lib/config.js';
import {
  handleExternalBotMessage,
  sendProfileWithExternalLookup,
} from '../lib/external-bot.js';
import { sendMyBot, registerManagedBot, checkManagedBotToken } from '../lib/managed-bots.js';
import { claimUpdate, allowMessageRequest, releaseUpdate } from '../lib/request-guard.js';
import { sendSecretPrompt } from '../lib/secret.js';
import { sendTopUsers } from '../lib/top.js';
import { sendWelcome } from '../lib/welcome.js';

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

export default async function (message, ctx = {}) {
  const updateId = ctx?.update?.update_id;
  if (!await claimUpdate(updateId)) return;

  try {
    if (!await allowMessageRequest(message)) return;

    // A creation service message can arrive independently of managed_bot updates.
    if (message?.managed_bot_created?.bot) {
      console.log('managed_bot_created received', { botId: message.managed_bot_created.bot.id, ownerId: message.from?.id });
      await registerManagedBot({ user: message.from, bot: message.managed_bot_created.bot });
      return;
    }

    if (await handleAdminMessage(message)) return;

    // Bot-to-Bot replies are handled before user command routing. Any other bot
    // message stays silent, matching the Python handler ordering.
    if (message?.from?.is_bot) {
      await handleExternalBotMessage(message);
      return;
    }

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
      await sendProfileWithExternalLookup(message);
      return;
    }

    if (await matchesCommandOrAlias(text, 'top')) {
      if (message?.chat?.id) await sendTopUsers(message.chat.id);
      return;
    }

    if (await matchesCommandOrAlias(text, 'secret')) {
      await sendSecretPrompt(message);
      return;
    }

    if (matchesCommand(text, 'childcheck')) {
      await checkManagedBotToken(message);
      return;
    }

    if (matchesCommand(text, 'mybot')) {
      await sendMyBot(message);
      return;
    }

    // Unknown ordinary messages stay silent, matching main.
  } catch (error) {
    await releaseUpdate(updateId);
    await reportHandlerError('message', error, ctx, message);
    throw error;
  }
}
