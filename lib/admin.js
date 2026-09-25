import { api, InputFile } from 'sdk';
import {
  addAlias,
  getConfig,
  removeAlias,
  setExternalBotConfig,
  setSecretText,
  setWelcomeButton,
  setWelcomeText,
} from 'lib/config';
import {
  clearAdminState,
  getAdminState,
  setAdminState,
  updateAdminStatePayload,
} from 'lib/admin-state';
import { isDeveloper } from 'lib/developer-access';
import {
  exportLegacyBackup,
  importLegacyBackup,
  normalizeLegacyBackup,
} from 'lib/legacy-backup';

const COMMAND_LABELS = Object.freeze({
  start: '/start',
  id: '/id',
  secret: '/secret',
  top: '/top',
});

const ALIAS_STATES = Object.freeze({
  start: 'waiting_new_alias_start',
  id: 'waiting_new_alias_id',
  secret: 'waiting_new_alias_secret',
  top: 'waiting_new_alias_top',
});

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

function adminMainMenu() {
  return {
    inline_keyboard: [
      [{ text: '✏️ تعديل النصوص', callback_data: 'admin:texts' }],
      [{ text: '🔑 الكلمات المفتاحية', callback_data: 'admin:aliases' }],
      [{ text: '🔘 زر الترحيب', callback_data: 'admin:welcome_button' }],
      [{ text: '🔗 ربط بوت خارجي (Info)', callback_data: 'admin:ext_bot' }],
      [{ text: '💾 نسخة احتياطية (تصدير/استيراد)', callback_data: 'admin:backup' }],
    ],
  };
}

function commandName(text) {
  if (typeof text !== 'string') return '';
  const first = text.trim().split(/\s+/, 1)[0].toLocaleLowerCase();
  if (!first.startsWith('/')) return '';
  return first.split('@', 1)[0];
}

function callbackChat(query) {
  return {
    chatId: Number(query?.message?.chat?.id),
    messageId: Number(query?.message?.message_id),
  };
}

async function editPanel(query, text, replyMarkup = undefined, extra = {}) {
  const { chatId, messageId } = callbackChat(query);
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(messageId)) return false;
  await api.editMessageText({
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    ...extra,
  });
  return true;
}

async function answer(query, text = undefined, showAlert = false) {
  if (!query?.id) return;
  await api.answerCallbackQuery({
    callback_query_id: query.id,
    ...(text ? { text } : {}),
    ...(showAlert ? { show_alert: true } : {}),
  });
}

function captureGroupCount(pattern) {
  const source = String(pattern || '');
  let count = 0;
  let escaped = false;
  let inClass = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === ']' && inClass) {
      inClass = false;
      continue;
    }
    if (inClass || ch !== '(') continue;

    if (source[i + 1] !== '?') {
      count += 1;
      continue;
    }

    // Named captures (?<name>...) count; lookbehind (?<= / ?<!) does not.
    if (source[i + 2] === '<' && !['=', '!'].includes(source[i + 3])) {
      count += 1;
    }
  }
  return count;
}

function aliasesMenuText(command, aliases) {
  const label = COMMAND_LABELS[command] || '/' + command;
  const list = aliases.length ? aliases.map((alias) => '• ' + alias).join('\n') : 'ماكو كلمات مفتاحية مضافة.';
  const rows = [[{ text: '➕ إضافة كلمة', callback_data: 'admin:add_alias:' + command }]];
  if (aliases.length) {
    rows.push([{ text: '🗑️ حذف كلمة', callback_data: 'admin:del_alias_menu:' + command }]);
  }
  rows.push([{ text: '⬅️ رجوع', callback_data: 'admin:aliases' }]);
  return {
    text: '🔑 كلمات ' + label + ' المفتاحية:\n\n' + list,
    keyboard: { inline_keyboard: rows },
  };
}

function extStatus(config) {
  const ext = config?.external_bot || {};
  if (!ext.username) return 'ماكو بوت خارجي مربوط حالياً.';
  return (
    'يوزرنيم البوت: @' + ext.username + '\n'
    + 'الأمر المُرسل: ' + (ext.command || '/info') + '\n'
    + 'نمط القراءة (regex): ' + ext.regex + '\n'
    + 'التسمية بالرسالة: ' + ext.label
  );
}

