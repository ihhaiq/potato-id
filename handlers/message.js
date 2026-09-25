import { api } from 'sdk';
import { commandMatchesAlias } from 'lib/config';
import {
  handleExternalBotMessage,
  sendProfileWithExternalLookup,
} from 'lib/external-bot';
import { sendMyBot } from 'lib/managed-bots';
import { claimUpdate, allowMessageRequest, releaseUpdate } from 'lib/request-guard';
import { sendSecretPrompt } from 'lib/secret';
import { sendTopUsers } from 'lib/top';
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

export default async function (message, ctx = {}) {
  const updateId = ctx?.update?.update_id;
  if (!await claimUpdate(updateId)) return;

  try {
    if (!await allowMessageRequest(message)) return;

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

    if (matchesCommand(text, 'mybot')) {
      await sendMyBot(message);
      return;
    }

    // /admin and its pending input states are ported in a later phase.
    // Unknown ordinary messages stay silent, matching main.
  } catch (error) {
    await releaseUpdate(updateId);
    console.error('message handler failed', error);
    throw error;
  }
}
