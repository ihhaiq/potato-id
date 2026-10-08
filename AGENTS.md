# Potato ID — Telegram Serverless CLI 0.2

- Work on `serverless-cleanup`; never rewrite `main` during this migration.
- Runtime files live in `tgcloud/schema.js`, `tgcloud/lib/`, `tgcloud/handlers/`.
- Runtime imports of project modules **must be relative and end in .js**. SDK imports use `sdk`, `sdk/db`, etc.
- Do not create a nested `potato-id/` inside the CLI project; `Hugepfpbot` is only the local directory name.
- Developer ID configuration: `tgcloud/lib/developer-access.js`.
- Preserve existing database data and Bot API behavior; never replace the real schema with an empty starter schema.
- `.tgcloud/` contains local credentials and must be kept out of Git.
- Verify bot identity, diffs, tests and migration plan before pushing. Source validation isn't equivalent to live tests.
- No polling loop or process-local persistent state. Managed child-bot execution is unverified.
