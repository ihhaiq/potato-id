# AGENTS.md — potato-id Serverless migration

This branch ports potato-id from Python/Aiogram to Telegram Serverless
JavaScript. Keep `main` unchanged and use it as the behavioral source of truth.

## Baseline

- Source branch: `main`
- Baseline SHA: `f1c383ae27e8e7206f5eb4799433cce5e64188a9`
- Migration branch: `serverless-cleanup`
- Full migration notes: `docs/serverless.md`

The old README is incomplete. Read `bot.py` before deciding that a feature does
or does not exist.

## References

- Telegram Serverless: https://core.telegram.org/bots/serverless
- Bot API: https://core.telegram.org/bots/api
- Bot API changelog: https://core.telegram.org/bots/api-changelog
- Guest Mode: https://core.telegram.org/bots/features#guest-mode
- Bot-to-Bot / Managed Bots: https://core.telegram.org/bots/features

Use the current CLI/scaffold as the final SDK contract when documentation and an
old local note disagree.

## Runtime rules

- Runtime code is JavaScript in root `schema.js`, `lib/` and one-level
  `handlers/*.js`.
- Handler names follow Bot API update types.
- Handler default exports receive the update payload; the full update is in the
  handler context.
- Runtime imports are bare module names such as `sdk`, `sdk/db`, `schema`
  and `lib/...`.
- No Python, Aiogram, writable persistent filesystem, npm runtime packages,
  polling loops, background workers or process-memory state.
- Bot API calls use the Serverless SDK `api` object and current Bot API
  parameter names.
- Every database operation is asynchronous and must be awaited.
- Do not declare foreign keys.
- `tgcloud push` deploys code; `tgcloud migrate` applies schema changes
  separately.
- Never commit `.tgcloud/`, CLI credentials, main bot tokens or managed bot
  tokens.

## Compatibility rules

- Preserve current command/alias/callback behavior unless Serverless imposes a
  proven limitation.
- Preserve callback_data values such as `show_secret`, `heart_like:<id>`,
  `top_refresh` and all `admin:...` callbacks.
- Preserve developer boosts exactly: hearts +106, usage +2006.
- Preserve Top limit 56 and profile-photo limit 50.
- Preserve old backup import shape: `config`, `hearts`, `usage`.
- The normal backup must never include managed-bot tokens.
- Current Bot API requires `ephemeral_message_parameters`; do not port the old
  top-level `receiver_user_id` / `callback_query_id` send parameters.
- Do not emulate the old external-bot `Future`; use persistent correlation.
- Do not recreate managed child bots with a Serverless `getUpdates` loop.

## Current migration status

Phases 1-5 are implemented in source as far as Telegram Serverless currently allows,
with live tgcloud migration/deployment verification still pending:

- repository + feature/state inventory: complete
- Serverless scaffold and persistent schema: complete
- config storage: DB-backed and seeded from main's effective bot_config state
- admin FSM state: DB-backed with expiry
- hearts: normalized unique target/voter rows and DB toggle helper
- usage: atomic DB increment helper
- throttling + update idempotency: DB-backed
- legacy backup migration: validated config/hearts/usage normalization + DB import helper
- message handler: /start, /myid, /id and start/id aliases
- Rich Profile: Details + up to 50 profile photos + slideshow + fallback + Huge Dev/heart keyboard
- /top + refresh callback: ported
- heart like/unlike callback: ported
- /secret: ported with current ephemeral_message_parameters
- Guest Mode profile + Top: ported
- external Bot-to-Bot continuation: ported as persistent 8-second state machine with base-first profile edit
- /mybot + managed_bot lifecycle registration: ported manager-side
- Managed child bot runtime: blocked pending a documented Serverless child-update routing/auth primitive; no polling loop or token persistence is used
- /admin UI: not ported yet; its persistent state layer is ready
- developer ID registry: intentionally empty until numeric IDs are supplied for Serverless
- schema migration: not run from this environment
- deployment/runtime tests: not run from this environment

Update this status immediately when code changes make it stale.
