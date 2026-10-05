# 🌐 Alwaysdata Hostingda aiSupport Botini 24/7 Ishga Tushirish Qo'llanmasi

Ushbu qo'llanma orqali **aiSupport** loyihasini [Alwaysdata](https://www.alwaysdata.com/) bepul yoki pullik hostingida 24/7 uzluksiz ishlaydigan qilib sozlash mumkin.

---

## 📋 1-Qadam: Alwaysdata Panelida Node.js Versiyasini Sozlash

> [!IMPORTANT]
> Loyihamizda eng yangi va tezkor `node:sqlite` ishlatilganligi sababli, Node.js versiyasi **kamida 22.5+** bo'lishi shart.

1. [Alwaysdata boshqaruv paneliga](https://admin.alwaysdata.com/) kiring.
2. Chap menyudan **Environment** ➔ **Node.js** bo'limiga o'ting.
3. Node.js ning standart versiyasini **`22`** (LTS) qilib tanlang va **Submit** tugmasini bosing.

---

## 🔑 2-Qadam: SSH Kirishni Faollashtirish

1. Chap menyudan **Remote access** ➔ **SSH** bo'limiga kiring.
2. O'z hisobingiz uchun parol o'rnating yoki SSH kalitingizni qo'shing.
3. Kompyuteringiz terminalidan (Git Bash yoki PowerShell) quyidagi buyruq orqali serverga kiring:
   ```bash
   ssh sizning_akkauntingiz@ssh-sizning_akkauntingiz.alwaysdata.net
   ```
   *(Masalan: `ssh asadbek@ssh-asadbek.alwaysdata.net`)*

---

## 📂 3-Qadam: Loyihani Serverga Yuklash

SSH terminalida quyidagi buyruqlarni bajaring:

```bash
# 1. Loyihani GitHub dan klonlab oling:
git clone https://github.com/asadbekumarov/aiSupport.git aiSupport

# 2. Papkaga kiring:
cd aiSupport

# 3. Paketlarni o'rnating:
npm install
```

---

## ⚙️ 4-Qadam: .env Faylini To'ldirish

Kompyuteringizdagi sozlangan barcha kalitlarni serverga nusxalash kerak:

```bash
nano .env
```
Ochilgan ekranga kompyuteringizdagi `.env` fayli ichidagi barcha ma'lumotlarni (TG_API_ID, TG_SESSION, BOT_TOKEN, GEMINI_API_KEY va boshqalar) qo'ying.
Saqlash uchun: **Ctrl + O**, so'ng **Enter**, chiqish uchun: **Ctrl + X**.

---

## 🚀 5-Qadam: Botni 24/7 Uzluksiz Ishga Tushirish

Buning uchun **2 xil yo'l** bor:

### 1-Usul: Alwaysdata Paneli orqali (Eng oson va avtomatik)
1. Alwaysdata panelida **Advanced** ➔ **Services** bo'limiga o'ting.
2. **Add a service** tugmasini bosing:
   * **Name**: `ai-support-bot`
   * **Command**: `/usr/bin/node index.js`
   * **Working directory**: `/home/sizning_akkauntingiz/aiSupport`
   * **Environment variables**: `NODEJS_VERSION=22`
3. **Submit** tugmasini bosing.
*✅ Alwaysdata botni fonda ishga tushiradi, agar xato bo'lsa avtomatik qayta yoqadi va server o'chib-yonsa ham o'zi avtomatik yurgizadi.*

---

### 2-Usul: SSH orqali PM2 yordamida
SSH terminalida turib:

```bash
# 1. PM2 ni o'rnating (agar o'rnatilmagan bo'lsa):
npm install -g pm2

# 2. Botni PM2 orqali ishga tushiring:
npm run pm2:start

# 3. Holatini tekshiring:
pm2 status

# 4. Loglarni real vaqtda ko'rish:
npm run pm2:logs
```

---

## 🔍 Loglarni Ko'rish va Boshqarish
* Alwaysdata panelida **Advanced ➔ Services** bo'limida har bir servisning loglarini to'g'ridan-to'g'ri ko'rishingiz mumkin.
* Yoki SSH orqali: `pm2 logs` yoki `tail -f logs/pm2-out.log`.
