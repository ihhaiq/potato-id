import { db } from 'sdk';
import { asc, eq } from 'sdk/db';
import { botSettings, commandAliases } from 'schema';

const SETTINGS_ID = 1;

const SEEDED_EFFECTIVE_CONFIG = Object.freeze({
  texts: Object.freeze({
    welcome: '👋 هلا وغلا بيك!\n\nأنا بوت أسوي رسائل غنية بصور بروفايلك.\n\n📌 الأوامر المتوفرة:\n/id — يرسل رسالة غنية بألبوم صور بروفايلك\n/secret — مثال على رسالة مؤقتة',
    secret: 'Text broken',
  }),
  welcome_button: Object.freeze({
    text: 'Huge HUSSEIN',
    url: 'https://t.me/ihhai',
  }),
  aliases: Object.freeze({
    start: Object.freeze([]),
    id: Object.freeze(['ايدي']),
    secret: Object.freeze([]),
    top: Object.freeze(['توب']),
  }),
  external_bot: Object.freeze({
    username: null,
    command: '/info',
    regex: 'الرسائل\\s*:\\s*([\\d,]+)',
    label: 'الرسائل',
  }),
  legacy_extra: Object.freeze({
    gh_bot_username: 'GHSupportGroupsBot',
  }),
});

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function cleanText(value, max = 4096) {
  if (value == null) return null;
  const text = String(value);
  return text.length > max ? text.slice(0, max) : text;
}

