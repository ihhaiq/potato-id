import { index, integer, json, table, text, uniqueIndex } from 'sdk/db';

// Persistent state for the Telegram Serverless port.
//
// Keep this normalized where the current Python bot mutates individual records
// (likes, usage, aliases, pending requests). Unknown legacy config keys are kept
// separately so old backups can round-trip without making the runtime depend on
// one giant JSON blob.

export const botSettings = table('bot_settings', {
  id: integer('id').primaryKey(),
  welcomeText: text('welcome_text').notNull(),
  secretText: text('secret_text').notNull(),
  welcomeButtonText: text('welcome_button_text'),
  welcomeButtonUrl: text('welcome_button_url'),
  externalBotUsername: text('external_bot_username'),
  externalBotCommand: text('external_bot_command').notNull().default('/info'),
  externalBotRegex: text('external_bot_regex'),
  externalBotLabel: text('external_bot_label').notNull().default('عدد الرسائل'),
  legacyExtra: json('legacy_extra').notNull().default({}),
  updatedAt: integer('updated_at').notNull(),
});

export const commandAliases = table('command_aliases', {
  key: text('key').primaryKey(),
  command: text('command').notNull(),
  alias: text('alias').notNull(),
  normalizedAlias: text('normalized_alias').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  commandIdx: index('idx_command_aliases_command').on(t.command),
  uniqueCommandAlias: uniqueIndex('uq_command_aliases_command_alias')
    .on(t.command, t.normalizedAlias),
}));

export const heartVotes = table('heart_votes', {
  key: text('key').primaryKey(),
  targetUserId: integer('target_user_id').notNull(),
  voterUserId: integer('voter_user_id').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  targetIdx: index('idx_heart_votes_target').on(t.targetUserId),
  voterIdx: index('idx_heart_votes_voter').on(t.voterUserId),
  targetVoterUnique: uniqueIndex('uq_heart_votes_target_voter')
    .on(t.targetUserId, t.voterUserId),
}));

export const usageUsers = table('usage_users', {
  userId: integer('user_id').primaryKey(),
  fullName: text('full_name').notNull(),
  username: text('username'),
  count: integer('count').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, (t) => ({
  countIdx: index('idx_usage_users_count').on(t.count),
  updatedIdx: index('idx_usage_users_updated').on(t.updatedAt),
}));

export const adminStates = table('admin_states', {
  userId: integer('user_id').primaryKey(),
  state: text('state').notNull(),
  payload: json('payload').notNull().default({}),
  updatedAt: integer('updated_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (t) => ({
  expiresIdx: index('idx_admin_states_expires').on(t.expiresAt),
}));

export const pendingExternalRequests = table('pending_external_requests', {
  key: text('key').primaryKey(),
  chatId: integer('chat_id').notNull(),
  commandMessageId: integer('command_message_id').notNull(),
  requesterUserId: integer('requester_user_id').notNull(),
  profileUserId: integer('profile_user_id').notNull(),
  profileFullName: text('profile_full_name').notNull(),
  profileUsername: text('profile_username'),
  profileIsPremium: integer('profile_is_premium').notNull().default(0),
  originalMessageId: integer('original_message_id').notNull(),
  contextChatUsername: text('context_chat_username'),
  responseMessageId: integer('response_message_id'),
  externalUsername: text('external_username').notNull(),
  externalRegex: text('external_regex').notNull(),
  externalLabel: text('external_label').notNull(),
  externalValue: text('external_value'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (t) => ({
  replyIdx: uniqueIndex('uq_pending_external_reply')
    .on(t.chatId, t.commandMessageId),
  expiresIdx: index('idx_pending_external_expires').on(t.expiresAt),
  requesterIdx: index('idx_pending_external_requester').on(t.requesterUserId),
}));

export const managedBots = table('managed_bots', {
  botId: integer('bot_id').primaryKey(),
  ownerId: integer('owner_id').notNull(),
  username: text('username'),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => ({
  ownerUnique: uniqueIndex('uq_managed_bots_owner').on(t.ownerId),
  usernameIdx: index('idx_managed_bots_username').on(t.username),
}));

export const processedUpdates = table('processed_updates', {
  updateId: integer('update_id').primaryKey(),
  expiresAt: integer('expires_at').notNull(),
}, (t) => ({
  expiresIdx: index('idx_processed_updates_expires').on(t.expiresAt),
}));

export const requestWindows = table('request_windows', {
  key: text('key').primaryKey(),
  timestamps: json('timestamps').notNull().default([]),
  version: integer('version').notNull().default(0),
  expiresAt: integer('expires_at').notNull(),
}, (t) => ({
  expiresIdx: index('idx_request_windows_expires').on(t.expiresAt),
}));
