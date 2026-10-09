import { registerManagedBot } from '../lib/managed-bots.js';
import { reportHandlerError } from '../lib/errors.js';
import { claimUpdate, releaseUpdate } from '../lib/request-guard.js';

export default async function (managedBotUpdated, ctx = {}) {
  const updateId = ctx?.update?.update_id;
  if (!await claimUpdate(updateId)) return;

  try {
    console.log('managed_bot update received', {
      botId: managedBotUpdated?.bot?.id,
      ownerId: managedBotUpdated?.user?.id,
    });
    await registerManagedBot(managedBotUpdated);
  } catch (error) {
    await releaseUpdate(updateId);
    await reportHandlerError('managed_bot', error, ctx, managedBotUpdated);
    throw error;
  }
}
