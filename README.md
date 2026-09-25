# potato-id — Telegram Serverless

فرع `serverless-cleanup` ينقل البوت من Python/Aiogram إلى Telegram Serverless JavaScript مع الحفاظ على سلوك `main` قدر ما تسمح المنصة.

## قبل النشر

افتح:

`lib/developer-access.js`

وحط ID حسابك الرقمي داخل:

```js
export const DEVELOPER_IDS = Object.freeze([123456789]);
```

تقدر تعرف ID حسابك من `/myid`.

> لا تحط BOT_TOKEN أو أي token/secret داخل الملف. الـID الرقمي يستخدم لصلاحية `/admin` وdeveloper boosts وتنبيهات الأخطاء فقط.

## الميزات المنقولة

- `/start` + الكلمات المفتاحية.
- `/myid`.
- `/id` + الكلمات المفتاحية.
- Rich Profile بنفس Details + معلومات المستخدم + slideshow.
- حتى 50 صورة بروفايل باستخدام Telegram `file_id`.
- fallback بدون صور عند منع الصور أو فشل صورة داخل Rich Message.
- Huge Dev + عداد القلوب.
- like / unlike لكل بروفايل.
- `/top` + refresh + ترتيب usage وlikes.
- developer boosts الحالية: hearts `+106` وusage `+2006`.
- `/secret` باستخدام Ephemeral Messages الحالية.
- Guest Mode للبروفايل وTop.
- Bot-to-Bot external info عبر state machine دائم بالـDB.
- `/mybot` + تسجيل lifecycle لتحديثات `managed_bot`.
- `/admin` كامل:
  - تعديل نص الترحيب.
  - تعديل نص الرسالة المؤقتة.
  - إضافة/تعديل/حذف زر الترحيب.
  - إدارة aliases لـ`/start`, `/id`, `/secret`, `/top`.
  - إعداد external bot: username / command / regex / label.
  - اختبار regex.
  - backup export/import.
- backup بصيغة متوافقة مع الشكل القديم: `config + hearts + usage`.
- throttling دائم بالـDB.
- update idempotency.
- developer error reporting.

## التخزين

Serverless ما يعتمد على ملفات JSON أو ذاكرة العملية كمصدر دائم.

الجداول الرئيسية في `schema.js`:

- `bot_settings`
- `command_aliases`
- `heart_targets`
- `heart_votes`
- `usage_users`
- `admin_states`
- `pending_external_requests`
- `managed_bots`
- `processed_updates`
- `request_windows`

ملفات Python وJSON القديمة تبقى مرجع لسلوك `main` فقط، وليست runtime للنسخة Serverless.

## Managed Bots

الجزء manager-side منقول: إنشاء الرابط، استقبال `managed_bot` وتخزين bot ID/owner/username.

**الـchild runtime نفسه مو مزيف داخل Serverless.** النسخة القديمة تشغل `getUpdates` worker مستقل لكل child bot، بينما Telegram Serverless ما يوفر بالوثائق الحالية مسارًا مثبتًا لاستقبال تحديثات child bot داخل نفس مشروع manager. لذلك ماكو polling دائم وماكو تخزين managed-bot tokens داخل DB.

راجع `docs/parity.md` و`docs/serverless.md`.

## الفحص والنشر

```bash
npm install
npm test

npx tgcloud --version
npx tgcloud status
npx tgcloud diff
npx tgcloud push
```

إذا `schema.js` يحتوي تغييرات غير مطبقة:

```bash
npx tgcloud migrate
```

بعدها:

```bash
npx tgcloud webhook
```

راجع `docs/runtime-tests.md` لاختبار الأوامر والـcallbacks بعد النشر.

## الملفات الأساسية

```text
schema.js
handlers/
  message.js
  callback_query.js
  guest_message.js
  managed_bot.js
lib/
  admin.js
  admin-state.js
  config.js
  developer-access.js
  errors.js
  external-bot.js
  hearts.js
  legacy-backup.js
  managed-bots.js
  profile.js
  request-guard.js
  secret.js
  top.js
  usage.js
  welcome.js
scripts/
  validate-serverless.mjs
docs/
  serverless.md
  parity.md
  runtime-tests.md
```

## أمان

- لا ترفع `.tgcloud/`.
- لا ترفع bot token أو managed-bot token.
- الـbackup العادي لا يحتوي managed-bot tokens.
- لا تحول child bots إلى polling loops داخل Serverless.
- لا تعتمد على process globals أو filesystem كحالة دائمة.
