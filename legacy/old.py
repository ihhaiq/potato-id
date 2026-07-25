"""
بوت تليكرام (aiogram >= 3.30.0) يستخدم ميزة "Rich Messages" الجديدة
(Bot API 10.1 / 10.2) لإرسال رسالة غنية واحدة تحتوي:
  - عنوان (Heading)
  - فقرة نص
  - ألبوم صور (Collage) = صور بروفايل المستخدم

⚠️ ملاحظة مهمة: هاي الميزة نزلت بتليكرام قبل أسابيع بس (منتصف يوليو 2026)
لازم يكون عندك:
    pip install -U aiogram   # تأكد النسخة >= 3.30.0

التشغيل:
    export BOT_TOKEN="التوكن مالك"
    python profile_rich_message_bot.py
"""

import asyncio
import logging
import os

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
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

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# يتعبى تلقائياً بيوزر البوت عند التشغيل (داخل main)، نستخدمه بفلترة وضع الضيف
BOT_USERNAME: str | None = None


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
        best_quality = photo_sizes[-1]  # أعلى دقة متوفرة لهاي الصورة
        photo_blocks.append(
            InputRichBlockPhoto(photo=InputMediaPhoto(media=best_quality.file_id))
        )

    return InputRichMessage(
        blocks=[
            InputRichBlockSectionHeading(
                text=f"📸 صور البروفايل مال {user.full_name}",
                size=2,
            ),
            InputRichBlockParagraph(
                text=(
                    f"👤 يوزر: @{user.username or 'بدون يوزر'}\n"
                    f"🔢 العدد الكلي: {photos.total_count}"
                )
            ),
            InputRichBlockSlideshow(blocks=photo_blocks),  # وضع الألبوم (تمرير)
        ]
    )


@dp.message(Command("start"))
async def cmd_start(message: Message):
    await message.answer(
        "👋 هلا وغلا بيك!\n\n"
        "أنا بوت أسوي رسائل غنية بصور بروفايلك.\n\n"
        "📌 الأوامر المتوفرة:\n"
        "/id — يرسل رسالة غنية بألبوم صور بروفايلك (تشتغل بالخاص وبالكروبات)\n"
        "/secret — مثال على رسالة مؤقتة (يشوفها بس الشخص اللي طلبها)\n\n"
        "💡 تكدر تسولف وياي بأي كروب ثاني بدون ما أكون عضو فيه، "
        + (f"بس اكتب يوزري @{BOT_USERNAME} 😉" if BOT_USERNAME else "بس اكتب يوزري 😉")
    )


@dp.message(Command("id"))
async def send_profile_rich_message(message: Message):
    user = message.from_user

    rich_message = await build_profile_rich_message(user)

    if rich_message is None:
        await message.answer(
            "❌ ماكو صور بروفايل عندك، خل عندك صورة بروفايل وجرب مرة ثانية."
        )
        return

    await bot.send_rich_message(chat_id=message.chat.id, rich_message=rich_message)


def is_explicit_username_mention(message: Message) -> bool:
    """
    يتأكد ان الرسالة فيها منشن صريح ليوزر البوت مكتوب بالنص (@BotUsername)،
    مو مجرد رد (reply) على رسالة قديمة للبوت.
    """
    if not message.text or not BOT_USERNAME:
        return False

    target = f"@{BOT_USERNAME}".lower()

    # 1) نتأكد عن طريق الـentities (أدق طريقة)
    for entity in message.entities or []:
        if entity.type == "mention":
            mention_text = message.text[entity.offset : entity.offset + entity.length]
            if mention_text.lower() == target:
                return True

    # 2) خط دفاع ثاني: فحص نصي مباشر لو ماكو entities لأي سبب
    return target in message.text.lower()


@dp.guest_message()
async def handle_guest_mention(message: Message):
    """
    ينفذ هذا الهاندلر لما شخص يذكر يوزر البوت (@yourbot) بأي محادثة،
    حتى لو البوت مو عضو بيها.
    ملاحظة: هذا رد وحيد بس (مو محادثة مستمرة) عن طريق answer_guest_query.
    """
    # نتجاهل كلشي إلا إذا كان منشن صريح ليوزر البوت (مو رد على رسالة قديمة)
    if not is_explicit_username_mention(message):
        logging.info("🚫 تجاهلت guest_message (مو منشن صريح ليوزر البوت): %r", message.text)
        return

    caller = message.guest_bot_caller_user or message.from_user

    if caller is None:
        return  # حالة نادرة: ما نعرف مين استدعى البوت

    rich_message = await build_profile_rich_message(caller)

    if rich_message is None:
        # الشخص اللي منشن البوت ماله صورة بروفايل
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
        ),
    )


@dp.message(Command("secret"))
async def cmd_secret(message: Message):
    """
    مثال على الرسائل المؤقتة (Ephemeral Messages).
    نحط زر إنلاين، ولما المستخدم يضغطه نرسله رسالة بس هو يشوفها
    (باقي أعضاء الكروب ما يشوفونها إطلاقاً).
    """
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🤫 اضغط تشوف السر", callback_data="show_secret")]
        ]
    )
    await message.answer(
        "بالأسفل زر — بس اللي يضغطه راح يشوف رسالة سرية له وحده 👇",
        reply_markup=keyboard,
    )


@dp.callback_query(F.data == "show_secret")
async def handle_secret_callback(callback: CallbackQuery):
    """
    هنا نرسل الرسالة المؤقتة الفعلية: صورة البروفايل الحالية (الرئيسية)
    للشخص اللي ضغط الزر — بس هو يشوفها.

    ملاحظة: sendPhoto يدعم receiver_user_id/callback_query_id،
    بعكس sendRichMessage وsendMediaGroup اللي ما يدعمونهم لهسه.
    فلو تريد "ألبوم" مؤقت كامل، تليكرام حالياً ما يوفرها بنداء وحد.
    """
    user = callback.from_user

    # نجيب صور بروفايل المستخدم، وناخذ الصورة الأولى (الحالية/الرئيسية) بأعلى دقة
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

    current_photo = photos.photos[0][-1]  # أعلى دقة للصورة الحالية

    await bot.send_photo(
        chat_id=callback.message.chat.id,
        photo=current_photo.file_id,
        caption=(
                f"🤫 This is your pfp, {user.full_name}!\n"

"The rest of the group members can't see this message at all."
            ),
        receiver_user_id=user.id,
        callback_query_id=callback.id,
    )
    await callback.answer()


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

    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())