# 🤖 IT Content Creator & News Digest Agent

Telegram uchun shaxsiy avtomatlashtirish tizimi. Tizim IT yangiliklar materialini yig'adi, Gemini AI yordamida o'zbek tilidagi blog postini qoralaydi, qoralamani tasdiqlash uchun egasiga yuboradi va tasdiqlangandan so'ng kanalga e'lon qiladi.

---

## Qanday ishlaydi

```
Cron / /generate / /write
       │
       ▼
 [UserBot] SOURCE_CHATS'dan xabarlar o'qiydi
 [RSS]     Yangilik tasmalari yuklanadi
 [Web]     Maqola havolalari o'rganiladi
       │
       ▼
 [Gemini]  O'zbek tilida sifatli post qoralaydi
       │
       ▼
 [Bot]     Egasiga qoralama + boshqaruv tugmalarini yuboradi
       │
   ┌───┴───────────────────────┐
   │ ✅ Tasdiqlash             │ 🔄 Qayta yozish
   ▼                           ▼
Kanalga matn chiqadi        Yangi versiya
```

Hech narsa tasdiqlashsiz e'lon qilinmaydi.

---

## O'rnatish

### 1. Talablar

- **Node.js 20+**
- Telegram ilovasi (telefon raqamingiz)
- [my.telegram.org](https://my.telegram.org) API kalitlari
- Telegram kanalida admin bo'lgan bot
- Google Gemini API kaliti

### 2. Paketlarni o'rnatish

```bash
npm install
```

### 3. `.env` faylini sozlash

```bash
cp .env.example .env
```

`.env` faylini oching va quyidagilarni to'ldiring:

---

## Har bir kalitni qayerdan olish mumkin

### `TG_API_ID` va `TG_API_HASH`

1. [my.telegram.org](https://my.telegram.org) ga kiring
2. "API development tools" bo'limiga o'ting
3. Ilova yarating (nom va platforma muhim emas)
4. `api_id` va `api_hash` ni ko'chirib oling

### `BOT_TOKEN`

1. Telegram'da [@BotFather](https://t.me/BotFather) ga yozing
2. `/newbot` buyrug'ini yuboring
3. Bot nomi va username kiriting
4. Berilgan tokenni ko'chirib oling

### `MY_CHAT_ID`

1. Telegram'da [@userinfobot](https://t.me/userinfobot) ga yozing
2. `/start` yuboring — u sizning ID raqamingizni ko'rsatadi

### `CHANNEL_USERNAME`

Kanalingizning username'i, masalan: `@my_it_channel`

### `GEMINI_API_KEY`

1. [aistudio.google.com/apikey](https://aistudio.google.com/apikey) ga o'ting
2. "Create API key" tugmasini bosing

---

## Botni kanalga admin qilish

1. Kanalingizga o'ting → ⋮ → **Manage channel** (yoki Admins)
2. **Add administrator** → Botingizni toping
3. Faqat **Post Messages** huquqini bering
4. Saqlang

---

## Birinchi ishga tushirish

### 1. Telegram sessiyasini yaratish

```bash
npm run login
```

Telefon raqamingizni, SMS kodni va (kerak bo'lsa) 2FA parolini kiriting.  
Chiqarilgan `TG_SESSION` stringini `.env` fayliga qo'ying.

> ⚠️ Bu string Telegram hisobingizga to'liq kirish imkonini beradi. Uni hech kimga bermang!

### 2. SOURCE_CHATS ni sozlash

`.env` faylida qaysi kanallardan xabar o'qishni belgilang:

```
SOURCE_CHATS=techcrunchrus,hackernews_uz,it_news_uz
```

Usernameni `@` belgisisiz yozing. **Tizim faqat shu ro'yxatdagi kanallardan o'qiydi** — boshqa chatlarga kirmaydi.

### 3. Botni ishga tushirish

```bash
npm start
```

Bot ishga tushgach, Telegram'da botingizga `/start` yuboring.

### 4. Test qilish

```
/generate
```

Bu buyruq pipeline ni darhol ishga tushiradi. Bir necha soniyadan so'ng sizga qoralama xabar keladi.

---

## Kanal eksportlarini qo'shish (uslub namunalari)

Tizimga o'z kanal postlaringizning uslubini o'rgatish uchun:

1. **Telegram Desktop** ni oching
2. Kanalingizga o'ting
3. ⋮ (uchta nuqta) → **Export chat history**
4. Sozlamalar:
   - Format: **JSON**
   - Media: **OFF** (kerak emas)
5. Yuklab olingan `result.json` faylini `data/exports/` papkasiga qo'ying

Bot qayta ishga tushganda uslub namunalarini avtomatik yuklaydi. Bir nechta `.json` fayl qo'yish mumkin.

---

## 24/7 serverda ishlatish (PM2)

```bash
# PM2 o'rnatish
npm install -g pm2

# Agentni ishga tushirish
pm2 start npm --name "it-agent" -- start

# Avtomatik ishga tushishni sozlash
pm2 save
pm2 startup

# Loglarni ko'rish
pm2 logs it-agent
```

---

## Bot buyruqlari

| Buyruq | Vazifasi |
|--------|----------|
| `/start` | Bosh menyu va yordam |
| `/digest` | **Shaxsiy Dayjest** — telegramingiz tahlilini hoziroq olish |
| `/digest_status` | Shaxsiy dayjest holati va oxirgi hisobot vaqti |
| `/generate` | Kanal uchun yangi blog qoralama post yaratish |
| `/status` | Blog statistikasi va kutayotgan qoralamalar |

### Qoralama bilan ishlash

Qoralama kelgach, sizda ikkita tugma bo'ladi:

- **✅ Tasdiqlash va chiqarish** — postni kanalga e'lon qiladi
- **🔄 Qayta yozish** — yangi versiya tayyorlaydi (maksimal 5 marta)

Qoralama xabariga **javob yozsangiz** — u izoh sifatida qabul qilinadi va AI shu izohi asosida qayta yozadi:

```
Qisqaroq qil
```
```
Sarlavhani yanada qiziqarli qil
```

---

## 🔒 Shaxsiy Dayjest Agent (Personal Digest)

Ushbu funksiya blog quvuridan (blog-post pipeline) **butunlay mustaqil** ishlaydi. U hisob egasining butun Telegram akkauntini (obuna bo'lgan ommaviy kanallar, guruhlar hamda shaxsiy yozishmalarni) tahlil qiladi va hisobotni **FAQAT VA FAQAT** egasining shaxsiy chatiga (`MY_CHAT_ID`) yuboradi.

> [!IMPORTANT]
> **Hech qachon kanalga chiqmaydi!** Dayjest ma'lumotlari umumiy kanalga aslo chiqarilmaydi va dayjest xabarlarida "Tasdiqlash va chiqarish" kabi tugmalar bo'lmaydi.

### Dayjest nimalarni hisobot qiladi:

1. **🔥 Muhim** — Muddatlar (deadline), uchrashuvlar, ish/HR xabarlari, to'lovlar, berilgan va'dalar yoki muhim qarorlar.
2. **⚠️ Shubhali** — Firibgarlik ehtimoli bo'lgan xabarlar (pul, karta yoki tasdiqlash kodi so'rash, shoshiltirish va bosim, g'alati qisqa havolalar, avans evaziga ish va'dalari, kripto/investitsiya takliflari, begona raqamdan tanish qiyofasida yozish, .apk/.exe fayllar).
3. **💬 Javob kutilmoqda** — Sizdan javob kutayotgan aniq savollar.
4. **🎯 Senga kerakli** — Guruh va kanallardan sizning qiziqishlaringizga (`USER_INTERESTS`) mos keladigan foydali xabar va imkoniyatlar.
5. **📚 Guruh va kanallarda nima bo'ldi** — Har bir chat bo'yicha muhokama qilingan 1–3 ta asosiy mavzular.
6. **📈 Umumiy trendlar** — Guruhlar va kanallardagi 2–4 ta umumiy tendensiya.

Agar tahlil davrida hech qanday muhim narsa topilmasa, bot shunchaki `Yangi muhim narsa yo'q ✅` deb xabar beradi.

### Maxfiylik va Xavfsizlik Kafolatlari (Privacy by Design):

- **Ismlar va IDlar sir tutiladi:** AIga yuboriladigan materialda hech qanday haqiqiy ism, username yoki raqamli ID qatnashmaydi. Chatlar `K1`, `G1`, `S1` kabi anonim belgilanadi.
- **Maxfiy ma'lumotlar avtomatik filtrlanadi (`redact`):**
  - Emaillar → `[email]`
  - Telefon raqamlari → `[tel]`
  - Karta raqamlari (13-19 xonali) → `[karta]`
  - 24+ xonali API tokenlar / parollar → `[token]`
  - Mustaqil 4-8 xonali tasdiqlash kodlari → `[kod]`
  - *Eslatma:* Dayjestda kod/parol so'ralgan xabarlar tashlab yuborilmaydi (chunki birov sizdan kod so'rashi — yaqqol fishing alomati), faqat sirlarning o'zi niqoblanadi.
- **Bazada xabar matnlari saqlanmaydi:** SQLite ma'lumotlar bazasida yoki doimiy fayllarda shaxsiy xabarlar umuman saqlanmaydi (faqat oxirgi tahlil vaqti `kv` jadvalida yoziladi).
- **Haqiqiy matnlar faqat xotirada (RAM):** Hisobot tuzilayotganda asl matndan 200 belgilik qisqa ko'chirma xotiradagi vaqtinchalik xaritalash (in-memory lookup) orqali tiklanadi.

### Sozlash va nazorat qilish:

- **Shaxsiy chatlar tahlilini butunlay o'chirish:**
  `.env` faylida `DIGEST_INCLUDE_PRIVATE=false` deb belgilasangiz, shaxsiy yozishmalar umuman o'qilmaydi va tahlil qilinmaydi.
- **Ayrim chatlarni istisno qilish (`EXCLUDE_CHATS`):**
  Tahlildan butunlay chetlatmoqchi bo'lgan shaxslar yoki kanallar usernamelarini, nomlarini yoki ID raqamlarini vergul bilan yozing:
  ```env
  EXCLUDE_CHATS=my_secret_group,john_doe,123456789
  ```
- **Blog quvurini o'chirib qo'yish:**
  Agar faqat Shaxsiy Dayjest kerak bo'lsa va kanalda avtomatik postlar kerak bo'lmasa:
  ```env
  BLOG_ENABLED=false
  ```

---

## `.env` sozlamalari

| Kalit | Tavsif | Standart |
|-------|--------|----------|
| `TG_API_ID` | Telegram API ID | majburiy |
| `TG_API_HASH` | Telegram API Hash | majburiy |
| `TG_SESSION` | GramJS sessiya stringi | majburiy |
| `BOT_TOKEN` | @BotFather tokeni | majburiy |
| `MY_CHAT_ID` | Sizning Telegram user ID'ingiz | majburiy |
| `CHANNEL_USERNAME` | Kanal username (@bilan) | majburiy |
| `GEMINI_API_KEY` | Google Gemini API kaliti | majburiy |
| `GEMINI_MODEL` | Gemini modeli | `gemini-2.5-flash` |
| `BLOG_ENABLED` | Blog-post quvurini yoqish/o'chirish | `true` |
| `CRON_EXPR` | Blog posti jadvali (cron format) | `0 20 * * 1,3,5` |
| `DIGEST_CRON` | Shaxsiy Dayjest jadvali (har kuni 21:00) | `0 21 * * *` |
| `DIGEST_MAX_DAYS` | Dayjest uchun orqaga qarash kunlar chegarasi | `3` |
| `DIGEST_INCLUDE_PRIVATE` | Shaxsiy (private user) yozishmalarni tahlil qilish | `true` |
| `EXCLUDE_CHATS` | Tahlilga kiritilmaydigan chatlar (vergul bilan) | — |
| `MAX_DIALOGS` | Tahlil qilinadigan maksimal dialoglar | `80` |
| `USER_INTERESTS` | Kanal/guruhlardan ajratiladigan qiziqishlar | IT yo'nalishlari |
| `SOURCE_CHATS` | Blog uchun ommaviy kanallar (vergul bilan) | — |
| `RSS_FEEDS` | Qo'shimcha RSS manzillar | — |
| `LOOKBACK_DAYS` | Blog uchun necha kunlik xabarlar | `3` |
| `TIMEZONE` | Vaqt mintaqasi | `Asia/Tashkent` |
| `MAX_REWRITES` | Bitta qoralama uchun maksimal qayta yozish | `5` |
| `DB_PATH` | Ma'lumotlar bazasi manzili | `./data/agent.db` |
| `EXPORTS_DIR` | Kanal eksportlari papkasi | `./data/exports` |

---

## Muhim eslatmalar

> [!WARNING]
> **AI faktlarni ixtiro qilishi mumkin.** Har doim qoralamani diqqat bilan o'qing va faqat to'g'ri ma'lumot bo'lsa tasdiqlang.

> [!CAUTION]
> **`TG_SESSION`** Telegram hisobingizga to'liq kirish imkonini beradi. Uni `.env` faylida saqlang, hech qachon ommaviy repozitoriyga yuklamang.

> [!NOTE]
> Boshqa kanallarning postlarini ko'chirib e'lon qilmang — bu Telegram qoidalariga zid.

> [!TIP]
> `RSS_FEEDS` ga o'zbek tilli IT manbalarini qo'shib, materialni boyitish mumkin.

