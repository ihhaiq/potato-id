# Telegram Serverless migration notes — potato-id

This document records the migration facts verified from `main` before the
Serverless port. The Python implementation remains the behavioral source of
truth until each row below is ported and tested.

## Baseline

- Repository: `ihhaiq/potato-id`
- Source branch: `main`
- Baseline commit: `f1c383ae27e8e7206f5eb4799433cce5e64188a9`
- Migration branch: `serverless-cleanup`
- Runtime source: `bot.py` (2312 lines at the baseline)
- Runtime dependencies today: Aiogram, aiohttp, python-dotenv and pydantic.
- Current profile-photo request limit: 50.

Do not infer feature status from the old README. `bot.py` is the source of
truth.

## Current feature inventory

Main bot:

- `/start` and configured aliases.
- `/myid`.
- `/id` and configured aliases.
- Rich profile messages with Details, a profile-photo slideshow, user metadata,
  optional external-bot data, Huge Dev and a per-profile heart button.
- Rich-profile fallbacks when photos cannot be sent.
- Up to 50 profile photos, reusing Telegram `file_id` values.
- Heart toggle: one vote per target/voter pair; pressing again removes it.
- `/top` and aliases, ranking both usage and hearts.
- Developer boosts: hearts +106 and usage +2006 for developer IDs.
- Top list limit: 56.
- Top refresh callback, including inline/guest results.
- `/secret` and aliases; group-only ephemeral response with the current
  profile photo or a no-photo text fallback.
- Guest Mode with explicit bot mention checks, `،،` reply targeting,
  profile results and guest Top.
- Bot-to-Bot external lookup in groups, configurable username/command/regex/label.
- `/mybot` Managed Bot creation flow.
- Managed Bot lifecycle handling and child-bot runtime.
- `/admin` developer panel.
- Editable welcome text and secret text.
- Editable/removable welcome URL button.
- External-bot settings and regex testing.
- Alias add/delete flows for start/id/secret/top.
- Backup export/import for config + hearts + usage.
- Global error reporting and malformed-update reporting.
- Message/callback throttling.

Managed child bots currently share the main bot's config, hearts and usage and
handle:

- `/start`, `/id`, `/top`, `/secret` and the same aliases.
- Guest profile and Guest Top.
- Heart toggle, Top refresh and child-secret callbacks.

## State inventory from the Python runtime

### Persistent filesystem state

| Current source | Meaning | Serverless target |
|---|---|---|
| `bot_config.json` | texts, aliases, welcome button, external-bot config | `bot_settings` + `command_aliases` |
| `hearts.json` | target -> voter IDs | `heart_votes` |
| `usage.json` | user identity cache + usage count | `usage_users` |
| `managed_bots.json` | managed bot metadata **and token** | `managed_bots`; do not persist token unless proven necessary |

The normal backup format exports only `config`, `hearts` and `usage`; it
does not export managed-bot tokens.

### Process-local / in-memory state that must not remain authoritative

- Aiogram `MemoryStorage` for all admin FSM steps.
- `CONFIG`, `HEARTS`, `USAGE`, `MANAGED_BOTS` mutable globals.
- `HEARTS_LOCK`, `USAGE_LOCK`, `CONFIG_LOCK`, `MANAGED_BOTS_LOCK`.
- `BOT_USERNAME` populated during process startup.
- `GH_PENDING` mapping a sent message ID to an `asyncio.Future`.
- `ThrottlingMiddleware.last_call`.
- `MANAGED_WORKER_TASKS`.
- Main-polling offset and each child-bot polling offset.
- Every `asyncio.create_task` worker/waiter used to bridge later updates.

Serverless replacements are database rows, update-local variables, or fresh Bot
API calls. No cross-invocation correctness may rely on globals.

## Aiogram -> Serverless update mapping

| Python responsibility | Serverless handler |
|---|---|
| ordinary messages, commands, aliases, external-bot replies, admin FSM input | `handlers/message.js` |
| secret/heart/top/admin callbacks | `handlers/callback_query.js` |
| Guest Mode | `handlers/guest_message.js` |
| Managed Bot lifecycle update | `handlers/managed_bot.js` **subject to current CLI advertised update types** |
| Aiogram global error handler | defensive wrapper inside each Serverless handler |
| `safe_polling` | removed; Telegram Serverless webhook dispatch |
| managed child `getUpdates` workers | unresolved; see Managed Bots investigation |

