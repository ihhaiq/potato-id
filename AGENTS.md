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

Phase 1 is the only completed phase:

- repository + feature inventory: complete
- persistent/in-memory state inventory: complete
- Aiogram -> Serverless handler mapping: complete
- initial Serverless scaffold: complete
- proposed persistent schema: complete
- Managed Bots: manager-side Bot API confirmed; child-update routing on
  Telegram Serverless remains unproven pending live CLI/platform verification
- feature handlers: not ported yet
- database migration: not run yet
- deployment: not run yet

Update this status immediately when code changes make it stale.