function normalizedAlias(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function aliasKey(command, alias) {
  return String(command) + ':' + encodeURIComponent(normalizedAlias(alias));
}

async function seedAliases() {
  const stamp = nowSeconds();
  for (const [command, aliases] of Object.entries(SEEDED_EFFECTIVE_CONFIG.aliases)) {
    for (const alias of aliases) {
      const normalized = normalizedAlias(alias);
      if (!normalized) continue;
      await db.insert(commandAliases).values({
        key: aliasKey(command, alias),
        command,
        alias: String(alias),
        normalizedAlias: normalized,
        createdAt: stamp,
      }).onConflictDoNothing({
        target: commandAliases.key,
      }).run();
    }
  }
}

export async function ensureConfigSeeded() {
  const seed = SEEDED_EFFECTIVE_CONFIG;
  const inserted = await db.insert(botSettings).values({
    id: SETTINGS_ID,
    welcomeText: seed.texts.welcome,
    secretText: seed.texts.secret,
    welcomeButtonText: seed.welcome_button.text,
    welcomeButtonUrl: seed.welcome_button.url,
    externalBotUsername: seed.external_bot.username,
    externalBotCommand: seed.external_bot.command,
    externalBotRegex: seed.external_bot.regex,
    externalBotLabel: seed.external_bot.label,
    legacyExtra: { ...seed.legacy_extra },
    updatedAt: nowSeconds(),
  }).onConflictDoNothing({
    target: botSettings.id,
  }).returning({
    id: botSettings.id,
  }).run();

  if (Array.isArray(inserted) && inserted.length > 0) {
    await seedAliases();
    return true;
  }
  return false;
}

export async function getConfig() {
  await ensureConfigSeeded();

  const settings = await db.select().from(botSettings)
    .where(eq(botSettings.id, SETTINGS_ID))
    .get();

  if (!settings) {
    throw new Error('bot_settings singleton is missing after seed');
  }

  const aliasRows = await db.select().from(commandAliases)
    .orderBy(asc(commandAliases.command), asc(commandAliases.createdAt))
    .all();

  const aliases = { start: [], id: [], secret: [], top: [] };
  for (const row of aliasRows) {
    if (!Object.hasOwn(aliases, row.command)) aliases[row.command] = [];
    aliases[row.command].push(row.alias);
  }

  const welcomeButton = settings.welcomeButtonText && settings.welcomeButtonUrl
    ? { text: settings.welcomeButtonText, url: settings.welcomeButtonUrl }
    : null;

  return {
    texts: {
      welcome: settings.welcomeText,
      secret: settings.secretText,
    },
    welcome_button: welcomeButton,
    aliases,
    external_bot: {
      username: settings.externalBotUsername,
      command: settings.externalBotCommand || '/info',
      regex: settings.externalBotRegex,
      label: settings.externalBotLabel || 'عدد الرسائل',
    },
    ...(settings.legacyExtra && typeof settings.legacyExtra === 'object'
      ? settings.legacyExtra
      : {}),
  };
}

export async function commandMatchesAlias(text, command) {
  const normalized = normalizedAlias(text);
  if (!normalized) return false;

  await ensureConfigSeeded();
  const row = await db.select({ key: commandAliases.key })
    .from(commandAliases)
    .where(eq(commandAliases.key, aliasKey(command, normalized)))
    .get();
  return Boolean(row);
}

export async function setWelcomeText(value) {
  await ensureConfigSeeded();
  await db.update(botSettings).set({
    welcomeText: cleanText(value, 4096) ?? '',
    updatedAt: nowSeconds(),
  }).where(eq(botSettings.id, SETTINGS_ID)).run();
}

export async function setSecretText(value) {
  await ensureConfigSeeded();
  await db.update(botSettings).set({
    secretText: cleanText(value, 4096) ?? '',
    updatedAt: nowSeconds(),
  }).where(eq(botSettings.id, SETTINGS_ID)).run();
}

export async function setWelcomeButton(button) {
  await ensureConfigSeeded();
  const text = button?.text ? cleanText(button.text, 64) : null;
  const url = button?.url ? cleanText(button.url, 2048) : null;
  await db.update(botSettings).set({
    welcomeButtonText: text,
    welcomeButtonUrl: url,
    updatedAt: nowSeconds(),
  }).where(eq(botSettings.id, SETTINGS_ID)).run();
}

export async function setExternalBotConfig(patch) {
  await ensureConfigSeeded();
  const changes = { updatedAt: nowSeconds() };

  if (Object.hasOwn(patch || {}, 'username')) {
    changes.externalBotUsername = patch.username
      ? cleanText(String(patch.username).replace(/^@+/, ''), 64)
      : null;
  }
  if (Object.hasOwn(patch || {}, 'command')) {
    const raw = cleanText(patch.command, 128) || '/info';
    changes.externalBotCommand = raw.startsWith('/') ? raw : '/' + raw;
  }
  if (Object.hasOwn(patch || {}, 'regex')) {
    changes.externalBotRegex = patch.regex ? cleanText(patch.regex, 2048) : null;
  }
  if (Object.hasOwn(patch || {}, 'label')) {
    changes.externalBotLabel = cleanText(patch.label, 128) || 'عدد الرسائل';
  }

  await db.update(botSettings).set(changes)
    .where(eq(botSettings.id, SETTINGS_ID))
    .run();
}

export async function addAlias(command, alias) {
  const normalized = normalizedAlias(alias);
  if (!normalized) return false;
  await ensureConfigSeeded();

  const inserted = await db.insert(commandAliases).values({
    key: aliasKey(command, alias),
    command: String(command),
    alias: String(alias).trim(),
    normalizedAlias: normalized,
    createdAt: nowSeconds(),
  }).onConflictDoNothing({
    target: commandAliases.key,
  }).returning({
    key: commandAliases.key,
  }).run();

  return Array.isArray(inserted) && inserted.length > 0;
}

export async function removeAlias(command, alias) {
  const normalized = normalizedAlias(alias);
  if (!normalized) return;
  await db.delete(commandAliases)
    .where(eq(commandAliases.key, aliasKey(command, normalized)))
    .run();
}

export function seededEffectiveConfig() {
  return JSON.parse(JSON.stringify(SEEDED_EFFECTIVE_CONFIG));
}
