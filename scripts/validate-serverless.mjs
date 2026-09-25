import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const deployable = ['schema.js'];
for (const dir of ['lib', 'handlers']) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  for (const name of fs.readdirSync(abs)) {
    if (name.endsWith('.js')) deployable.push(path.join(dir, name).replaceAll('\\', '/'));
  }
}

const modules = new Set([
  'schema',
  ...deployable
    .filter((file) => file.startsWith('lib/') || file.startsWith('handlers/'))
    .map((file) => file.replace(/\.js$/, '')),
]);

const allowedSdk = new Set(['sdk', 'sdk/db', 'sdk/api', 'sdk/fetch']);
const forbidden = [
  'asyncio',
  'MemoryStorage',
  'getUpdates(',
  'while (true)',
  'managed_bots.json',
  'hearts.json',
  'usage.json',
  'bot_config.json',
];

const failures = [];

for (const file of deployable) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');

  for (const term of forbidden) {
    if (source.includes(term)) failures.push(file + ': forbidden runtime dependency: ' + term);
  }

  if (/from\s+['"]\.\.?\//.test(source)) {
    failures.push(file + ': relative runtime import found');
  }

  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const spec = match[1];
    if (!allowedSdk.has(spec) && !modules.has(spec)) {
      failures.push(file + ': unresolved runtime import ' + spec);
    }
  }
}

const requiredFiles = [
  'handlers/message.js',
  'handlers/callback_query.js',
  'handlers/guest_message.js',
  'handlers/managed_bot.js',
  'lib/admin.js',
  'lib/external-bot.js',
  'lib/managed-bots.js',
  'lib/profile.js',
  'lib/top.js',
  'lib/secret.js',
  'lib/legacy-backup.js',
  'lib/errors.js',
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) failures.push('missing required file: ' + file);
}

const requiredFragments = {
  'handlers/message.js': [
    "matchesCommand(text, 'myid')",
    "matchesCommandOrAlias(text, 'start')",
    "matchesCommandOrAlias(text, 'id')",
    "matchesCommandOrAlias(text, 'top')",
    "matchesCommandOrAlias(text, 'secret')",
    "matchesCommand(text, 'mybot')",
    'handleAdminMessage(message)',
    'handleExternalBotMessage(message)',
  ],
  'handlers/callback_query.js': [
    'handleAdminCallback(query)',
    "data === 'show_secret'",
    "data.startsWith('heart_like:')",
    "data === 'top_refresh'",
  ],
  'handlers/guest_message.js': [
    'answerGuestProfile',
    'answerGuestTop',
    "text.includes('،،')",
  ],
  'lib/admin.js': [
    "data === 'admin:texts'",
    "data === 'admin:aliases'",
    "data === 'admin:welcome_button'",
    "data === 'admin:ext_bot'",
    "data === 'admin:backup'",
    "data === 'admin:export'",
    "data === 'admin:import'",
    "state.state === 'waiting_import_file'",
  ],
  'lib/secret.js': ['ephemeral_message_parameters'],
  'lib/profile.js': ['PROFILE_PHOTO_LIMIT = 50'],
};

for (const [file, fragments] of Object.entries(requiredFragments)) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const source = fs.readFileSync(full, 'utf8');
  for (const fragment of fragments) {
    if (!source.includes(fragment)) failures.push(file + ': missing parity fragment ' + fragment);
  }
}

if (failures.length) {
  console.error('Serverless validation failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('Serverless static validation passed.');
console.log('Checked deployable files:', deployable.length);
