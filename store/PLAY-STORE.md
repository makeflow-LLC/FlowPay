# نشر فلو باي على Google Play

كل ما يلزم لصفحة المتجر موجود في هذا المجلد. الخطوات بالترتيب.

## 1) الملف الذي يُرفع

`flowpay.aab` من آخر نسخة في صفحة Releases:
<https://github.com/makeflow-LLC/FlowPay/releases/latest/download/flowpay.aab>

- موقّع بالمفتاح الدائم من أسرار المستودع، ورقم النسخة (versionCode) يزيد تلقائيًا مع كل بناء.
- يستهدف Android 16 (API 36) ويعمل من Android 7 (API 24).
- عند أول رفع فعّل **Play App Signing** (الخيار الافتراضي). احتفظ بنسخة من ملف `flowpay.jks` وكلمة سره: هو «مفتاح الرفع»، وبدونه لا يمكن رفع تحديثات.

## 2) صفحة المتجر

| الحقل | القيمة |
|---|---|
| اسم التطبيق (30 حرفًا) | `فلو باي — FlowPay` |
| الفئة | المالية (Finance) |
| البريد للتواصل | بريدك (مطلوب، يظهر للعامة) |
| سياسة الخصوصية | `https://flowpay.sbs/privacy.html` |
| شروط الاستخدام (اختياري) | `https://flowpay.sbs/terms.html` |
| الأيقونة 512×512 | `icon-512.png` |
| الصورة الترويجية 1024×500 | `feature-graphic.png` |
| لقطات الهاتف | `screenshots/` (5 لقطات، 1080×2160) |

### الوصف القصير (80 حرفًا)

**عربي:** `حوّل عبر جوال باي وبال باي وبنك فلسطين بضغطة وحدة — بدون إنترنت وبدون تسجيل`

**English:** `Send money with Jawwal Pay, PalPay and Bank of Palestine in one tap. Offline.`

### الوصف الكامل — عربي

```
فلو باي يجهّزلك كود التحويل (USSD) ويتصل به، بدل ما تحفظ الأكواد وتكتبها كل مرة.

اختر المحفظة، اكتب الرقم والمبلغ، واضغط «حوّل». التحويل نفسه يتم بينك وبين محفظتك عبر شبكة الاتصالات مباشرة.

المزايا:
• جوال باي (لصديق أو دفع لتاجر)، بال باي، وقائمة بنك فلسطين
• تحويل سريع: آخر من حوّلت لهم بضغطة وحدة
• امسح كود QR عند التاجر، من الكاميرا أو من صورة
• اعمل كود QR للاستلام بالمبلغ اللي بدك ياه
• احفظ المستفيدين واختر الرقم من جهات الاتصال
• سجل للحركات مع إحصائيات شهرية
• يدعم الشريحتين: يختار شريحة كل محفظة
• نسخة احتياطية لبياناتك في ملف

الخصوصية:
• يعمل بدون إنترنت، والتطبيق لا يملك إذن الإنترنت أصلاً
• بدون حساب وبدون تسجيل وبدون إعلانات
• كل بياناتك على جهازك فقط
• قفل بالبصمة، والرقم السري لا يُحفظ إلا باختيارك (مشفّراً على جهازك)

تنبيه مهم:
فلو باي أداة مستقلة من تطوير MakeFlow، وغير تابع لجوال باي أو بال باي أو بنك فلسطين ولا يمثّلها. التطبيق لا يحتفظ بأموالك ولا ينفّذ التحويل بنفسه، ولا يعرف نتيجة التحويل: التأكيد دائماً من رسالة المحفظة.
```

### الوصف الكامل — English

```
FlowPay prepares the USSD transfer code for you and dials it, so you don't have to remember codes or type them every time.

Pick the wallet, enter the number and amount, and tap Send. The transfer itself happens between you and your wallet over the mobile network.

Features:
• Jawwal Pay (to a friend or a merchant), PalPay, and the Bank of Palestine menu
• Quick transfer: repeat a recent payment in one tap
• Scan a merchant QR code, from the camera or from a photo
• Create a QR code to receive a specific amount
• Save beneficiaries and pick a number from your contacts
• Transfer history with monthly stats
• Dual SIM support: picks the right SIM for each wallet
• Back up your data to a file

Privacy:
• Works offline. The app does not even hold the Internet permission
• No account, no sign-up, no ads
• All your data stays on your device
• Fingerprint lock. Your PIN is stored only if you choose to (encrypted, on your device)

Important:
FlowPay is an independent tool by MakeFlow. It is not affiliated with, endorsed by, or representing Jawwal Pay, PalPay or Bank of Palestine. The app does not hold your money, does not process the transfer itself, and does not know its result: confirmation always comes from your wallet's own message.
```

