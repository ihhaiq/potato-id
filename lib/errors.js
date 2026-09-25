import { api } from 'sdk';
import { primaryDeveloperId } from 'lib/developer-access';

function clip(value, limit = 600) {
  const text = String(value ?? '');
  return text.length > limit ? text.slice(0, limit) + '…' : text;
}

function updateKeys(update) {
  if (!update || typeof update !== 'object') return '؟';
  return Object.keys(update).filter((key) => key !== 'update_id').join(', ') || '؟';
}

export async function reportHandlerError(source, error, ctx = {}, payload = null) {
  const update = ctx?.update && typeof ctx.update === 'object' ? ctx.update : {};
  const updateId = update?.update_id ?? '؟';
  const actor = payload?.from || payload?.user || payload?.guest_bot_caller_user || null;
  const chat = payload?.chat || payload?.message?.chat || null;

  console.error(source + ' failed for update ' + updateId, error);

  const developerId = primaryDeveloperId();
  if (!Number.isSafeInteger(Number(developerId))) return;

  const lines = [
    '🔴 خطأ غير متوقع داخل handler لـUpdate رقم ' + updateId,
    '',
    'المصدر: ' + source,
    'نوع الخطأ: ' + (error?.name || 'Error'),
    'التفاصيل:',
    clip(error?.message || error),
    '',
    '🆔 آيدي المستخدم: ' + (actor?.id ?? '؟'),
    '👤 اليوزر: ' + (actor?.username ? '@' + actor.username : 'بدون يوزر'),
    '💬 المحادثة: ' + (chat?.id ?? '؟') + ' (' + (chat?.type || '؟') + ')',
    '📦 حقول الـupdate: ' + updateKeys(update),
  ];

  try {
    await api.sendMessage({
      chat_id: Number(developerId),
      text: lines.join('\n'),
    });
  } catch (notifyError) {
    console.error('Failed to notify developer about handler error', notifyError);
  }
}
