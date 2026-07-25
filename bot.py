import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict

import aiohttp
from dotenv import load_dotenv

# يحمّل متغيرات البيئة من ملف .env الموجود بنفس مجلد هذا السكربت (إذا موجود)
# ويحطها بـos.environ، عشان os.getenv() تقدر تلقاها. لازم يصير هذا قبل أي
# قراءة لـos.getenv بالملف.
load_dotenv()

from aiogram import BaseMiddleware, Bot, Dispatcher, F
from aiogram.filters import Command, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    CallbackQuery,
    ErrorEvent,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    InlineQueryResultArticle,
    InputMediaPhoto,
    InputRichBlockDetails,
    InputRichBlockParagraph,
    InputRichBlockPhoto,
    InputRichBlockSectionHeading,
    InputRichBlockSlideshow,
    InputRichMessage,
    InputRichMessageContent,
    Message,
    RichTextCode,
    RichTextTextMention,
    TelegramObject,
    Update,
)
from pydantic import ValidationError

logging.basicConfig(level=logging.INFO)

# ==================== 1) التوكن — لازم فقط env variable ====================
# ⚠️ ما نحط التوكن هنا بالكود إطلاقاً. لو كان عندك توكن مكتوب هنا بنسخة
# سابقة من هذا الملف، اعتبره مكشوف وسوي /revoke له فوراً من BotFather
# وولّد توكن جديد.
BOT_TOKEN = os.getenv("BOT_TOKEN")
if not BOT_TOKEN:
    raise RuntimeError(
        "⚠️ لازم تحط متغير البيئة BOT_TOKEN قبل تشغيل البوت.\n"
        "مثال: export BOT_TOKEN=\"التوكن مالك\"\n\n"
        "ملاحظة أمان: أي توكن كان مكتوب سابقاً بشكل صريح داخل هذا الملف "
        "يعتبر مكشوف — روح لـ BotFather وسوي /revoke له وولّد وحدة جديدة."
    )

# ==================== لازم تعدل هذا! ====================
# آيديات المطورين المسموح لهم يفتحون لوحة التحكم /admin.
# تكدر تحطهم بملف .env بالشكل: ADMIN_IDS=123456,789012 (مفصولين بفاصلة لو أكثر
# من وحد)، أو تحطهم مباشرة بالسطر تحت كـfallback لو ماكو متغير بيئة.
# اكتب /myid بالبوت عشان تعرف آيدي حسابك.
_admin_ids_env = os.getenv("ADMIN_IDS", "")
if _admin_ids_env.strip():
    ADMIN_IDS = {int(x.strip()) for x in _admin_ids_env.split(",") if x.strip()}
else:
    raise RuntimeError(
        "⚠️ لازم تحط متغير البيئة ADMIN_IDS قبل التشغيل (اكتب /myid بالبوت لتعرف آيديك)."
    )
# ==========================================================

DEV_BUTTON_TEXT = "Huge Dev"
DEV_BUTTON_URL = "https://t.me/ihhai"
CONFIG_PATH = Path(__file__).parent / "bot_config.json"

# مهلة انتظار رد بوت الـ Group Help (بالثواني) قبل ما نكمل ونرسل الرسالة الغنية بدونه
GH_REPLY_TIMEOUT = 8

# 4) حد أقصى لعدد طلبات الـ GH المعلقة بنفس الوقت (حماية من تراكم لا نهائي
# لو صار البوت الخارجي بطيء أو متوقف)
MAX_GH_PENDING = 50