export async function openAdmin(message) {
  if (!message?.from?.id || !message?.chat?.id || !isDeveloper(message.from.id)) {
    return false;
  }
  await clearAdminState(message.from.id);
  await api.sendMessage({
    chat_id: message.chat.id,
    text: '⚙️ لوحة المطور',
    reply_markup: adminMainMenu(),
  });
  return true;
}

export async function handleAdminMessage(message) {
  const userId = Number(message?.from?.id);
  if (!Number.isSafeInteger(userId) || !isDeveloper(userId)) return false;

  if (commandName(message?.text) === '/admin') {
    await openAdmin(message);
    return true;
  }

  const state = await getAdminState(userId);
  if (!state?.state) return false;

  const chatId = Number(message?.chat?.id);
  if (!Number.isSafeInteger(chatId)) return true;
  const text = typeof message?.text === 'string' ? message.text : '';

  if (state.state === 'waiting_welcome_text') {
    await setWelcomeText(text);
    await clearAdminState(userId);
    await api.sendMessage({
      chat_id: chatId,
      text: '✅ تم تحديث نص الترحيب.',
      reply_markup: adminMainMenu(),
    });
    return true;
  }

  if (state.state === 'waiting_secret_text') {
    await setSecretText(text);
    await clearAdminState(userId);
    await api.sendMessage({
      chat_id: chatId,
      text: '✅ تم تحديث نص الرسالة المؤقتة.',
      reply_markup: adminMainMenu(),
    });
    return true;
  }

  if (state.state === 'waiting_welcome_button_text') {
    await updateAdminStatePayload(userId, { button_text: text });
    await setAdminState(userId, 'waiting_welcome_button_url', {
      ...state.payload,
      button_text: text,
    });
    await api.sendMessage({
      chat_id: chatId,
      text: '🔗 هسه ارسل الرابط (لازم يبدأ بـ https://)',
    });
    return true;
  }

  if (state.state === 'waiting_welcome_button_url') {
    const url = text.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      await api.sendMessage({
        chat_id: chatId,
        text: '❌ الرابط لازم يبدأ بـ http:// أو https://. جرب مرة ثانية:',
      });
      return true;
    }
    await setWelcomeButton({
      text: state.payload?.button_text || '',
      url,
    });
    await clearAdminState(userId);
    await api.sendMessage({
      chat_id: chatId,
      text: '✅ تم إضافة/تحديث زر الترحيب.',
      reply_markup: adminMainMenu(),
    });
    return true;
  }

  if (Object.values(ALIAS_STATES).includes(state.state)) {
    const command = state.payload?.alias_command;
    const newWord = text.trim();
    if (!COMMAND_LABELS[command] || !newWord) {
      await clearAdminState(userId);
      return true;
    }
    const added = await addAlias(command, newWord);
    await clearAdminState(userId);
    await api.sendMessage({
      chat_id: chatId,
      text: added
        ? '✅ تمت إضافة "' + newWord + '" ككلمة مفتاحية لـ ' + COMMAND_LABELS[command] + '.'
        : '⚠️ هذي الكلمة موجودة أصلاً.',
      reply_markup: adminMainMenu(),
    });
    return true;
  }

  if (state.state === 'waiting_ext_username') {
    await setExternalBotConfig({ username: text.trim().replace(/^@+/, '') });
    await clearAdminState(userId);
    await api.sendMessage({
      chat_id: chatId,
      text: '✅ تم حفظ يوزرنيم البوت الخارجي.',
      reply_markup: adminMainMenu(),
    });
    return true;
  }

  if (state.state === 'waiting_ext_command') {
    await setExternalBotConfig({ command: text.trim() });
    await clearAdminState(userId);
    await api.sendMessage({
      chat_id: chatId,
      text: '✅ تم حفظ الأمر.',
      reply_markup: adminMainMenu(),
    });
    return true;
  }

  if (state.state === 'waiting_ext_regex') {
    const pattern = text.trim();
    try {
      new RegExp(pattern);
    } catch (error) {
      await api.sendMessage({
        chat_id: chatId,
        text: '❌ نمط regex غير صحيح: ' + (error?.message || error) + '\nجرب مرة ثانية:',
      });
      return true;
    }
    if (captureGroupCount(pattern) < 1) {
      await api.sendMessage({
        chat_id: chatId,
        text: '❌ النمط لازم يحتوي مجموعة وحدة () حوالين القيمة. جرب مرة ثانية:',
      });
      return true;
    }
    await setExternalBotConfig({ regex: pattern });
    await clearAdminState(userId);
    await api.sendMessage({
      chat_id: chatId,
      text: '✅ تم حفظ نمط القراءة.',
      reply_markup: adminMainMenu(),
    });
    return true;
  }

  if (state.state === 'waiting_ext_label') {
    await setExternalBotConfig({ label: text.trim() });
    await clearAdminState(userId);
    await api.sendMessage({
      chat_id: chatId,
      text: '✅ تم حفظ التسمية.',
      reply_markup: adminMainMenu(),
    });
    return true;
  }

  if (state.state === 'waiting_ext_test_text') {
    await clearAdminState(userId);
    const config = await getConfig();
    const pattern = config.external_bot?.regex;
    let match = null;
    try {
      match = pattern ? new RegExp(pattern).exec(text) : null;
    } catch (error) {
      await api.sendMessage({
        chat_id: chatId,
        text: '❌ النمط نفسه غير صحيح: ' + (error?.message || error),
        reply_markup: adminMainMenu(),
      });
      return true;
    }

    if (match?.[1] != null) {
      await api.sendMessage({
        chat_id: chatId,
        text: '✅ نجح الاستخراج!\nالقيمة اللي طلعت: `' + match[1] + '`',
        parse_mode: 'Markdown',
        reply_markup: adminMainMenu(),
      });
    } else {
      await api.sendMessage({
        chat_id: chatId,
        text:
          '❌ ما انسحبت أي قيمة من النص.\n\n'
          + 'أسباب شائعة:\n'
          + '• التسمية بالنص مو مطابقة 100% للي بالنمط (مثلاً فرق بمسافة أو رمز خفي)\n'
          + '• النمط يفتش عن أرقام بينما القيمة نص عادي، أو العكس\n'
          + '• ناقص () حوالين الجزء اللي تريد تسحبه\n\n'
          + "جرب تعدل النمط من '🧩 نمط القراءة' وارجع اختبره.",
        reply_markup: adminMainMenu(),
      });
    }
    return true;
  }

  if (state.state === 'waiting_import_file') {
    if (!message?.document?.file_id) {
      await api.sendMessage({
        chat_id: chatId,
        text: '⚠️ لازم ترسل ملف (Document) بصيغة JSON، مو نص عادي. جرب مرة ثانية:',
      });
      return true;
    }

    const size = Number(message.document.file_size || 0);
    if (size > MAX_IMPORT_BYTES) {
      await api.sendMessage({
        chat_id: chatId,
        text: '❌ حجم ملف النسخة أكبر من 20MB.',
        reply_markup: adminMainMenu(),
      });
      await clearAdminState(userId);
      return true;
    }

    await clearAdminState(userId);
    try {
      const bytes = await api.getFileContent(message.document.file_id);
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      // Validate the whole payload before mutating DB.
      normalizeLegacyBackup(payload);
      await importLegacyBackup(payload);
      await api.sendMessage({
        chat_id: chatId,
        text: '✅ تم استيراد النسخة الاحتياطية بنجاح (الإعدادات + اللايكات + بيانات الاستخدام).',
        reply_markup: adminMainMenu(),
      });
    } catch (error) {
      console.error('Admin backup import failed', error);
      await api.sendMessage({
        chat_id: chatId,
        text: '❌ فشل قراءة/استيراد الملف: ' + (error?.message || error),
        reply_markup: adminMainMenu(),
      });
    }
    return true;
  }

  return false;
}

