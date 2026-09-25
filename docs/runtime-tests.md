# Telegram Serverless runtime test checklist

Run these after filling `DEVELOPER_IDS` and linking the local project to the intended bot.

## 1. Static validation

```bash
npm install
npm test
```

Expected:

```text
Serverless static validation passed.
```

## 2. Cloud state

```bash
npx tgcloud --version
npx tgcloud status
npx tgcloud diff
```

Review every pending schema change before:

```bash
npx tgcloud push
npx tgcloud migrate
npx tgcloud webhook
```

Expected deployed update handlers:

- message
- callback_query
- guest_message
- managed_bot, only if the current CLI/platform accepts this Bot API update type.

If `managed_bot` is rejected by the CLI, remove no feature silently: record the exact CLI error and leave the manager-side module documented as blocked by platform handler support.

## 3. Main commands

Test in private chat:

- `/start`
- configured start alias
- `/myid`
- `/id`
- `ايدي`
- `/top`
- `توب`
- `/secret` must return the group-only warning
- `/mybot`
- `/admin` as developer
- `/admin` as non-developer must stay silent

## 4. Rich Profile

Test accounts with:

- no profile photo
- one photo
- many photos
- Premium
- no username

Verify:

- heading
- closed user-info Details
- copyable code ID
- text mention
- username
- Premium line
- total profile-photo count
- slideshow
- Huge Dev button
- heart counter

Test in a group where photos are restricted and verify the no-photo fallback.

## 5. Hearts and Top

- press heart once -> like
- press again -> unlike
- press rapidly -> throttling prevents race spam
- refresh Top
- test heart callback from Guest/inline result
- verify developer boosts after DEVELOPER_IDS is filled
- verify profile target remains in likes ranking with zero real votes if it previously had a heart target

## 6. Secret

In a group:

- press `show_secret`
- user with photo gets ephemeral photo
- user without photo gets ephemeral text
- only the receiver sees the result
- callback is acknowledged

## 7. Guest Mode

With Guest Mode enabled in BotFather:

- explicit @bot mention -> caller profile
- reply + `،،` + mention -> replied user's profile
- mention without `،،` while replying -> caller profile
- `@bot توب` or configured Top alias -> Guest Top
- heart and Top refresh callbacks work on the inline/guest message

## 8. External Bot-to-Bot

With Bot-to-Bot Communication enabled:

- configure username/command/regex/label through `/admin`
- run `/id` in a group
- base profile appears immediately
- valid bot reply inside 8 seconds edits the same profile with the extracted field
- wrong bot username is ignored
- non-matching regex doesn't corrupt the profile
- late replies after expiry are ignored

## 9. Admin panel

Test every callback:

- admin:texts
- admin:edit_welcome
- admin:edit_secret
- admin:welcome_button
- admin:set_welcome_button
- admin:remove_welcome_button
- admin:remove_welcome_button_confirm
- admin:aliases
- admin:alias_cmd:<command>
- admin:add_alias:<command>
- admin:del_alias_menu:<command>
- admin:del_alias_ask:<command>:<index>
- admin:del_alias_confirm:<command>:<index>
- admin:ext_bot
- admin:set_ext_username
- admin:set_ext_command
- admin:set_ext_regex
- admin:set_ext_label
- admin:test_ext_regex
- admin:remove_ext_bot
- admin:remove_ext_bot_confirm
- admin:backup
- admin:export
- admin:import
- admin:back

Restart/isolate safety check: start an admin input flow, then trigger it in a later invocation. The state must remain in `admin_states`.

## 10. Backup compatibility

- export from Serverless
- confirm JSON contains `exported_at`, `config`, `hearts`, `usage`
- import an old Python backup
- verify texts, aliases, welcome button, external config, hearts and Top usage
- export again and confirm data survived the round trip

Managed-bot tokens must never appear.

## 11. Managed Bots

- enable Bot Management Mode
- create child through `/mybot`
- confirm manager receives `managed_bot`
- confirm `managed_bots` metadata updates
- repeat token/owner lifecycle update and verify no duplicate "new bot" notification

Do **not** claim child commands work until Telegram Serverless provides or proves an inbound route for child-bot updates using the child identity. Do not replace this check with a polling loop.
