# main ↔ serverless-cleanup parity

Baseline for comparison:

- `main` SHA: `f1c383ae27e8e7206f5eb4799433cce5e64188a9`
- Serverless branch: `serverless-cleanup`

Statuses:

- **1:1** — user-visible behavior and data semantics are intended to match.
- **Equivalent** — same feature/result with a Serverless-native implementation.
- **Intentional Serverless difference** — function preserved but timing/runtime mechanics differ.
- **Blocked** — platform support required before a truthful implementation is possible.

| Feature | main | serverless-cleanup | Status |
|---|---|---|---|
| /start | Aiogram handler | message handler | 1:1 |
| start aliases | bot_config.json | command_aliases | 1:1 |
| /myid | Markdown reply | Markdown reply | 1:1 |
| /id | Aiogram + Rich Message | Serverless + Rich Message | 1:1 |
| id aliases | bot_config.json | command_aliases | 1:1 |
| profile Details | InputRichBlockDetails | raw Bot API block | 1:1 |
| profile photo limit | 50 | 50 | 1:1 |
| slideshow | InputRichBlockSlideshow | raw slideshow block | 1:1 |
| photo fallback | recoverable Telegram errors | same recoverable errors | 1:1 |
| Huge Dev button | inline URL button | inline URL button | 1:1 |
| heart count | hearts.json | normalized DB | Equivalent |
| heart toggle | lock + JSON write | DB + request guard | Equivalent |
| keep empty heart target | JSON key remains | heart_targets row remains | 1:1 |
| developer heart boost | +106 | +106 | 1:1 |
| usage count | usage.json | usage_users | Equivalent |
| developer usage boost | +2006 | +2006 | 1:1 |
| /top | Rich Message | Rich Message | 1:1 |
| Top limit | 56 | 56 | 1:1 |
| Top refresh | normal/inline edit | normal/inline edit | 1:1 |
| /secret | group-only ephemeral | group-only ephemeral | 1:1 |
| ephemeral Bot API shape | old top-level params | current ephemeral_message_parameters | Equivalent |
| Guest profile | answerGuestQuery | answerGuestQuery | 1:1 |
| Guest reply + ،، target | supported | supported | 1:1 |
| Guest Top | alias-based | alias-based | 1:1 |
| external bot config | JSON config | DB config | Equivalent |
| external Bot-to-Bot wait | Future up to 8s | DB correlation up to 8s | Intentional Serverless difference |
| external profile result | profile waits before first send | base profile sent immediately, then edited | Intentional Serverless difference |
| /mybot link | supported | supported | 1:1 |
| managed_bot lifecycle | raw update + JSON | Serverless handler + DB | Equivalent |
| managed token persistence | stored in managed_bots.json | not persisted | Intentional security improvement |
| managed child /start | polling worker | no documented child update route | Blocked |
| managed child /id | polling worker | no documented child update route | Blocked |
| managed child /top | polling worker | no documented child update route | Blocked |
| managed child /secret | polling worker | no documented child update route | Blocked |
| managed child Guest Mode | polling worker | no documented child update route | Blocked |
| managed child callbacks | polling worker | no documented child update route | Blocked |
| /admin access | ADMIN_IDS env | DEVELOPER_IDS registry | Equivalent |
| admin texts | MemoryStorage + JSON | admin_states + DB | Equivalent |
| admin welcome button | JSON | DB | Equivalent |
| admin aliases | JSON | DB | Equivalent |
| admin external settings | JSON | DB | Equivalent |
| admin regex test | Python re | JavaScript RegExp | Equivalent for configured patterns used by this bot |
| backup export | JSON document | same legacy JSON shape | 1:1 |
| backup import | JSON replace | validated DB replace | Equivalent |
| throttling | process memory | DB sliding window | Equivalent / stronger restart safety |
| handler error alert | @dp.errors | handler wrapper + developer alert | Equivalent |
| broken Aiogram parse handling | safe_polling | not applicable; no Aiogram model parse layer | Equivalent platform behavior |
| polling | safe_polling | Telegram Serverless webhook | Intentional Serverless difference |

## Remaining non-1:1 items

Only two categories remain intentionally non-identical:

1. **External Bot-to-Bot timing** — Serverless can't hold an `asyncio.Future` between invocations, so the base profile is sent first and edited if the reply arrives within the existing 8-second window.
2. **Managed child runtime** — `main` owns child tokens and runs one `getUpdates` loop per child. Telegram's current public Serverless documentation does not expose a supported route for child-bot updates inside the manager's Serverless project. Recreating polling inside Serverless would violate the runtime model.

Everything else is implemented to match `main` or with a persistence/runtime equivalent.

## Validation

Run:

```bash
npm test
npx tgcloud status
npx tgcloud diff
```

Then follow `docs/runtime-tests.md` after deployment.