export async function handleAdminCallback(query) {
  const userId = Number(query?.from?.id);
  const data = String(query?.data || '');
  if (!data.startsWith('admin:')) return false;
  if (!Number.isSafeInteger(userId) || !isDeveloper(userId)) return true;

  if (data === 'admin:back') {
    await clearAdminState(userId);
    await editPanel(query, '⚙️ لوحة المطور', adminMainMenu());
    await answer(query);
    return true;
  }

  if (data === 'admin:texts') {
    await editPanel(query, '✏️ اختار النص اللي تريد تعدله:', {
      inline_keyboard: [
        [{ text: '📝 نص الترحيب (/start)', callback_data: 'admin:edit_welcome' }],
        [{ text: '🤫 نص الرسالة المؤقتة (/secret)', callback_data: 'admin:edit_secret' }],
        [{ text: '⬅️ رجوع', callback_data: 'admin:back' }],
      ],
    });
    await answer(query);
    return true;
  }

  if (data === 'admin:edit_welcome') {
    const config = await getConfig();
    await setAdminState(userId, 'waiting_welcome_text');
    await editPanel(
      query,
      '📝 ارسل النص الجديد لرسالة الترحيب (/start) الحين:\n\nالنص الحالي:\n'
        + config.texts.welcome,
    );
    await answer(query);
    return true;
  }

  if (data === 'admin:edit_secret') {
    const config = await getConfig();
    await setAdminState(userId, 'waiting_secret_text');
    await editPanel(
      query,
      '🤫 ارسل النص الجديد للرسالة المؤقتة الحين.\n'
        + 'تكدر تستخدم {name} بالنص وراح ينستبدل باسم الشخص تلقائياً.\n\n'
        + 'النص الحالي:\n' + config.texts.secret,
    );
    await answer(query);
    return true;
  }

  if (data === 'admin:welcome_button') {
    const config = await getConfig();
    const current = config.welcome_button;
    const status = current
      ? 'الزر الحالي: ' + current.text + ' -> ' + current.url
      : 'ماكو زر مضاف حالياً.';
    const rows = [[{ text: '➕ إضافة / تعديل الزر', callback_data: 'admin:set_welcome_button' }]];
    if (current) rows.push([{ text: '🗑️ حذف الزر', callback_data: 'admin:remove_welcome_button' }]);
    rows.push([{ text: '⬅️ رجوع', callback_data: 'admin:back' }]);
    await editPanel(query, '🔘 زر رسالة الترحيب\n\n' + status, { inline_keyboard: rows });
    await answer(query);
    return true;
  }

  if (data === 'admin:set_welcome_button') {
    await setAdminState(userId, 'waiting_welcome_button_text');
    await editPanel(query, '✍️ ارسل نص الزر (مثلاً: تواصل وياي)');
    await answer(query);
    return true;
  }

  if (data === 'admin:remove_welcome_button') {
    await editPanel(query, '⚠️ متأكد تريد تحذف زر الترحيب؟', {
      inline_keyboard: [
        [{ text: '✅ نعم، احذف الزر', callback_data: 'admin:remove_welcome_button_confirm' }],
        [{ text: '❌ لا، رجوع', callback_data: 'admin:welcome_button' }],
      ],
    });
    await answer(query);
    return true;
  }

  if (data === 'admin:remove_welcome_button_confirm') {
    await setWelcomeButton(null);
    await clearAdminState(userId);
    await editPanel(query, '✅ تم حذف زر الترحيب.', adminMainMenu());
    await answer(query);
    return true;
  }

  if (data === 'admin:ext_bot') {
    const config = await getConfig();
    const ext = config.external_bot || {};
    const rows = [
      [{ text: '👤 يوزرنيم البوت', callback_data: 'admin:set_ext_username' }],
      [{ text: '⌨️ الأمر المُرسل', callback_data: 'admin:set_ext_command' }],
      [{ text: '🧩 نمط القراءة (regex)', callback_data: 'admin:set_ext_regex' }],
      [{ text: '🏷️ التسمية بالرسالة', callback_data: 'admin:set_ext_label' }],
    ];
    if (ext.username) {
      rows.push([{ text: '🗑️ إلغاء الربط', callback_data: 'admin:remove_ext_bot' }]);
    }
    rows.push([{ text: '🧪 اختبار النمط على نص', callback_data: 'admin:test_ext_regex' }]);
    rows.push([{ text: '⬅️ رجوع', callback_data: 'admin:back' }]);
    await editPanel(
      query,
      '🔗 ربط بوت خارجي (زي Group Help أو أي بوت ثاني)\n\n'
        + extStatus(config) + '\n\n'
        + 'لما تربطه، أمر /id (بالكروب بس) راح يرسل الأمر تلقائياً للبوت المربوط '
        + 'ويقرا قيمة من رده حسب نمط الـregex ويحطها بمعلومات المستخدم.\n\n'
        + '⚠️ لازم تكون مفعّل Bot-to-Bot Communication Mode لبوتك من BotFather '
        + '(mybots -> بوتك -> Bot Settings)، وإلا ما راح توصلك ردود من البوت الثاني.\n\n'
        + '🔄 عشان تبدل لبوت ثاني بالمستقبل: بس غيّر اليوزرنيم والأمر والـregex '
        + 'والتسمية من هنا — ماكو داعي تلمس الكود.',
      { inline_keyboard: rows },
    );
    await answer(query);
    return true;
  }

  if (data === 'admin:set_ext_username') {
    await setAdminState(userId, 'waiting_ext_username');
    await editPanel(query, '✍️ ارسل يوزرنيم البوت الخارجي بدون @ (مثلاً: GroupHelpBot)');
    await answer(query);
    return true;
  }

  if (data === 'admin:set_ext_command') {
    await setAdminState(userId, 'waiting_ext_command');
    await editPanel(
      query,
      '⌨️ ارسل الأمر اللي ينرسل للبوت الخارجي (بدون @username، ينضاف تلقائياً).\n'
        + 'مثال: /info أو /stats أو /whois',
    );
    await answer(query);
    return true;
  }

  if (data === 'admin:set_ext_regex') {
    await setAdminState(userId, 'waiting_ext_regex');
    await editPanel(
      query,
      '🧩 ارسل نمط الـregex اللي يسحب القيمة من رد البوت الخارجي.\n'
        + 'لازم يحتوي مجموعة وحدة () حوالين القيمة المطلوبة.\n\n'
        + 'مثال (لبوت GH): عدد الرسائل:\\s*([\\d,]+)',
    );
    await answer(query);
    return true;
  }

  if (data === 'admin:set_ext_label') {
    await setAdminState(userId, 'waiting_ext_label');
    await editPanel(query, '🏷️ ارسل التسمية اللي تنعرض جنب القيمة بالرسالة (مثلاً: عدد الرسائل)');
    await answer(query);
    return true;
  }

  if (data === 'admin:remove_ext_bot') {
    await editPanel(query, '⚠️ متأكد تريد تفك ربط البوت الخارجي؟', {
      inline_keyboard: [
        [{ text: '✅ نعم، افك الربط', callback_data: 'admin:remove_ext_bot_confirm' }],
        [{ text: '❌ لا، رجوع', callback_data: 'admin:ext_bot' }],
      ],
    });
    await answer(query);
    return true;
  }

  if (data === 'admin:remove_ext_bot_confirm') {
    await setExternalBotConfig({ username: null });
    await clearAdminState(userId);
    await editPanel(query, '✅ تم إلغاء ربط البوت الخارجي.', adminMainMenu());
    await answer(query);
    return true;
  }

  if (data === 'admin:test_ext_regex') {
    const config = await getConfig();
    const pattern = config.external_bot?.regex;
    if (!pattern) {
      await answer(query, '⚠️ ماكو نمط regex محفوظ حالياً', true);
      return true;
    }
    await setAdminState(userId, 'waiting_ext_test_text');
    await editPanel(
      query,
      '🧪 الصق هسه نص رد البوت الآخر كامل (نفس الشي اللي يوصلك بالضبط، '
        + 'بما فيه أي فراغات أو رموز خفية)، وراح أختبر عليه النمط الحالي:\n\n'
        + '`' + pattern + '`',
      undefined,
      { parse_mode: 'Markdown' },
    );
    await answer(query);
    return true;
  }

  if (data === 'admin:aliases') {
    const config = await getConfig();
    const rows = Object.entries(COMMAND_LABELS).map(([command, label]) => [{
      text: label + ' (' + (config.aliases?.[command]?.length || 0) + ' كلمة)',
      callback_data: 'admin:alias_cmd:' + command,
    }]);
    rows.push([{ text: '⬅️ رجوع', callback_data: 'admin:back' }]);
    await editPanel(
      query,
      '🔑 اختار الأمر اللي تريد تدير كلماته المفتاحية:',
      { inline_keyboard: rows },
    );
    await answer(query);
    return true;
  }

  if (data.startsWith('admin:alias_cmd:')) {
    const command = data.split(':').at(-1);
    if (!COMMAND_LABELS[command]) {
      await answer(query);
      return true;
    }
    const config = await getConfig();
    const view = aliasesMenuText(command, config.aliases?.[command] || []);
    await editPanel(query, view.text, view.keyboard);
    await answer(query);
    return true;
  }

  if (data.startsWith('admin:add_alias:')) {
    const command = data.split(':').at(-1);
    if (!COMMAND_LABELS[command]) {
      await answer(query);
      return true;
    }
    await setAdminState(userId, ALIAS_STATES[command], { alias_command: command });
    await editPanel(query, '✍️ ارسل الكلمة الجديدة اللي راح تشغل ' + COMMAND_LABELS[command] + ':');
    await answer(query);
    return true;
  }

  if (data.startsWith('admin:del_alias_menu:')) {
    const command = data.split(':').at(-1);
    const config = await getConfig();
    const aliases = config.aliases?.[command] || [];
    const rows = aliases.map((alias, index) => [{
      text: '🗑️ ' + alias,
      callback_data: 'admin:del_alias_ask:' + command + ':' + index,
    }]);
    rows.push([{ text: '⬅️ رجوع', callback_data: 'admin:alias_cmd:' + command }]);
    await editPanel(query, 'اختار الكلمة اللي تريد تحذفها:', { inline_keyboard: rows });
    await answer(query);
    return true;
  }

  if (data.startsWith('admin:del_alias_ask:')) {
    const parts = data.split(':');
    const command = parts[2];
    const index = Number(parts[3]);
    const config = await getConfig();
    const aliases = config.aliases?.[command] || [];
    if (!Number.isInteger(index) || index < 0 || index >= aliases.length) {
      await answer(query, '⚠️ ما كدرنا نلقى الكلمة');
      return true;
    }
    const word = aliases[index];
    await editPanel(query, '⚠️ متأكد تريد تحذف الكلمة "' + word + '"؟', {
      inline_keyboard: [
        [{ text: '✅ نعم، احذف', callback_data: 'admin:del_alias_confirm:' + command + ':' + index }],
        [{ text: '❌ لا، رجوع', callback_data: 'admin:del_alias_menu:' + command }],
      ],
    });
    await answer(query);
    return true;
  }

  if (data.startsWith('admin:del_alias_confirm:')) {
    const parts = data.split(':');
    const command = parts[2];
    const index = Number(parts[3]);
    const config = await getConfig();
    const aliases = config.aliases?.[command] || [];
    let answerText = '⚠️ ما كدرنا نلقى الكلمة';
    if (Number.isInteger(index) && index >= 0 && index < aliases.length) {
      const removed = aliases[index];
      await removeAlias(command, removed);
      answerText = 'تم حذف "' + removed + '"';
    }
    const updated = await getConfig();
    const view = aliasesMenuText(command, updated.aliases?.[command] || []);
    await editPanel(query, view.text, view.keyboard);
    await answer(query, answerText);
    return true;
  }

  if (data === 'admin:backup') {
    await editPanel(
      query,
      '💾 نسخة احتياطية\n\n'
        + '📤 تصدير: يرسللك ملف JSON فيه كل الإعدادات (النصوص/الكلمات المفتاحية/'
        + 'زر الترحيب/البوت الخارجي) + اللايكات + بيانات الاستخدام (Top).\n\n'
        + '📥 استيراد: تحمّل ملف JSON (نفس صيغة التصدير) ويستبدل كل هذا الشي الحالي بالكامل.',
      {
        inline_keyboard: [
          [{ text: '📤 تصدير نسخة احتياطية', callback_data: 'admin:export' }],
          [{ text: '📥 استيراد نسخة احتياطية', callback_data: 'admin:import' }],
          [{ text: '⬅️ رجوع', callback_data: 'admin:back' }],
        ],
      },
    );
    await answer(query);
    return true;
  }

  if (data === 'admin:export') {
    const backup = await exportLegacyBackup();
    const json = JSON.stringify(backup, null, 2);
    const bytes = new TextEncoder().encode(json);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const filename = 'backup_' + stamp.replace('T', '_').replace('Z', '') + '.json';
    const { chatId } = callbackChat(query);
    await api.sendDocument({
      chat_id: chatId,
      document: new InputFile(bytes, filename, { type: 'application/json' }),
      caption: '📦 نسخة احتياطية كاملة (إعدادات + لايكات + استخدام)',
    });
    await answer(query, '✅ تم التصدير');
    return true;
  }

  if (data === 'admin:import') {
    await setAdminState(userId, 'waiting_import_file');
    await editPanel(
      query,
      '📥 ارسل هسه ملف الـJSON (نفس اللي طلع من زر التصدير) عشان نستورده.\n\n'
        + '⚠️ تحذير: هذا راح يستبدل كل الإعدادات واللايكات وبيانات الاستخدام '
        + 'الحالية بالكامل — تصدير نسخة جديدة الأول لو تحسبها احتياط.',
    );
    await answer(query);
    return true;
  }

  await answer(query);
  return true;
}

export function adminAccessConfigured() {
  return true;
}