# نرسل تنبيهات الأخطاء لأول آيدي بـADMIN_IDS. لو تريد شخص محدد بس يستلمها،
# بدّل هذا السطر بآيديه مباشرة: DEV_ALERT_CHAT_ID = 123456789
DEV_ALERT_CHAT_ID = next(iter(ADMIN_IDS))

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
    # ربط بوت خارجي (زي Group Help) نطلب منه أمر ونقرا قيمة من رده بالـregex.
    # كل شي هنا قابل للتعديل من لوحة /admin بدون لمس الكود:
    #   - username : يوزرنيم البوت الخارجي بدون @
    #   - command  : الأمر اللي نرسله له (بدون @username، ينضاف تلقائياً)
    #   - regex    : نمط لسحب القيمة من رده (لازم فيه مجموعة واحدة () تحوي القيمة)
    #   - label    : التسمية اللي تنعرض بالرسالة الغنية جنب القيمة المسحوبة
    "external_bot": {
        "username": None,
        "command": "/info",
        "regex": r"عدد الرسائل:\s*([\d,]+)",
        "label": "عدد الرسائل",
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


# 2) + 5) + 6) قفل لمنع تعارض الكتابة المتزامنة + حفظ غير متزامن (ما يوقف
# الـ event loop) + كتابة atomic (ملف مؤقت ثم استبدال) عشان ما ينكسر
# bot_config.json لو صار قطع كهرباء أو crash نص الكتابة.
CONFIG_LOCK = asyncio.Lock()


def _write_config_sync(config: dict) -> None:
    tmp_path = CONFIG_PATH.with_suffix(".json.tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, CONFIG_PATH)  # عملية atomic على نفس الـfilesystem


async def save_config(config: dict) -> None:
    async with CONFIG_LOCK:
        await asyncio.to_thread(_write_config_sync, config)


CONFIG = load_config()

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher(storage=MemoryStorage())

# يتعبى تلقائياً بيوزر البوت عند التشغيل (داخل main)
BOT_USERNAME: str | None = None

# طلبات /info المرسلة لبوت الـ GH بانتظار رده: key = message_id مال أمرنا، value = Future
GH_PENDING: dict[int, "asyncio.Future[str]"] = {}


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


# ==================== 3) حماية من Flood/Spam ====================

class ThrottlingMiddleware(BaseMiddleware):
    """
    يمنع أي مستخدم يرسل رسائل/ضغطات أزرار أسرع من rate_limit ثانية.
    الفكرة: تخزين آخر وقت تفاعل لكل user_id بالذاكرة، ولو الطلب الجديد
    جا أسرع من المسموح، نتجاهله بصمت (أو نرد alert خفيف بحالة الأزرار).
    مو معالجة flood متكاملة (زي Redis-backed rate limiting)، بس كافية
    لحماية البوت من استهلاك rate limit مال تليجرام API بسبب سبام بسيط.
    """

    def __init__(self, rate_limit: float = 1.0):
        self.rate_limit = rate_limit
        self.last_call: dict[int, float] = {}

    async def __call__(
        self,
        handler: Callable[[TelegramObject, Dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: Dict[str, Any],
    ) -> Any:
        user = data.get("event_from_user")
        if user is not None:
            loop = asyncio.get_event_loop()
            now = loop.time()
            last = self.last_call.get(user.id, 0.0)
            if now - last < self.rate_limit:
                if isinstance(event, CallbackQuery):
                    await event.answer("⏳ روّق شوي وجرب مرة ثانية", show_alert=False)
                return None
            self.last_call[user.id] = now
        return await handler(event, data)


dp.message.middleware(ThrottlingMiddleware(rate_limit=1.0))
dp.callback_query.middleware(ThrottlingMiddleware(rate_limit=0.5))


# ==================== قراءة معلومة من بوت خارجي (Bot-to-Bot) ====================

# نمسك أي رسالة يرسلها بوت آخر بالكروب — نستخدمها فقط إذا كانت من البوت الخارجي
# المسجل بالإعدادات (external_bot.username) وردّاً على أمرنا (هذا هو الشرط اللي
# يخلي تليكرام يوصلنا رسالة بوت ثاني حسب Bot-to-Bot Communication Mode: reply
# على رسالة من بوتنا).
@dp.message(F.from_user.is_bot)
async def handle_other_bot_message(message: Message):
    ext = CONFIG.get("external_bot", {})
    target_username = ext.get("username")
    if not target_username or not message.from_user.username:
        return
    if message.from_user.username.lower() != target_username.lower():
        return

    replied = message.reply_to_message
    if replied is None:
        return

    future = GH_PENDING.get(replied.message_id)
    if future and not future.done():
        future.set_result(message.text or message.caption or "")


async def fetch_external_bot_field(message: Message) -> tuple[str, str] | None:
    """
    يرسل أمر البوت الخارجي (external_bot.command@username) كـ reply على رسالة
    المستخدم، عشان البوت الخارجي يفهم المقصود بالأمر هو هذا المستخدم بالضبط،
    وينتظر رده (يشتغل بس بالكروبات، ولازم تكون فعّلت Bot-to-Bot Communication
    Mode لبوتك من BotFather، وحاطط إعدادات البوت الخارجي بلوحة /admin).
    يرجع (label, value) لو انسحبت القيمة من رد البوت الخارجي بنجاح، أو None.
    """
    ext = CONFIG.get("external_bot", {})
    username = ext.get("username")
    command = ext.get("command", "/info")
    pattern = ext.get("regex")
    label = ext.get("label", "قيمة")

    if not username or not pattern:
        return None
    if message.chat.type not in ("group", "supergroup"):
        return None

    # 4) حماية من تراكم لا نهائي لو صار البوت الخارجي بطيء/متوقف
    if len(GH_PENDING) >= MAX_GH_PENDING:
        logging.warning(
            "عدد طلبات GH المعلقة وصل الحد الأقصى (%s)، تجاهل طلب جديد للبوت @%s",
            MAX_GH_PENDING,
            username,
        )
        return None

    try:
        sent = await bot.send_message(
            chat_id=message.chat.id,
            text=f"{command}@{username}",
            reply_to_message_id=message.message_id,
        )
    except Exception:
        logging.exception("فشل إرسال أمر للبوت الخارجي @%s", username)
        return None

    future: "asyncio.Future[str]" = asyncio.get_event_loop().create_future()
    GH_PENDING[sent.message_id] = future
    try:
        reply_text = await asyncio.wait_for(future, timeout=GH_REPLY_TIMEOUT)
    except asyncio.TimeoutError:
        logging.warning("ما وصل رد من البوت الخارجي @%s خلال %s ثانية", username, GH_REPLY_TIMEOUT)
        return None
    finally:
        GH_PENDING.pop(sent.message_id, None)

    try:
        match = re.search(pattern, reply_text)
    except re.error:
        logging.exception("نمط regex غير صحيح بإعدادات البوت الخارجي: %r", pattern)
        return None

    if not match or not match.groups():
        return None
    return label, match.group(1)


# ==================== بناء الرسالة الغنية ====================

async def build_profile_rich_message(
    user, external_field: tuple[str, str] | None = None
) -> InputRichMessage | None:
    """
    يبني رسالة غنية (عنوان + Details/Toggle فيه معلومات المستخدم + ألبوم صور)
    لصور بروفايل مستخدم معين. يرجع None إذا ماكو صور بروفايل عند المستخدم.
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

    is_premium = bool(getattr(user, "is_premium", False))

    # فقرة المعلومات: آيدي قابل للنسخ (RichTextCode) + منشن باسمه (RichTextTextMention)
    # + اليوزرنيم + حالة البريميوم + عدد الصور، وكلها نحطها داخل Details/Toggle block
    info_paragraph = InputRichBlockParagraph(
        text=[
            "🆔 ID: ",
            RichTextCode(text=str(user.id)),
            "\n",
            "👤 Mention: ",
            RichTextTextMention(text=user.full_name, user=user),
            "\n",
            f"🔗 userName: @{user.username or 'بدون يوزر'}\n",
            f"💎 Premium: {'✅ نعم' if is_premium else '❌ لا'}\n",
            f"🔢 TotAl pfp: {photos.total_count}"
            + (f"\n💬 {external_field[0]}: {external_field[1]}" if external_field else ""),
        ]
    )

    return InputRichMessage(
        blocks=[
            InputRichBlockSectionHeading(
                text=f"📸 {user.full_name} pfp ",
                size=2,
            ),
            InputRichBlockDetails(
                summary="user info",
                blocks=[info_paragraph],
                is_open=False,
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
    external_field = await fetch_external_bot_field(message)
    rich_message = await build_profile_rich_message(user, external_field=external_field)

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
    if message.chat.type == "private":
        await message.answer("⚠️ هذا الأمر يشتغل بس داخل الكروبات، مو بالخاص.")
        return

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
    بعكس sendRichMessage وsendMediaGroup. هذا الأسلوب (receiver_user_id)
    يشتغل بس داخل الكروبات؛ بالخاص تليجرام يرفضه بخطأ
    "bot can't initiate conversation with a user".
    """
    if callback.message.chat.type == "private":
        await callback.answer("⚠️ هذا الأمر يشتغل بس داخل الكروبات.", show_alert=True)
        return

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
    waiting_ext_username = State()
    waiting_ext_command = State()
    waiting_ext_regex = State()
    waiting_ext_label = State()
    waiting_ext_test_text = State()


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
            [InlineKeyboardButton(text="🔗 ربط بوت خارجي (Info)", callback_data="admin:ext_bot")],
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
    await save_config(CONFIG)
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
    await save_config(CONFIG)
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
    await save_config(CONFIG)
    await state.clear()
    await message.answer("✅ تم إضافة/تحديث زر الترحيب.", reply_markup=admin_main_menu())


# 9) تأكيد قبل حذف زر الترحيب
@dp.callback_query(F.data == "admin:remove_welcome_button")
async def admin_remove_welcome_button_ask(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="✅ نعم، احذف الزر", callback_data="admin:remove_welcome_button_confirm")],
            [InlineKeyboardButton(text="❌ لا، رجوع", callback_data="admin:welcome_button")],
        ]
    )
    await callback.message.edit_text("⚠️ متأكد تريد تحذف زر الترحيب؟", reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data == "admin:remove_welcome_button_confirm")
async def admin_remove_welcome_button_confirm(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    CONFIG["welcome_button"] = None
    await save_config(CONFIG)
    await callback.message.edit_text("✅ تم حذف زر الترحيب.", reply_markup=admin_main_menu())
    await callback.answer()


# ---------- ربط بوت خارجي (Info) ----------

def ext_bot_status_text() -> str:
    ext = CONFIG.get("external_bot", {})
    username = ext.get("username")
    if not username:
        return "ماكو بوت خارجي مربوط حالياً."
    return (
        f"يوزرنيم البوت: @{username}\n"
        f"الأمر المُرسل: {ext.get('command', '/info')}\n"
        f"نمط القراءة (regex): {ext.get('regex')}\n"
        f"التسمية بالرسالة: {ext.get('label')}"
    )


@dp.callback_query(F.data == "admin:ext_bot")
async def admin_ext_bot_menu(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    ext = CONFIG.get("external_bot", {})
    rows = [
        [InlineKeyboardButton(text="👤 يوزرنيم البوت", callback_data="admin:set_ext_username")],
        [InlineKeyboardButton(text="⌨️ الأمر المُرسل", callback_data="admin:set_ext_command")],
        [InlineKeyboardButton(text="🧩 نمط القراءة (regex)", callback_data="admin:set_ext_regex")],
        [InlineKeyboardButton(text="🏷️ التسمية بالرسالة", callback_data="admin:set_ext_label")],
    ]
    if ext.get("username"):
        rows.append([InlineKeyboardButton(text="🗑️ إلغاء الربط", callback_data="admin:remove_ext_bot")])
    rows.append([InlineKeyboardButton(text="🧪 اختبار النمط على نص", callback_data="admin:test_ext_regex")])
    rows.append([InlineKeyboardButton(text="⬅️ رجوع", callback_data="admin:back")])
    await callback.message.edit_text(
        "🔗 ربط بوت خارجي (زي Group Help أو أي بوت ثاني)\n\n"
        f"{ext_bot_status_text()}\n\n"
        "لما تربطه، أمر /id (بالكروب بس) راح يرسل الأمر تلقائياً للبوت المربوط "
        "ويقرا قيمة من رده حسب نمط الـregex ويحطها بمعلومات المستخدم.\n\n"
        "⚠️ لازم تكون مفعّل Bot-to-Bot Communication Mode لبوتك من BotFather "
        "(mybots -> بوتك -> Bot Settings)، وإلا ما راح توصلك ردود من البوت الثاني.\n\n"
        "🔄 عشان تبدل لبوت ثاني بالمستقبل: بس غيّر اليوزرنيم والأمر والـregex "
        "والتسمية من هنا — ماكو داعي تلمس الكود.",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=rows),
    )
    await callback.answer()


@dp.callback_query(F.data == "admin:set_ext_username")
async def admin_set_ext_username_prompt(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        return
    await state.set_state(EditStates.waiting_ext_username)
    await callback.message.edit_text("✍️ ارسل يوزرنيم البوت الخارجي بدون @ (مثلاً: GroupHelpBot)")
    await callback.answer()


@dp.message(EditStates.waiting_ext_username)
async def save_ext_username(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    CONFIG.setdefault("external_bot", {})["username"] = message.text.strip().lstrip("@")
    await save_config(CONFIG)
    await state.clear()
    await message.answer("✅ تم حفظ يوزرنيم البوت الخارجي.", reply_markup=admin_main_menu())


@dp.callback_query(F.data == "admin:set_ext_command")
async def admin_set_ext_command_prompt(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        return
    await state.set_state(EditStates.waiting_ext_command)
    await callback.message.edit_text(
        "⌨️ ارسل الأمر اللي ينرسل للبوت الخارجي (بدون @username، ينضاف تلقائياً).\n"
        "مثال: /info أو /stats أو /whois"
    )
    await callback.answer()


@dp.message(EditStates.waiting_ext_command)
async def save_ext_command(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    command = message.text.strip()
    if not command.startswith("/"):
        command = "/" + command
    CONFIG.setdefault("external_bot", {})["command"] = command
    await save_config(CONFIG)
    await state.clear()
    await message.answer("✅ تم حفظ الأمر.", reply_markup=admin_main_menu())


@dp.callback_query(F.data == "admin:set_ext_regex")
async def admin_set_ext_regex_prompt(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        return
    await state.set_state(EditStates.waiting_ext_regex)
    await callback.message.edit_text(
        "🧩 ارسل نمط الـregex اللي يسحب القيمة من رد البوت الخارجي.\n"
        "لازم يحتوي مجموعة وحدة () حوالين القيمة المطلوبة.\n\n"
        r"مثال (لبوت GH): عدد الرسائل:\s*([\d,]+)"
    )
    await callback.answer()


@dp.message(EditStates.waiting_ext_regex)
async def save_ext_regex(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    pattern = message.text.strip()
    try:
        compiled = re.compile(pattern)
    except re.error as e:
        await message.answer(f"❌ نمط regex غير صحيح: {e}\nجرب مرة ثانية:")
        return
    if compiled.groups < 1:
        await message.answer("❌ النمط لازم يحتوي مجموعة وحدة () حوالين القيمة. جرب مرة ثانية:")
        return
    CONFIG.setdefault("external_bot", {})["regex"] = pattern
    await save_config(CONFIG)
    await state.clear()
    await message.answer("✅ تم حفظ نمط القراءة.", reply_markup=admin_main_menu())


@dp.callback_query(F.data == "admin:set_ext_label")
async def admin_set_ext_label_prompt(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        return
    await state.set_state(EditStates.waiting_ext_label)
    await callback.message.edit_text("🏷️ ارسل التسمية اللي تنعرض جنب القيمة بالرسالة (مثلاً: عدد الرسائل)")
    await callback.answer()


@dp.message(EditStates.waiting_ext_label)
async def save_ext_label(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    CONFIG.setdefault("external_bot", {})["label"] = message.text.strip()
    await save_config(CONFIG)
    await state.clear()
    await message.answer("✅ تم حفظ التسمية.", reply_markup=admin_main_menu())


# 9) تأكيد قبل فك ربط البوت الخارجي
@dp.callback_query(F.data == "admin:remove_ext_bot")
async def admin_remove_ext_bot_ask(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="✅ نعم، افك الربط", callback_data="admin:remove_ext_bot_confirm")],
            [InlineKeyboardButton(text="❌ لا، رجوع", callback_data="admin:ext_bot")],
        ]
    )
    await callback.message.edit_text("⚠️ متأكد تريد تفك ربط البوت الخارجي؟", reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data == "admin:remove_ext_bot_confirm")
async def admin_remove_ext_bot_confirm(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    CONFIG["external_bot"]["username"] = None
    await save_config(CONFIG)
    await callback.message.edit_text("✅ تم إلغاء ربط البوت الخارجي.", reply_markup=admin_main_menu())
    await callback.answer()


@dp.callback_query(F.data == "admin:test_ext_regex")
async def admin_test_ext_regex_prompt(callback: CallbackQuery, state: FSMContext):
    if not is_admin(callback.from_user.id):
        return
    pattern = CONFIG.get("external_bot", {}).get("regex")
    if not pattern:
        await callback.answer("⚠️ ماكو نمط regex محفوظ حالياً", show_alert=True)
        return
    await state.set_state(EditStates.waiting_ext_test_text)
    await callback.message.edit_text(
        "🧪 الصق هسه نص رد البوت الآخر كامل (نفس الشي اللي يوصلك بالضبط، "
        "بما فيه أي فراغات أو رموز خفية)، وراح أختبر عليه النمط الحالي:\n\n"
        f"`{pattern}`",
        parse_mode="Markdown",
    )
    await callback.answer()


@dp.message(EditStates.waiting_ext_test_text)
async def run_ext_regex_test(message: Message, state: FSMContext):
    if not is_admin(message.from_user.id):
        return
    await state.clear()
    pattern = CONFIG.get("external_bot", {}).get("regex")
    sample = message.text or ""

    try:
        match = re.search(pattern, sample)
    except re.error as e:
        await message.answer(f"❌ النمط نفسه غير صحيح: {e}", reply_markup=admin_main_menu())
        return

    if match and match.groups():
        await message.answer(
            f"✅ نجح الاستخراج!\nالقيمة اللي طلعت: `{match.group(1)}`",
            parse_mode="Markdown",
            reply_markup=admin_main_menu(),
        )
    else:
        await message.answer(
            "❌ ما انسحبت أي قيمة من النص.\n\n"
            "أسباب شائعة:\n"
            "• التسمية بالنص مو مطابقة 100% للي بالنمط (مثلاً فرق بمسافة أو "
            "رمز خفي غير مرئي زي RLM/⁣ اللي تحطه بعض البوتات حوالين الأرقام والتواريخ)\n"
            "• النمط يفتش عن أرقام بس `[\\d,]+` بينما القيمة نص عادي، أو العكس\n"
            "• ناقص `()` حوالين الجزء اللي تريد تسحبه\n\n"
            "جرب تعدل النمط من '🧩 نمط القراءة' وارجع اختبره.",
            reply_markup=admin_main_menu(),
        )


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
        await save_config(CONFIG)
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
        [InlineKeyboardButton(text=f"🗑️ {a}", callback_data=f"admin:del_alias_ask:{key}:{i}")]
        for i, a in enumerate(aliases)
    ]
    rows.append([InlineKeyboardButton(text="⬅️ رجوع", callback_data=f"admin:alias_cmd:{key}")])
    await callback.message.edit_text("اختار الكلمة اللي تريد تحذفها:", reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))
    await callback.answer()


# 9) تأكيد قبل حذف الكلمة المفتاحية
@dp.callback_query(F.data.startswith("admin:del_alias_ask:"))
async def admin_delete_alias_ask(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    _, _, key, index_str = callback.data.split(":")
    index = int(index_str)
    aliases = CONFIG["aliases"].get(key, [])
    if not (0 <= index < len(aliases)):
        await callback.answer("⚠️ ما كدرنا نلقى الكلمة")
        return
    word = aliases[index]
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="✅ نعم، احذف", callback_data=f"admin:del_alias_confirm:{key}:{index}")],
            [InlineKeyboardButton(text="❌ لا، رجوع", callback_data=f"admin:del_alias_menu:{key}")],
        ]
    )
    await callback.message.edit_text(f'⚠️ متأكد تريد تحذف الكلمة "{word}"؟', reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data.startswith("admin:del_alias_confirm:"))
async def admin_delete_alias_confirm(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return
    _, _, key, index_str = callback.data.split(":")
    index = int(index_str)
    aliases = CONFIG["aliases"].get(key, [])
    if 0 <= index < len(aliases):
        removed = aliases.pop(index)
        await save_config(CONFIG)
        await callback.answer(f'تم حذف "{removed}"')
    else:
        await callback.answer("⚠️ ما كدرنا نلقى الكلمة")

    text, keyboard = alias_command_menu_text_and_keyboard(key)
    await callback.message.edit_text(text, reply_markup=keyboard)


# ==================== 8) معالج أخطاء عام لكل الـhandlers ====================

@dp.errors()
async def global_error_handler(event: ErrorEvent):
    """
    يمسك أي استثناء غير متوقع يصير داخل أي handler (مو بس أخطاء تحليل
    التحديثات اللي يمسكها safe_polling)، يسجله باللوگ، ويبلغ المطور
    مباشرة بدل ما يضيع بصمت بملف اللوگ بس.
    """
    exception = event.exception
    update = event.update
    update_id = getattr(update, "update_id", "؟")

    logging.exception("خطأ غير متوقع بمعالجة Update رقم %s", update_id, exc_info=exception)

    error_text = str(exception)
    if len(error_text) > 600:
        error_text = error_text[:600] + "…"

    text = (
        f"🔴 خطأ غير متوقع داخل handler لـUpdate رقم {update_id}\n\n"
        f"نوع الخطأ: {type(exception).__name__}\n"
        f"التفاصيل:\n{error_text}"
    )
    try:
        await bot.send_message(chat_id=DEV_ALERT_CHAT_ID, text=text)
    except Exception:
        logging.exception("فشل إرسال تنبيه خطأ الـhandler للمطور")

    return True  # نعتبر الخطأ متعامل معه، ما نرفعه ثانية


# ==================== Polling آمن يتجاوز تحديثات مكسورة بصمت ====================

def extract_update_debug_info(raw_update: dict) -> str:
    """يستخرج معلومات المستخدم/المحادثة من الـraw JSON مباشرة (قبل أي تحليل)،
    عشان نقدر نطلعها حتى لو الـupdate نفسه فشل بالتحليل."""
    container = (
        raw_update.get("guest_message")
        or raw_update.get("message")
        or raw_update.get("edited_message")
        or raw_update.get("channel_post")
        or {}
    )
    user = container.get("from") or raw_update.get("guest_bot_caller_user") or {}
    chat = container.get("chat", {})

    user_id = user.get("id", "؟")
    username = user.get("username", "بدون يوزر")
    first_name = user.get("first_name", "؟")

    chat_id = chat.get("id", "؟")
    chat_title = chat.get("title") or chat.get("first_name", "خاص")
    chat_type = chat.get("type", "؟")

    update_keys = ", ".join(k for k in raw_update.keys() if k != "update_id")

    return (
        f"🆔 آيدي المستخدم: {user_id}\n"
        f"👤 الاسم: {first_name} (@{username})\n"
        f"💬 المحادثة: {chat_title} (النوع: {chat_type}, آيدي: {chat_id})\n"
        f"📦 حقول الـupdate: {update_keys}"
    )


async def notify_dev_broken_update(update_id: int, error: Exception, raw_update: dict):
    """يرسل تنبيه تفصيلي للمطور عن تحديث فشل تحليله، بدون ما يوقف الـpolling."""
    info = extract_update_debug_info(raw_update)
    error_text = str(error)
    if len(error_text) > 600:
        error_text = error_text[:600] + "…"

    text = (
        f"⚠️ Update رقم {update_id} فشل تحليله وتم تخطيه بصمت\n\n"
        f"{info}\n\n"
        f"نوع الخطأ: {type(error).__name__}\n"
        f"التفاصيل:\n{error_text}"
    )
    try:
        await bot.send_message(chat_id=DEV_ALERT_CHAT_ID, text=text)
    except Exception:
        logging.exception("فشل إرسال تنبيه المطور عن Update رقم %s", update_id)


async def safe_polling(bot: Bot, dp: Dispatcher):
    """
    Polling مخصص بديل عن dp.start_polling الافتراضي: يجيب التحديثات كـraw
    JSON مباشرة، ويحاول يعمل validate لكل تحديث لحاله (مو للباتش كامل).
    لو تحديث معين فشل تحليله (مثلاً نوع بلوك جديد غير مدعوم بنسخة aiogram
    الحالية)، يرسل تنبيه تفصيلي للمطور بمعلومات السياق ويتخطاه بصمت،
    بدون ما يوقف باقي التحديثات أو يعلّق البوت بلوپ أخطاء لا نهائي.

    7) يميّز 409 Conflict (نسخة ثانية من البوت شغالة بنفس الوقت) عن باقي
    أخطاء الـAPI ويعالجه بانتظار أطول بدل ما يعيد المحاولة بسرعة.
    """
    api_url = f"https://api.telegram.org/bot{bot.token}/getUpdates"
    offset = None

    async with aiohttp.ClientSession() as session:
        while True:
            params = {"timeout": 30}
            if offset is not None:
                params["offset"] = offset

            try:
                async with session.get(
                    api_url, params=params, timeout=aiohttp.ClientTimeout(total=40)
                ) as resp:
                    data = await resp.json()
            except Exception:
                logging.exception("فشل الاتصال بـgetUpdates، إعادة محاولة بعد 5 ثواني")
                await asyncio.sleep(5)
                continue

            if not data.get("ok"):
                error_code = data.get("error_code")
                description = data.get("description", "")
                if error_code == 409:
                    logging.error(
                        "🔴 409 Conflict: يبدو انو فيه نسخة ثانية من البوت شغالة بنفس "
                        "الوقت (instance ثاني بولنگ). وصف تليجرام: %s",
                        description,
                    )
                    await asyncio.sleep(10)
                else:
                    logging.warning("رد غير ناجح من getUpdates: %s", data)
                    await asyncio.sleep(5)
                continue

            for raw_update in data.get("result", []):
                update_id = raw_update["update_id"]
                offset = update_id + 1

                try:
                    update = Update.model_validate(raw_update)
                except ValidationError as e:
                    logging.warning("تخطي Update رقم %s بسبب خطأ تحليل: %s", update_id, e)
                    asyncio.create_task(notify_dev_broken_update(update_id, e, raw_update))
                    continue
                except Exception as e:
                    logging.exception("خطأ غير متوقع بتحليل Update رقم %s", update_id)
                    asyncio.create_task(notify_dev_broken_update(update_id, e, raw_update))
                    continue

                try:
                    # أي استثناء يصير داخل الـhandlers نفسها يوصل تلقائياً
                    # لمعالج @dp.errors() اللي عرفناه فوق ويبلغ المطور هناك.
                    await dp.feed_update(bot, update)
                except Exception:
                    logging.exception(
                        "خطأ غير متوقع أثناء feed_update لـUpdate رقم %s (خارج نطاق "
                        "معالج @dp.errors)",
                        update_id,
                    )


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

    await safe_polling(bot, dp)


if __name__ == "__main__":
    asyncio.run(main())