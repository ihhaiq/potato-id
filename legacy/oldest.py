"""
بوت تليكرام (aiogram >= 3.30.0)

الميزات:
  - /start          : رسالة ترحيب (نصها وزرها قابلين للتعديل من لوحة المطور)
  - /id              : رسالة غنية (Rich Message) بألبوم صور بروفايل المستخدم + زر Huge Dev
  - /secret          : رسالة مؤقتة (Ephemeral) فيها صورة البروفايل الحالية للمستخدم
  - وضع الضيف        : يرد بس إذا انذكر يوزر البوت صراحة، برسالة غنية + زر Huge Dev
  - /admin           : لوحة مطور (للآيديات المدرجة بـADMIN_IDS بس) لتعديل النصوص،
                        إضافة/حذف كلمات مفتاحية للأوامر، وإدارة زر الترحيب
  - /myid            : يطلعلك آيدي حسابك (تحتاجه عشان تحط نفسك بـADMIN_IDS)

⚠️ ملاحظات مهمة قبل التشغيل:
  1. لازم تحط آيدياتك بمتغير ADMIN_IDS تحت (اكتب /myid بالبوت عشان تعرفه)
  2. الإعدادات (النصوص/الكلمات المفتاحية/زر الترحيب) تنحفظ بملف bot_config.json
     بجنب هذا السكربت — لا تحذفه إذا ما تريد تخسر إعداداتك

    pip install -U aiogram   # تأكد النسخة >= 3.30.0
    export BOT_TOKEN="التوكن مالك"
    python profile_rich_message_bot.py
"""

import asyncio
import json
import logging
import os
from pathlib import Path

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message,
    CallbackQuery,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    InputMediaPhoto,
    InputRichMessage,
    InputRichMessageContent,
    InputRichBlockSectionHeading,
    InputRichBlockParagraph,
    InputRichBlockSlideshow,
    InputRichBlockPhoto,
    InlineQueryResultArticle,
)

logging.basicConfig(level=logging.INFO)

BOT_TOKEN = os.getenv("BOT_TOKEN")
if not BOT_TOKEN:
    raise RuntimeError(
        "لازم تحط متغير البيئة BOT_TOKEN قبل التشغيل.\n"
        "مثال: export BOT_TOKEN=\"التوكن مالك\""
    )

# ==================== لازم تعدل هذا! ====================
# آيديات المطورين المسموح لهم يفتحون لوحة التحكم /admin
# اكتب /myid بالبوت عشان تعرف آيدي حسابك، وحطه هنا بدل الرقم التجريبي
ADMIN_IDS = {8997225441}
# ==========================================================

DEV_BUTTON_TEXT = "Huge Dev"
DEV_BUTTON_URL = "https://t.me/ihhai"
CONFIG_PATH = Path(__file__).parent / "bot_config.json"

DEFAULT_CONFIG = {
    "texts": {
        "welcome": (
            "👋 هلا وغلا بيك!\n\n"
            "أنا بوت أسوي رسائل غنية بصور بروفايلك.\n\n"
            "📌 الأوامر المتوفرة:\n"
            "/id — يرسل رسالة غنية بألبوم صور بروفايلك\n"
            "/secret — مثال على رسالة مؤقتة"
        ),
        "secret": (
            "🤫This is your pfp, {name}!\n"
            "The rest of the group members can't see this message at all."
        ),
    },
    "welcome_button": None,  # مثال: {"text": "تواصل وياي", "url": "https://t.me/..."}
    "aliases": {
        "start": [],
        "id": [],
        "secret": [],
    },
}


def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            merged = json.loads(json.dumps(DEFAULT_CONFIG))
            merged.update(data)
            return merged
        except Exception:
            logging.exception("فشل تحميل bot_config.json، رح نستخدم الإعدادات الافتراضية")
    return json.loads(json.dumps(DEFAULT_CONFIG))


def save_config(config: dict) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


CONFIG = load_config()

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())

# يتعبى تلقائياً بيوزر البوت عند التشغيل (داخل main)
BOT_USERNAME: str | None = None


def is_admin(user_id: int) -> bool:
    return user_id in ADMIN_IDS


