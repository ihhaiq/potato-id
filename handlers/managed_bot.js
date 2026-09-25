import { registerManagedBot } from 'lib/managed-bots';
import { reportHandlerError } from 'lib/errors';
import { claimUpdate, releaseUpdate } from 'lib/request-guard';

export default async function (managedBotUpdated, ctx = {}) {
  const updateId = ctx?.update?.update_id;
  if (!await claimUpdate(updateId)) return;

  try {
    await registerManagedBot(managedBotUpdated);
  } catch (error) {
    await releaseUpdate(updateId);
    await reportHandlerError('managed_bot', error, ctx, managedBotUpdated);
    throw error;
  }
}
