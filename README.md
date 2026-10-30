# فلو باي — FlowPay

تطبيق عربي مجاني يجهّز مكالمة التحويل (USSD) لـ **جوال باي** و**بال باي** و**بنك فلسطين**
بضغطة وحدة، ويستقبل المدفوعات عبر كود QR. يعمل بدون إنترنت وبدون تسجيل، وكل البيانات
على جهاز المستخدم فقط.

نفس الملفات تعمل بطريقتين:

| | كيف يصل للمستخدم |
|---|---|
| **موقع / PWA** | يُفتح من المتصفح ويُثبَّت على الشاشة الرئيسية (Android و iPhone) |
| **تطبيق أندرويد (APK)** | يُبنى تلقائيًا عبر GitHub Actions ويُثبَّت كأي تطبيق، أو يُرفع على Google Play |

- HTML / CSS / JS عادي — بلا framework وبلا خطوة بناء.
- المكتبات (`qrcode-generator` و `jsQR`) محفوظة محليًا في `vendor/`، فلا شيء يُحمَّل من CDN.
  ماسح QR (`jsQR`) يُحمَّل فقط عند أول ضغطة على زر QR.
- نسخة أندرويد بلا إذن إنترنت أصلًا.

## هيكل المشروع

```
index.html      الواجهة
app.css         التصميم
app.js          منطق التطبيق (الأكواد، المستفيدون، السجل، QR)
native.js       إضافات تطبيق أندرويد فقط (مشاركة، حفظ النسخة، روابط الدفع)
sw.js           Service Worker — العمل بدون إنترنت والتحديثات
manifest.json   تثبيت الـ PWA
privacy.html    سياسة الخصوصية (مطلوبة لـ Google Play)
img/            الشعار وشعارات المحافظ
icons/          أيقونات التطبيق (تُولَّد من الشعار)
vendor/         مكتبات QR
android/        مشروع أندرويد (Capacitor)
scripts/        build-www.mjs (تجهيز الملفات للنشر) و make-icons.py (الأيقونات)
```

### شعارات المحافظ

ضع الملفات التالية في `img/` (مربعة، 128×128 أو أكبر):

```
img/jawwalpay.png   img/palpay.png   img/bop.png
```

وإن لم توجد يعرض التطبيق شارة نصية (JP / PP / BOP) بدلًا منها.
ويمكن إضافة `img/og-image.png` (1200×630) لتظهر صورة عند مشاركة الرابط على واتساب وفيسبوك.

## التشغيل محليًا

```bash
npm ci
npm run www
cd www && python3 -m http.server 8000
```

ثم افتح <http://localhost:8000>.

## تطبيق أندرويد

كل دفعة (push) إلى أي فرع تبني APK تلقائيًا (تبويب **Actions** ← آخر تشغيل ← **Artifacts**
← `flowpay-android`).

الدفع إلى `main` ينشر نسخة في صفحة **Releases**، ورابط التحميل الثابت لآخر نسخة:

```
https://github.com/<owner>/<repo>/releases/latest/download/flowpay.apk
```

> رابط التحميل يعمل للجميع فقط إذا كان المستودع **عامًا (public)**.

### مفتاح التوقيع (مرة واحدة فقط)

أندرويد لا يقبل تثبيت تحديث فوق نسخة قديمة إلا إذا كانا موقّعين بنفس المفتاح.
لذلك يرفض البناء على `main` النشر بدون مفتاح. أنشئه مرة واحدة واحتفظ بنسخة منه في مكان آمن
(إن ضاع المفتاح لا يمكن تحديث التطبيق على أجهزة المستخدمين):

```bash
keytool -genkeypair -v -keystore flowpay.jks -alias flowpay -keyalg RSA -keysize 2048 -validity 10000
```

```bash
base64 -w0 flowpay.jks > flowpay.jks.b64
```

ثم في GitHub: **Settings ← Secrets and variables ← Actions ← New repository secret**:

| الاسم | القيمة |
|---|---|
| `ANDROID_KEYSTORE_B64` | محتوى `flowpay.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | كلمة سر الملف |
| `ANDROID_KEY_ALIAS` | `flowpay` |
| `ANDROID_KEY_PASSWORD` | كلمة سر المفتاح |

### فتح روابط الدفع في التطبيق مباشرة

روابط `https://flowpay.sbs/?svc=...` تفتح التطبيق بدل المتصفح إذا رُفع على الموقع الملف
`.well-known/assetlinks.json` وفيه بصمة مفتاح التوقيع (SHA-256):

```bash
keytool -list -v -keystore flowpay.jks -alias flowpay | grep SHA256
```

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": { "namespace": "android_app", "package_name": "com.makeflow.flowpay",
              "sha256_cert_fingerprints": ["AA:BB:..."] }
}]
```

### بعد تغيير الشعار

```bash
python3 scripts/make-icons.py
```

يولّد أيقونات الويب وأندرويد وشاشة البداية من `img/logo.png` (يحتاج Pillow).

## نشر الموقع

`.github/workflows/pages.yml` ينشر الموقع على GitHub Pages مع كل دفعة إلى `main`.
لربط الدومين `flowpay.sbs`: **Settings ← Pages ← Custom domain**.

أو على أي استضافة ثابتة (Cloudflare Pages، Netlify…): انشر ناتج `npm run www`.
الشرط الوحيد: HTTPS (الـ Service Worker والتثبيت لا يعملان بدونه).

رقم الإصدار يُختم تلقائيًا عند البناء، فلا حاجة لتعديله يدويًا: المستخدمون يرون شريط
«يوجد تحديث جديد» بعد كل نشر.