def dev_keyboard() -> InlineKeyboardMarkup:
    """كيبورد فيه زر Huge Dev بس (يستخدم بالرسالة الغنية بـ/id ووضع الضيف)."""
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=DEV_BUTTON_TEXT, url=DEV_BUTTON_URL)]]
    )


def matches_alias(text: str | None, command_key: str) -> bool:
    if not text:
        return False
    normalized = text.strip().lower()
    return normalized in [a.lower() for a in CONFIG["aliases"].get(command_key, [])]


# ==================== بناء الرسالة الغنية ====================

async def build_profile_rich_message(user) -> InputRichMessage | None:
    """
    يبني رسالة غنية (عنوان + فقرة + ألبوم صور) لصور بروفايل مستخدم معين.
    يرجع None إذا ماكو صور بروفايل عند المستخدم.
    """
    photos = await bot.get_user_profile_photos(user_id=user.id, limit=10)

    if photos.total_count == 0:
        return None

    photo_blocks = []
    for photo_sizes in photos.photos:
        best_quality = photo_sizes[-1]
        photo_blocks.append(
            InputRichBlockPhoto(photo=InputMediaPhoto(media=best_quality.file_id))
        )

    return InputRichMessage(
        blocks=[
            InputRichBlockSectionHeading(
                text=f"📸 {user.full_name} pfp ",
                size=2,
            ),
            InputRichBlockParagraph(
                text=(
                    f"👤 userName: @{user.username or 'بدون يوزر'}\n"
                    f"🔢 TotAl pfp: {photos.total_count}"
                )
            ),
            InputRichBlockSlideshow(blocks=photo_blocks),
        ]
    )


# ==================== /myid ====================

@dp.message(Command("myid"))
async def cmd_myid(message: Message):
    await message.answer(f" `{message.from_user.id}`", parse_mode="Markdown")


# ==================== /start + كلماته المفتاحية ====================

async def send_welcome(message: Message):
    button = CONFIG.get("welcome_button")
    keyboard = None
    if button:
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[[InlineKeyboardButton(text=button["text"], url=button["url"])]]
        )
    await message.answer(CONFIG["texts"]["welcome"], reply_markup=keyboard)


@dp.message(Command("start"))
async def cmd_start(message: Message):
    await send_welcome(message)


@dp.message(F.text.func(lambda t: matches_alias(t, "start")))
async def alias_start(message: Message):
    await send_welcome(message)


# ==================== /id + كلماته المفتاحية ====================

async def send_profile_rich_message(message: Message):
    user = message.from_user
    rich_message = await build_profile_rich_message(user)

    if rich_message is None:
        await message.answer(
            "❌ You don't have a profile picture. Please set one and try again. Or maybe you just blocked me?"
        )
        return

    await bot.send_rich_message(
        chat_id=message.chat.id,
        rich_message=rich_message,
        reply_markup=dev_keyboard(),
    )


@dp.message(Command("id"))
async def cmd_id(message: Message):
    await send_profile_rich_message(message)


@dp.message(F.text.func(lambda t: matches_alias(t, "id")))
async def alias_id(message: Message):
    await send_profile_rich_message(message)


# ==================== /secret + كلماته المفتاحية ====================

async def send_secret_prompt(message: Message):
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🤫 اضغط تشوف السر", callback_data="show_secret")]
        ]
    )
    await message.answer(
        "بالأسفل زر — بس اللي يضغطه راح يشوف رسالة سرية له وحده 👇",
        reply_markup=keyboard,
    )


@dp.message(Command("secret"))
async def cmd_secret(message: Message):
    await send_secret_prompt(message)


@dp.message(F.text.func(lambda t: matches_alias(t, "secret")))
async def alias_secret(message: Message):
    await send_secret_prompt(message)


