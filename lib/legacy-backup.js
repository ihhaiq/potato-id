import { db } from 'sdk';
import { botSettings, commandAliases, heartTargets, heartVotes, usageUsers } from 'schema';
import { getConfig, seededEffectiveConfig } from 'lib/config';

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function textOr(value, fallback = null, max = 4096) {
  if (value == null) return fallback;
  const text = String(value);
  return text.slice(0, max);
}

function normalizeConfig(raw) {
  const base = seededEffectiveConfig();
  const incoming = plainObject(raw) ? raw : {};

  const texts = plainObject(incoming.texts) ? incoming.texts : {};
  const welcomeButton = incoming.welcome_button == null
    ? null
    : plainObject(incoming.welcome_button)
      ? {
          text: textOr(incoming.welcome_button.text, '', 64),
          url: textOr(incoming.welcome_button.url, '', 2048),
        }
      : base.welcome_button;

  const aliases = {};
  const incomingAliases = plainObject(incoming.aliases) ? incoming.aliases : {};
  for (const command of ['start', 'id', 'secret', 'top']) {
    const rawAliases = Object.hasOwn(incomingAliases, command)
      ? incomingAliases[command]
      : base.aliases[command];
    aliases[command] = Array.isArray(rawAliases)
      ? [...new Set(rawAliases.map((value) => String(value).trim()).filter(Boolean))]
      : [...base.aliases[command]];
  }

  const external = plainObject(incoming.external_bot)
    ? incoming.external_bot
    : base.external_bot;

  const known = new Set(['texts', 'welcome_button', 'aliases', 'external_bot']);
  const legacyExtra = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (!known.has(key)) legacyExtra[key] = value;
  }

  return {
    texts: {
      welcome: textOr(texts.welcome, base.texts.welcome, 4096),
      secret: textOr(texts.secret, base.texts.secret, 4096),
    },
    welcome_button: welcomeButton && welcomeButton.text && welcomeButton.url
      ? welcomeButton
      : null,
    aliases,
    external_bot: {
      username: external?.username
        ? textOr(String(external.username).replace(/^@+/, ''), null, 64)
        : null,
      command: (() => {
        const rawCommand = textOr(external?.command, '/info', 128) || '/info';
        return rawCommand.startsWith('/') ? rawCommand : '/' + rawCommand;
      })(),
      regex: external?.regex ? textOr(external.regex, null, 2048) : null,
      label: textOr(external?.label, 'عدد الرسائل', 128) || 'عدد الرسائل',
    },
    legacy_extra: legacyExtra,
  };
}

function normalizeHearts(raw) {
  const likes = plainObject(raw?.likes) ? raw.likes : {};
  const targets = [];
  const votes = [];
  const seen = new Set();

  for (const [targetRaw, voters] of Object.entries(likes)) {
    const target = Number(targetRaw);
    if (!Number.isSafeInteger(target) || !Array.isArray(voters)) continue;
    targets.push(target);
    for (const voterRaw of voters) {
      const voter = Number(voterRaw);
      if (!Number.isSafeInteger(voter)) continue;
      const key = String(target) + ':' + String(voter);
      if (seen.has(key)) continue;
      seen.add(key);
      votes.push({ key, targetUserId: target, voterUserId: voter });
    }
  }
  return { targets: [...new Set(targets)], votes };
}

function normalizeUsage(raw) {
  const users = plainObject(raw?.users) ? raw.users : {};
  const rows = [];

  for (const [userIdRaw, entry] of Object.entries(users)) {
    const userId = Number(userIdRaw);
    if (!Number.isSafeInteger(userId) || !plainObject(entry)) continue;
    rows.push({
      userId,
      fullName: textOr(entry.name, 'مستخدم', 256) || 'مستخدم',
      username: entry.username ? textOr(entry.username, null, 64) : null,
      count: Math.max(0, Math.floor(Number(entry.count) || 0)),
    });
  }
  return rows;
}