## Proposed persistent schema

Implemented in root `schema.js`:

- `bot_settings` — singleton structured settings plus `legacy_extra` for
  unknown legacy config keys that must round-trip.
- `command_aliases` — one normalized alias row per command.
- `heart_votes` — unique target/voter vote rows.
- `usage_users` — current display name, username and usage count.
- `admin_states` — durable developer-panel FSM state + payload + expiry.
- `pending_external_requests` — persistent correlation for Bot-to-Bot replies.
- `managed_bots` — managed bot ID/owner/username/lifecycle metadata, no token.
- `processed_updates` — update idempotency.
- `request_windows` — persistent message/callback throttling windows.

No foreign keys are used because Telegram Serverless's current DB runtime does
not enforce/support them.

## External Bot-to-Bot migration

The Python implementation sends an external command, stores an
`asyncio.Future` by sent message ID, waits up to 8 seconds and only then sends
the profile.

That continuation cannot survive Serverless invocations. The target design is a
persistent state machine:

1. Send the external command and obtain its message ID.
2. Insert a `pending_external_requests` row immediately.
3. Send the base Rich Profile without the external value and persist its
   response message ID.
4. If the external bot reply arrives, match
   `chat_id + reply_to_message.message_id`, validate username and regex, store
   the extracted value and edit the Rich Profile with the completed field.
5. Expired rows are removed lazily.

The row allows either side of steps 3/4 to arrive first without relying on a
Future. This is an intentional Serverless timing difference: the user gets the
base profile immediately instead of waiting up to 8 seconds for a field that may
never arrive.

## Ephemeral migration

The baseline Python code still passes `receiver_user_id` and
`callback_query_id` as top-level send-method parameters.

Current Bot API uses:

```text
ephemeral_message_parameters: {
  receiver_user_id,
  callback_query_id,
  replace_callback_query_message?
}
```

The Serverless port must use the current shape for both main and managed-child
secret flows.

## Managed Bots investigation

Verified from the current Bot API:

- The manager receives a `managed_bot` update.
- `getManagedBotToken(user_id)` fetches the managed bot token.
- A management bot can create/manage child bots and control them through the
  Bot API.

Verified from the Serverless architecture:

- Deployed `handlers/<update_type>.js` are invoked for updates of the linked
  bot and the platform manages that bot's webhook.
- The SDK `api` surface proxies Bot API methods for the linked bot.
- There is no documented long-lived worker/process model; polling loops are not
  a valid design.

Still unproven and therefore **not marked supported yet**:

1. Whether the currently installed tgcloud platform advertises
   `managed_bot` as an accepted handler type.
2. Whether updates addressed to a managed child bot can be delivered into the
   manager bot's Serverless project.
3. Whether Serverless exposes an official child-bot execution/authentication
   primitive.
4. If not, whether a child bot may safely use a webhook routed to a Telegram
   Serverless project. The documented managed webhook is tied to the linked bot,
   so this must not be assumed.

Do not recreate the Python child `getUpdates` loop. Until the points above are
proven against the live CLI/platform, only the manager-side lifecycle can be
designed confidently.

## P0 blockers / checks before claiming parity

- Live tgcloud check for `managed_bot` handler support and child update routing.
- Child-bot authentication/routing design without polling.
- Exact Serverless equivalent for the old 8-second external-bot timeout; current
  design uses base-first + later edit.
- Verify file upload/download helpers in the actual installed SDK before porting
  backup import/export; platform docs/scaffolds have evolved.
- Confirm the linked bot's Guest Mode and Bot-to-Bot settings in BotFather.
- After `schema.js` is deployed, review the schema diff before running
  `tgcloud migrate`.

## Migration status after Phases 2 and 3