@dp.callback_query(F.data == "show_secret")
async def handle_secret_callback(callback: CallbackQuery):
    """
    يرسل صورة البروفايل الحالية (الرئيسية) للشخص اللي ضغط الزر، بشكل مؤقت
    (بس هو يشوفها). sendPhoto يدعم receiver_user_id/callback_query_id،
    بعكس sendRichMessage وsendMediaGroup.
    """
    user = callback.from_user
    photos = await bot.get_user_profile_photos(user_id=user.id, limit=1)

    if photos.total_count == 0:
        await bot.send_message(
            chat_id=callback.message.chat.id,
            text=f"🤫 هلا {user.full_name}! بس ماكو عندك صورة بروفايل أعرضها.",
            receiver_user_id=user.id,
            callback_query_id=callback.id,
        )
        await callback.answer()
        return

    current_photo = photos.photos[0][-1]
    caption_text = CONFIG["texts"]["secret"].format(name=user.full_name)

    await bot.send_photo(
        chat_id=callback.message.chat.id,
        photo=current_photo.file_id,
        caption=caption_text,
        receiver_user_id=user.id,
        callback_query_id=callback.id,
    )
    await callback.answer()


# ==================== وضع الضيف ====================

def is_explicit_username_mention(message: Message) -> bool:
    if not message.text or not BOT_USERNAME:
        return False
    target = f"@{BOT_USERNAME}".lower()
    for entity in message.entities or []:
        if entity.type == "mention":
            mention_text = message.text[entity.offset : entity.offset + entity.length]
            if mention_text.lower() == target:
                return True
    return target in message.text.lower()


@dp.guest_message()
async def handle_guest_mention(message: Message):
    if not is_explicit_username_mention(message):
        return

    caller = message.guest_bot_caller_user or message.from_user
    if caller is None:
        return

    rich_message = await build_profile_rich_message(caller)

    if rich_message is None:
        rich_message = InputRichMessage(
            blocks=[
                InputRichBlockParagraph(
                    text=f"👋 هلا {caller.full_name}! ماكو صورة بروفايل عندك أعرضها."
                )
            ]
        )

    await bot.answer_guest_query(
        guest_query_id=message.guest_query_id,
        result=InlineQueryResultArticle(
            id="guest_reply",
            title="رد البوت",
            input_message_content=InputRichMessageContent(rich_message=rich_message),
            reply_markup=dev_keyboard(),
        ),
    )


# ==================== لوحة المطور /admin ====================

class EditStates(StatesGroup):
    waiting_welcome_text = State()
    waiting_secret_text = State()
    waiting_welcome_button_text = State()
    waiting_welcome_button_url = State()
    waiting_new_alias_start = State()
    waiting_new_alias_id = State()
    waiting_new_alias_secret = State()


ALIAS_STATE_MAP = {
    "start": EditStates.waiting_new_alias_start,
    "id": EditStates.waiting_new_alias_id,
    "secret": EditStates.waiting_new_alias_secret,
}
COMMAND_LABELS = {"start": "/start", "id": "/id", "secret": "/secret"}


def admin_main_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="✏️ تعديل النصوص", callback_data="admin:texts")],
            [InlineKeyboardButton(text="🔑 الكلمات المفتاحية", callback_data="admin:aliases")],
            [InlineKeyboardButton(text="🔘 زر الترحيب", callback_data="admin:welcome_button")],
        ]
    )


@dp.message(Command("admin"))
async def cmd_admin(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return  # نتجاهل بصمت لو مو مطور
    await state.clear()
    await message.answer("⚙️ لوحة المطور", reply_markup=admin_main_menu())


@dp.callback_query(F.data == "admin:back")
async def admin_back(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        return
    await state.clear()
    await callback.message.edit_text("⚙️ لوحة المطور", reply_markup=admin_main_menu())
    await callback.answer()


# ---------- تعديل النصوص ----------

@dp.callback_query(F.data == "admin:texts")
async def admin_texts_menu(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="📝 نص الترحيب (/start)", callback_data="admin:edit_welcome")],
            [InlineKeyboardButton(text="🤫 نص الرسالة المؤقتة (/secret)", callback_data="admin:edit_secret")],
            [InlineKeyboardButton(text="⬅️ رجوع", callback_data="admin:back")],
        ]
    )
    await callback.message.edit_text("✏️ اختار النص اللي تريد تعدله:", reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data == "admin:edit_welcome")
