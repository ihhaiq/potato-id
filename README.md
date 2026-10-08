# Potato ID — Telegram Serverless CLI 0.2

This is the **serverless-cleanup** development branch of [potato-id](https://github.com/ihhaiq/potato-id). The local folder may be named `Hugepfpbot`—the Telegram bot identity is set by BotFather CLI Access credentials, not by the repository or folder name.

## Project layout

```text
Hugepfpbot/
  tgcloud.jsonc
  package.json
  tgcloud/
    schema.js
    handlers/
    lib/
  scripts/
  docs/
```

The CLI deploys only code in `tgcloud/`. All local runtime imports use relative `.js` paths. **Never commit `.tgcloud/` or bot tokens.**

## Set up on a new Windows PC

Run these in PowerShell after installing Git and Node.js:

```powershell
cd "$HOME\Desktop"
git clone --branch serverless-cleanup https://github.com/ihhaiq/potato-id.git Hugepfpbot
cd Hugepfpbot
npm.cmd install
npm.cmd test
npx.cmd tgcloud login
npx.cmd tgcloud status
npx.cmd tgcloud diff
```

Use the CLI Access token **for the intended existing Telegram bot** from BotFather → Serverless → CLI Access. Verify the app ID printed by login. Do not copy old `.tgcloud` credentials or the empty scaffold code into this checkout.

## Before production deployment

1. Configure developer IDs in `tgcloud/lib/developer-access.js` (no secrets).
2. Confirm `npm test` succeeds and inspect `npx tgcloud status` / `npx tgcloud diff`.
3. Inspect `npx tgcloud migrate --dry-run` and ensure changes won't remove existing cloud tables/data.
4. Only after review, run `npx tgcloud push`, apply required migration, and inspect `npx tgcloud webhook`.

Do not use `reset`, `push --force`, or destructive migrations for initial setup. Static validation does **not** prove live runtime correctness. Managed child bot execution remains an unresolved runtime constraint; see `docs/serverless.md`.