| Feature area | Status |
|---|---|
| repository/code inventory | complete |
| state inventory | complete |
| handler mapping | complete |
| persistent schema | committed |
| config storage | implemented in Serverless DB |
| current bot_config seed | implemented from main's effective merged state |
| admin FSM persistence | implemented |
| heart vote persistence | implemented; callback UI comes in Phase 4 |
| usage persistence | implemented; atomic increments |
| throttling/idempotency | implemented; message path wired |
| legacy backup normalization/import helper | implemented; admin upload UI comes later |
| /start | implemented |
| /myid | implemented |
| /id | implemented |
| start/id aliases | implemented |
| Rich Profile rendering | implemented |
| profile photos up to 50 | implemented |
| photo-send fallback | implemented |
| Huge Dev + heart keyboard | implemented |
| developer boosts | code path implemented; developer ID registry still requires deployment value |
| external Bot-to-Bot state machine | designed, not wired |
| /top | not ported |
| /secret | not ported |
| Guest Mode | not ported |
| Managed Bot lifecycle | investigated, live-platform check pending |
| managed child runtime | unresolved |
| /admin UI | not ported; state layer ready |
| schema migration | not run from this environment |
| deployment/runtime tgcloud tests | not run from this environment |

### Phase 2 implementation notes

The Python JSON/process-memory state used by the current runtime is no longer
needed by the new Phase 2 modules:

- `lib/config.js` stores settings and aliases in DB and seeds the exact effective
  state produced by `DEFAULT_CONFIG + bot_config.json` on current main.
- `lib/admin-state.js` replaces Aiogram `MemoryStorage` for admin workflows.
- `lib/hearts.js` stores one unique row per target/voter pair.
- `lib/usage.js` performs atomic usage increments with SQL expressions.
- `lib/request-guard.js` persists update claims and sliding request windows.
- `lib/legacy-backup.js` validates the complete legacy backup before writes and
  can import the old `config/hearts/usage` shape into the normalized tables.

The backup helper intentionally does not claim a cross-table transaction because
the current Serverless SDK reference used by this project does not document one.
The later admin import UI must create/recommend a recovery export before replacing
live data.

### Phase 3 implementation notes

`handlers/message.js` now handles the Phase 3 command slice and stays silent for
unported commands/ordinary messages.

`lib/profile.js` preserves main's current profile structure:

- heading size 2;
- closed Details block with ID, mention, username, Premium state and total photo count;
- up to 50 profile photos, choosing the highest-resolution `file_id` for each;
- slideshow block;
- Huge Dev and `heart_like:<user_id>` inline buttons;
- fallback without photos for `CHAT_SEND_PHOTOS_FORBIDDEN` and
  `RICH_MESSAGE_PHOTO_INVALID`;
- original-message/user context in the fallback.

The current Bot API 10.3 block object types are used directly instead of Aiogram
classes.

### Deployment configuration still required

Current `main` receives `ADMIN_IDS` only from its deployment environment; no
numeric developer IDs are committed. Serverless source therefore keeps
`lib/developer-access.js` empty rather than guessing an identity. Before admin
and developer-boost parity can be declared, populate that registry with the same
numeric IDs used by the current deployment.

## Migration status after Phase 1

| Feature area | Status |
|---|---|
| repository/code inventory | complete |
| state inventory | complete |
| handler mapping | complete |
| proposed schema | committed |
| Serverless local scaffold | committed |
| main bot behavior port | not started |
| admin state port | not started |
| hearts/usage persistence | not started |
| Guest Mode port | not started |
| ephemeral secret port | not started |
| external Bot-to-Bot state machine | designed, not implemented |
| Managed Bot lifecycle | investigated, live-platform check pending |
| managed child runtime | unresolved |
| deployment/migration | not run from this environment |

## Planned commits

1. `Add Telegram Serverless scaffold`
2. `Add persistent Serverless schema`
3. `Port config and admin state`
4. `Port start and profile commands`
5. `Port rich profile rendering`
6. `Port hearts and top`
7. `Port ephemeral secret flow`
8. `Port guest mode`
9. `Port external bot state machine`
10. `Port managed bot lifecycle`
11. `Port admin panel`
12. `Port backup import and export`
13. `Add runtime guards and throttling`
14. `Update Serverless documentation`

The plan may split commits further; it must not combine unrelated behavior just
to match these names.