async def admin_edit_welcome(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        return
    await state.set_state(EditStates.waiting_welcome_text)
    await callback.message.edit_text(
        "📝 ارسل النص الجديد لرسالة الترحيب (/start) الحين:\n\n"
        f"النص الحالي:\n{CONFIG['texts']['welcome']}"
    )
    await callback.answer()


@dp.message(EditStates.waiting_welcome_text)
async def save_welcome_text(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    CONFIG["texts"]["welcome"] = message.text
    save_config(CONFIG)
    await state.clear()
    await message.answer("✅ تم تحديث نص الترحيب.", reply_markup=admin_main_menu())


@dp.callback_query(F.data == "admin:edit_secret")
async def admin_edit_secret(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        return
    await state.set_state(EditStates.waiting_secret_text)
    await callback.message.edit_text(
        "🤫 ارسل النص الجديد للرسالة المؤقتة الحين.\n"
        "تكدر تستخدم {name} بالنص وراح ينستبدل باسم الشخص تلقائياً.\n\n"
        f"النص الحالي:\n{CONFIG['texts']['secret']}"
    )
    await callback.answer()


@dp.message(EditStates.waiting_secret_text)
async def save_secret_text(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    CONFIG["texts"]["secret"] = message.text
    save_config(CONFIG)
    await state.clear()
    await message.answer("✅ تم تحديث نص الرسالة المؤقتة.", reply_markup=admin_main_menu())


# ---------- زر الترحيب ----------

@dp.callback_query(F.data == "admin:welcome_button")
async def admin_welcome_button_menu(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    current = CONFIG.get("welcome_button")
    status = f"الزر الحالي: {current['text']} -> {current['url']}" if current else "ماكو زر مضاف حالياً."
    rows = [[InlineKeyboardButton(text="➕ إضافة / تعديل الزر", callback_data="admin:set_welcome_button")]]
    if current:
        rows.append([InlineKeyboardButton(text="🗑️ حذف الزر", callback_data="admin:remove_welcome_button")])
    rows.append([InlineKeyboardButton(text="⬅️ رجوع", callback_data="admin:back")])
    await callback.message.edit_text(f"🔘 زر رسالة الترحيب\n\n{status}", reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@dp.callback_query(F.data == "admin:set_welcome_button")
async def admin_set_welcome_button_text(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        return
    await state.set_state(EditStates.waiting_welcome_button_text)
    await callback.message.edit_text("✍️ ارسل نص الزر (مثلاً: تواصل وياي)")
    await callback.answer()


@dp.message(EditStates.waiting_welcome_button_text)
async def save_welcome_button_text(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    await state.update_data(button_text=message.text)
    await state.set_state(EditStates.waiting_welcome_button_url)
    await message.answer("🔗 هسه ارسل الرابط (لازم يبدأ بـ https://)")


@dp.message(EditStates.waiting_welcome_button_url)
async def save_welcome_button_url(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    url = message.text.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        await message.answer("❌ الرابط لازم يبدأ بـ http:// أو https://. جرب مرة ثانية:")
        return

    data = await state.get_data()
    CONFIG["welcome_button"] = {"text": data["button_text"], "url": url}
    save_config(CONFIG)
    await state.clear()
    await message.answer("✅ تم إضافة/تحديث زر الترحيب.", reply_markup=admin_main_menu())


@dp.callback_query(F.data == "admin:remove_welcome_button")
async def admin_remove_welcome_button(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    CONFIG["welcome_button"] = None
    save_config(CONFIG)
    await callback.message.edit_text("✅ تم حذف زر الترحيب.", reply_markup=admin_main_menu())
    await callback.answer()


# ---------- الكلمات المفتاحية ----------

def alias_command_menu_text_and_keyboard(key: str):
    aliases = CONFIG["aliases"].get(key, [])
    text_list = "\n".join(f"• {a}" for a in aliases) if aliases else "ماكو كلمات مفتاحية مضافة."
    rows = [[InlineKeyboardButton(text="➕ إضافة كلمة", callback_data=f"admin:add_alias:{key}")]]
    if aliases:
        rows.append([InlineKeyboardButton(text="🗑️ حذف كلمة", callback_data=f"admin:del_alias_menu:{key}")])
    rows.append([InlineKeyboardButton(text="⬅️ رجوع", callback_data="admin:aliases")])
    return f"🔑 كلمات {COMMAND_LABELS[key]} المفتاحية:\n\n{text_list}", InlineKeyboardMarkup(inline_keyboard=rows)


@dp.callback_query(F.data == "admin:aliases")
async def admin_aliases_menu(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    rows = []
    for key, label in COMMAND_LABELS.items():
        count = len(CONFIG["aliases"].get(key, []))
        rows.append([InlineKeyboardButton(text=f"{label} ({count} كلمة)", callback_data=f"admin:alias_cmd:{key}")])
    rows.append([InlineKeyboardButton(text="⬅️ رجوع", callback_data="admin:back")])
    await callback.message.edit_text("🔑 اختار الأمر اللي تريد تدير كلماته المفتاحية:", reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@dp.callback_query(F.data.startswith("admin:alias_cmd:"))
async def admin_alias_command_menu(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    key = callback.data.split(":")[-1]
    text, keyboard = alias_command_menu_text_and_keyboard(key)
    await callback.message.edit_text(text, reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data.startswith("admin:add_alias:"))
async def admin_add_alias_prompt(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        return
    key = callback.data.split(":")[-1]
    await state.update_data(alias_command=key)
    await state.set_state(ALIAS_STATE_MAP[key])
    await callback.message.edit_text(f"✍️ ارسل الكلمة الجديدة اللي راح تشغل {COMMAND_LABELS[key]}:")
    await callback.answer()


@dp.message(StateFilter(*ALIAS_STATE_MAP.values()))
async def save_new_alias(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    data = await state.get_data()
    key = data["alias_command"]
    new_word = message.text.strip()

    CONFIG["aliases"].setdefault(key, [])
    if new_word.lower() not in [a.lower() for a in CONFIG["aliases"][key]]:
        CONFIG["aliases"][key].append(new_word)
        save_config(CONFIG)
        await message.answer(
            f'✅ تمت إضافة "{new_word}" ككلمة مفتاحية لـ {COMMAND_LABELS[key]}.',
            reply_markup=admin_main_menu(),
        )
    else:
        await message.answer("⚠️ هذي الكلمة موجودة أصلاً.", reply_markup=admin_main_menu())
    await state.clear()


@dp.callback_query(F.data.startswith("admin:del_alias_menu:"))
async def admin_delete_alias_menu(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    key = callback.data.split(":")[-1]
    aliases = CONFIG["aliases"].get(key, [])
    rows = [
        [InlineKeyboardButton(text=f"🗑️ {a}", callback_data=f"admin:del_alias:{key}:{i}")]
        for i, a in enumerate(aliases)
    ]
    rows.append([InlineKeyboardButton(text="⬅️ رجوع", callback_data=f"admin:alias_cmd:{key}")])
    await callback.message.edit_text("اختار الكلمة اللي تريد تحذفها:", reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


@dp.callback_query(F.data.startswith("admin:del_alias:"))
async def admin_delete_alias(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    _, _, key, index_str = callback.data.split(":")
    index = int(index_str)
    aliases = CONFIG["aliases"].get(key, [])
    if 0 <= index < len(aliases):
        removed = aliases.pop(index)
        save_config(CONFIG)
        await callback.answer(f'تم حذف "{removed}"')
    else:
        await callback.answer("⚠️ ما كدرنا نلقى الكلمة")

    text, keyboard = alias_command_menu_text_and_keyboard(key)
    await callback.message.edit_text(text, reply_markup=keyboard)


# ==================== التشغيل ====================

async def main():
    global BOT_USERNAME

    await bot.delete_webhook(drop_pending_updates=True)

    me = await bot.get_me()
    BOT_USERNAME = me.username

    if getattr(me, "supports_guest_queries", False):
        logging.info("✅ Guest Mode مفعّل عند البوت (@%s)", me.username)
    else:
        logging.warning(
            "⚠️ Guest Mode غير مفعّل عند البوت (@%s)! "
            "روح لـ BotFather -> /mybots -> اختار بوتك -> Bot Settings -> فعّل Guest Mode",
            me.username,
        )

    if ADMIN_IDS == {123456789}:
        logging.warning(
            "⚠️ ما عدلت ADMIN_IDS لهسه! اكتب /myid بالبوت وحط آيديك الحقيقي بالكود."
        )

    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
