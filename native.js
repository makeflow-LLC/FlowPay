/* ================= فلو باي — تطبيق أندرويد =================
   نفس ملفات الويب تعمل داخل تطبيق أندرويد (Capacitor). هذا الملف يضيف ما
   لا يدعمه WebView، ولا يفعل شيئًا حين يُفتح التطبيق من المتصفح:

   1. المشاركة (رابط الدفع، كود QR، رابط التطبيق) عبر شاشة المشاركة في
      أندرويد، لأن WebView لا يدعم navigator.share.
   2. حفظ النسخة الاحتياطية: WebView لا يُنزّل الملفات، فنكتبها في الكاش
      ونفتح شاشة المشاركة لحفظها في Drive أو إرسالها على واتساب.
   3. روابط الدفع (https://flowpay.sbs/?svc=...) التي تفتح التطبيق مباشرة.
   4. أكواد USSD (UssdPlugin.java): اتصال مباشر بدون شاشة المتصل، من الشريحة
      الصحيحة، أو تنفيذ الكود داخل التطبيق وقراءة رد الشبكة.

   روابط https: الخارجية (واتساب) يفتحها Capacitor بنفسه في التطبيق المناسب.
================================================================ */
(function (global) {
  'use strict';

  var cap = global.Capacitor;
  var isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  var Native = { isNative: isNative };
  global.Native = Native;
  if (!isNative) return;

  document.documentElement.classList.add('native');

  var P = cap.Plugins || {};
  var Share = P.Share;
  var FS = P.Filesystem;
  var App = P.App;
  var Ussd = P.FlowPayUssd;
  var Clip = P.Clipboard;

  if (Clip) {
    Native.copy = function (text) { return Clip.write({ string: String(text) }); };
    Native.paste = function () { return Clip.read().then(function (r) { return (r && r.value) || ''; }); };
  }

  // {phone, name} للرقم المختار من شاشة جهات الاتصال، أو {cancelled: true}
  if (P.FlowPayContacts) Native.pickContact = function () { return P.FlowPayContacts.pick(); };

  // قفل البصمة وتخزين مشفّر للرقم السري (SecurePlugin.java)
  var Sec = P.FlowPaySecure;
  if (Sec) {
    Native.secure = {
      available: function () { return Sec.available().then(function (r) { return !!(r && r.available); }).catch(function () { return false; }); },
      auth: function (reason) { return Sec.authenticate({ title: 'فلو باي', subtitle: reason || '' }).then(function (r) { return !!(r && r.ok); }).catch(function () { return false; }); },
      set: function (k, v) { return Sec.setSecret({ key: k, value: String(v) }); },
      get: function (k) { return Sec.getSecret({ key: k }).then(function (r) { return (r && r.value) || ''; }).catch(function () { return ''; }); },
      del: function (k) { return Sec.removeSecret({ key: k }).catch(function () {}); }
    };
  }

  if (Ussd) {
    Native.ussd = {
      // [{id, slot, carrier, name}] — فارغة إن رُفض الإذن أو لا توجد شرائح
      sims: function () { return Ussd.sims().then(function (r) { return r.sims || []; }).catch(function () { return []; }); },
      // simId = -1 يعني «اترك أندرويد يختار». النتيجة {mode: 'call' | 'dialer'}
      dial: function (code, simId) { return Ussd.dial({ code: code, simId: simId }); },
      // {ok, message} أو {ok: false, failure}
      send: function (code, simId) { return Ussd.send({ code: code, simId: simId }); }
    };
  }

  // {title, text, url}
  Native.share = function (opts) {
    return Share.share({ title: opts.title, text: opts.text, url: opts.url, dialogTitle: opts.title });
  };

  // يكتب الملف في كاش التطبيق ثم يشاركه. data نص عادي، أو base64 إن كان base64 = true
  Native.shareFile = function (name, data, base64, title) {
    var req = { path: name, data: data, directory: 'CACHE' };
    if (!base64) req.encoding = 'utf8';
    return FS.writeFile(req).then(function (res) {
      return Share.share({ title: title, files: [res.uri], dialogTitle: title });
    });
  };

  // cb(url) للرابط الذي فتح التطبيق، ولكل رابط يصل والتطبيق مفتوح
  Native.onLink = function (cb) {
    if (!App) return;
    App.getLaunchUrl().then(function (r) { if (r && r.url) cb(r.url); }).catch(function () {});
    App.addListener('appUrlOpen', function (e) { if (e && e.url) cb(e.url); });
  };

  // زر الرجوع: بدون مستمع لا يفعل Capacitor شيئًا في الشاشة الرئيسية، فلا يخرج المستخدم من التطبيق
  if (App) {
    Native.onBack = function (cb) { App.addListener('backButton', cb); };
    Native.minimize = function () { App.minimizeApp().catch(function () {}); };
  }
})(window);