export function normalizeLegacyBackup(payload) {
  if (!plainObject(payload) || !plainObject(payload.config)) {
    throw new Error("Legacy backup must contain an object field named 'config'");
  }

  return {
    exportedAt: payload.exported_at == null ? null : String(payload.exported_at),
    config: normalizeConfig(payload.config),
    hearts: normalizeHearts(payload.hearts),
    usage: normalizeUsage(payload.usage),
  };
}

export async function importLegacyBackup(payload) {
  // Validate and normalize the entire payload before the first write. The SDK
  // currently doesn't document a cross-table transaction primitive, so callers
  // should create a recovery export before invoking this destructive replace.
  const normalized = normalizeLegacyBackup(payload);
  const stamp = nowSeconds();
  const config = normalized.config;

  await db.insert(botSettings).values({
    id: 1,
    welcomeText: config.texts.welcome,
    secretText: config.texts.secret,
    welcomeButtonText: config.welcome_button?.text ?? null,
    welcomeButtonUrl: config.welcome_button?.url ?? null,
    externalBotUsername: config.external_bot.username,
    externalBotCommand: config.external_bot.command,
    externalBotRegex: config.external_bot.regex,
    externalBotLabel: config.external_bot.label,
    legacyExtra: config.legacy_extra,
    updatedAt: stamp,
  }).onConflictDoUpdate({
    target: botSettings.id,
    set: {
      welcomeText: config.texts.welcome,
      secretText: config.texts.secret,
      welcomeButtonText: config.welcome_button?.text ?? null,
      welcomeButtonUrl: config.welcome_button?.url ?? null,
      externalBotUsername: config.external_bot.username,
      externalBotCommand: config.external_bot.command,
      externalBotRegex: config.external_bot.regex,
      externalBotLabel: config.external_bot.label,
      legacyExtra: config.legacy_extra,
      updatedAt: stamp,
    },
  }).run();

  await db.delete(commandAliases).run();
  for (const [command, aliases] of Object.entries(config.aliases)) {
    for (const alias of aliases) {
      const normalizedAlias = String(alias).trim().toLocaleLowerCase();
      await db.insert(commandAliases).values({
        key: command + ':' + encodeURIComponent(normalizedAlias),
        command,
        alias,
        normalizedAlias,
        createdAt: stamp,
      }).onConflictDoNothing({ target: commandAliases.key }).run();
    }
  }

  await db.delete(heartVotes).run();
  await db.delete(heartTargets).run();
  for (const targetUserId of normalized.hearts.targets) {
    await db.insert(heartTargets).values({
      targetUserId,
      createdAt: stamp,
    }).onConflictDoNothing({ target: heartTargets.targetUserId }).run();
  }
  for (const row of normalized.hearts.votes) {
    await db.insert(heartVotes).values({
      ...row,
      createdAt: stamp,
    }).onConflictDoNothing({ target: heartVotes.key }).run();
  }

  await db.delete(usageUsers).run();
  for (const row of normalized.usage) {
    await db.insert(usageUsers).values({
      ...row,
      updatedAt: stamp,
    }).onConflictDoUpdate({
      target: usageUsers.userId,
      set: {
        fullName: row.fullName,
        username: row.username,
        count: row.count,
        updatedAt: stamp,
      },
    }).run();
  }

  return {
    aliases: Object.values(config.aliases).reduce((sum, values) => sum + values.length, 0),
    hearts: normalized.hearts.votes.length,
    usageUsers: normalized.usage.length,
  };
}


export async function exportLegacyBackup() {
  const [config, targets, votes, users] = await Promise.all([
    getConfig(),
    db.select().from(heartTargets).all(),
    db.select().from(heartVotes).all(),
    db.select().from(usageUsers).all(),
  ]);

  const likes = {};
  for (const row of targets) {
    likes[String(row.targetUserId)] = [];
  }
  for (const row of votes) {
    const key = String(row.targetUserId);
    if (!Array.isArray(likes[key])) likes[key] = [];
    likes[key].push(String(row.voterUserId));
  }

  const usage = { users: {} };
  for (const row of users) {
    usage.users[String(row.userId)] = {
      name: row.fullName,
      username: row.username ?? null,
      count: Number(row.count || 0),
    };
  }

  return {
    exported_at: new Date().toISOString(),
    config,
    hearts: { likes },
    usage,
  };
}
