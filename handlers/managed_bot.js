import { registerManagedBot } from 'lib/managed-bots';
import { claimUpdate, releaseUpdate } from 'lib/request-guard';

export default async function (managedBotUpdated, ctx = {}) {
  const updateId = ctx?.update?.update_id;
  if (!await claimUpdate(updateId)) return;

  try {
    await registerManagedBot(managedBotUpdated);
  } catch (error) {
    await releaseUpdate(updateId);
    console.error('managed_bot handler failed', error);
    throw error;
  }
}