## 3) نماذج «محتوى التطبيق» في Play Console

| النموذج | الإجابة |
|---|---|
| سياسة الخصوصية | `https://flowpay.sbs/privacy.html` |
| الإعلانات | لا يحتوي إعلانات |
| الوصول للتطبيق | كل الوظائف متاحة بدون تسجيل دخول |
| تصنيف المحتوى | استبيان «أدوات/مالية»؛ لا عنف ولا محتوى حساس ← الجميع |
| الجمهور المستهدف | 18 فأكثر فقط |
| تطبيق إخباري / صحي / حكومي | لا |
| الميزات المالية | اختر الأقرب إلى «أخرى» ووضّح: أداة تجهّز أكواد USSD لمحافظ المستخدم؛ لا تقدّم خدمة مالية ولا تعالج مدفوعات ولا تحتفظ بأموال |

### أمان البيانات (Data safety)

- هل يجمع التطبيق أو يشارك بيانات المستخدم؟ **لا**.
  (كل شيء يبقى على الجهاز، والتطبيق بلا إذن إنترنت. «الجمع» عند Google يعني خروج البيانات من الجهاز.)
- لا يوجد حساب، فلا يلزم رابط لحذف الحساب.

### الأذونات — ما تكتبه إن سُئلت

| الإذن | السبب |
|---|---|
| `CALL_PHONE` | الاتصال بكود USSD الذي جهّزه المستخدم وأكّده في نافذة التأكيد. لا اتصال بأي رقم آخر |
| `READ_PHONE_STATE` | أسماء الشرائح فقط لاختيار شريحة كل محفظة في الجوالات ثنائية الشريحة |
| `CAMERA` | مسح كود QR للدفع |
| `USE_BIOMETRIC` | قفل التطبيق بالبصمة (اختياري) |

التطبيق لا يطلب أذونات الرسائل أو سجل المكالمات أو جهات الاتصال، فلا يلزم نموذج «الأذونات الحساسة».

## 4) مخاطر الرفض — اقرأها قبل الإرسال

1. **شعارات المحافظ.** التطبيق يعرض شعارات جوال باي وبال باي وبنك فلسطين. سياسة «انتحال الهوية» في Google قد ترفضه أو تطلب إثبات إذن من أصحاب العلامات. الأسلم: الحصول على موافقة مكتوبة منهم، أو حذف ملفات الشعارات من `img/` — التطبيق يعرض عندها شارات نصية (JP / PP / BOP) تلقائيًا. اللقطات الحالية فيها الشعارات، فأعد توليدها إن حذفتها.
2. **لا تستخدم أسماء المحافظ في اسم التطبيق أو أيقونته**، واترك فقرة «أداة مستقلة» في الوصف.
3. **الحسابات الشخصية الجديدة** (المنشأة بعد نوفمبر 2023) يلزمها اختبار مغلق بـ 12 مختبِرًا لمدة 14 يومًا قبل النشر العام. حسابات المؤسسات معفاة.
4. **التحقق من الهوية**: Play Console يطلب توثيق هوية المطوّر (ورسوم التسجيل 25 دولارًا مرة واحدة).
5. **مراجعة التطبيقات المالية** قد تطول، وقد يُطلب منك توضيح أن التطبيق لا يقدّم خدمة مالية بنفسه.

## 5) ترتيب العمل

1. أنشئ التطبيق في Play Console (اللغة الافتراضية: العربية، مجاني).
2. املأ «محتوى التطبيق» من القسم 3.
3. املأ صفحة المتجر من القسم 2 وارفع الصور.
4. ابدأ بمسار **الاختبار الداخلي**: ارفع `flowpay.aab`، أضف بريدك كمختبِر، وثبّت من المتجر وجرّب تحويلًا حقيقيًا.
5. بعدها الاختبار المغلق (إن لزم حسابك)، ثم الإنتاج.
6. بعد أول رفع: انسخ بصمة SHA-256 لمفتاح **توقيع التطبيق** من Play Console (الإعداد ← سلامة التطبيق) وضعها في `.well-known/assetlinks.json` على الموقع، حتى تفتح روابط flowpay.sbs في التطبيق (انظر README).

## إعادة توليد اللقطات

اللقطات مأخوذة من نسخة الويب ببيانات تجريبية (أسماء وأرقام وهمية).
