'use strict';
/* ================= فلو باي =================
   يجهّز كود USSD للتحويل (جوال باي / بال باي / بنك فلسطين) ويفتح المتصل به.
   كل البيانات (المستفيدون، السجل، الإعدادات) في localStorage على الجهاز فقط.
   الرقم السري لا يُحفظ أبدًا: يُستخدم لبناء الكود ثم يُمسح من الحقل.
============================================== */

const APP_VERSION = '__BUILD__';
const APP_URL = 'https://flowpay.sbs/';
const SUPPORT_WA = '970597750343';

const SVC = {
    jawwal: { name: 'جوال باي',
        pinTitle: 'الرقم السري المكون من 4 أرقام', pinPh: 'اختياري — لتسريع التحويل' },
    palpay: { name: 'بال باي',
        pinTitle: 'الرقم السري المكون من 4 أرقام', pinPh: 'يُنسخ للحافظة لإلصاقه أثناء المكالمة' },
    bop: { name: 'بنك فلسطين',
        pinTitle: 'الرقم السري لبنك فلسطين', pinPh: 'للدخول للقائمة التفاعلية' }
};

const CATS = {
    'صديق': ['👤', 'rgba(56,189,248,0.16)'],
    'عائلة': ['🏠', 'rgba(74,222,128,0.16)'],
    'سوبرماركت': ['🛒', 'rgba(251,191,36,0.16)'],
    'سائق': ['🚕', 'rgba(129,140,248,0.16)'],
    'مطعم': ['🍽️', 'rgba(248,113,113,0.16)'],
    'عمل': ['💼', 'rgba(148,163,184,0.16)'],
    'آخر': ['👥', 'rgba(148,163,184,0.16)']
};

// ===== STORAGE =====
// localStorage قد يرمي استثناء (وضع التصفح الخاص، أو امتلاء المساحة) — لا نريد أن يتعطل التطبيق بسببه
const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { toast('تعذّر الحفظ — مساحة الجهاز ممتلئة؟'); } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
    list(k) { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
};
const session = {
    get(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch (e) {} }
};

let tab = '', jawwalType = '1', selCategory = '', editContactIdx = -1;
let histFilterVal = 'all', histShown = 60, deferredPrompt = null, newWorker = null;
let contacts = store.list('fp_contacts');
let hist = store.list('fp_hist');

// ترحيل: حذف أكواد USSD من السجل القديم (خصوصية)، وإعطاء كل حركة معرّفًا ثابتًا
let migrated = false;
hist = hist.map((h, i) => {
    if (!h || typeof h !== 'object') { migrated = true; return null; }
    if ('code' in h || !h.id) {
        migrated = true;
        const { code, ...rest } = h;
        if (!rest.id) rest.id = (rest.ts || 0) + '-' + i;
        return rest;
    }
    return h;
}).filter(Boolean);
if (migrated) saveHist();

function saveHist() { store.set('fp_hist', JSON.stringify(hist)); }
function saveContacts() { store.set('fp_contacts', JSON.stringify(contacts)); }
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function threshold() { return parseInt(store.get('fp_large_threshold', '100'), 10) || 100; }
function histLimit() { return parseInt(store.get('fp_hist_limit', '200'), 10) || 200; }

// ===== HELPERS =====
function $(id) { return document.getElementById(id); }
function vib(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 15); } catch (e) {} }
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// الأرقام العربية (٠١٢) والفارسية (۰۱۲) ← 012
function toDigits(s) {
    return String(s || '').replace(/[٠-٩۰-۹]/g, c => String(c.charCodeAt(0) & 0xF));
}
function normalizePhone(raw) {
    let p = toDigits(raw).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
    const intl = p.match(/^(?:\+|00)?97[02](5\d{8})$/);
    if (intl) return '0' + intl[1];
    if (/^5\d{8}$/.test(p)) return '0' + p;
    return p;
}
function isValidPh(p) { return /^05\d{8}$/.test(p); }
// «دفع لتاجر» في جوال باي يقبل رقم التاجر، وهو ليس بالضرورة رقم جوال
function isMerchant() { return tab === 'jawwal' && jawwalType === '2'; }
function isValidTo(p) { return isMerchant() ? /^\d{4,12}$/.test(p) : isValidPh(p); }
function cleanAmount(raw) {
    let a = toDigits(raw).replace(/[٫,]/g, '.').replace(/[^\d.]/g, '');
    const dot = a.indexOf('.');
    if (dot >= 0) a = a.slice(0, dot + 1) + a.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    return a.slice(0, 9);
}
// المبلغ يدخل في كود USSD، فلا نقبل إلا رقمًا صريحًا
function isValidAmt(a) { return /^\d{1,6}(\.\d{1,2})?$/.test(a) && parseFloat(a) > 0; }
const IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// الآيفون يمنع روابط tel: التي فيها * أو # — فننسخ الكود بدل فتح المتصل
const CAN_DIAL = Native.isNative || !IS_IOS;
function svcKey(name) { return Object.keys(SVC).find(k => SVC[k].name === name) || ''; }

// أسماء التجار من أكواد QR الممسوحة (تُعرض في التأكيد وتُقترح عند الحفظ)
const scanNames = {};
function contactName(phone) { const c = contacts.find(c => c.phone === phone); return c ? c.name : (scanNames[phone] || ''); }

let toastTimer = null;
function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function openExternal(url) {
    // داخل تطبيق أندرويد يفتح Capacitor الرابط في التطبيق المناسب (واتساب، المتصفح)
    if (Native.isNative) location.href = url;
    else window.open(url, '_blank', 'noopener');
}
function openWhatsApp() { vib(); openExternal('https://wa.me/' + SUPPORT_WA); }
function sendFeedback() {
    vib();
    openExternal('https://wa.me/' + SUPPORT_WA + '?text=' + encodeURIComponent('مرحباً 👋 عندي اقتراح/ملاحظة على تطبيق فلو باي:\n\n'));
}

function copyText(text) {
    // داخل تطبيق أندرويد: حافظة النظام مباشرة (حافظة المتصفح لا تعمل بثبات في WebView)
    if (Native.copy) return Native.copy(text).catch(() => legacyCopy(text));
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    }
    return legacyCopy(text);
}
function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return ok ? Promise.resolve() : Promise.reject();
}

// {title, text, url} — شاشة المشاركة، وإلا نسخ الرابط، وإلا واتساب
function shareText(opts) {
    if (Native.isNative) return Native.share(opts).catch(() => {});
    if (navigator.share) return navigator.share(opts).catch(() => {});
    const full = opts.text + (opts.url ? '\n' + opts.url : '');
    return copyText(full).then(() => toast('تم النسخ — الصقه وشاركه'))
        .catch(() => openExternal('https://wa.me/?text=' + encodeURIComponent(full)));
}

// ===== OVERLAYS & BACK BUTTON =====
// كل نافذة تُفتح تضيف خطوة في سجل المتصفح، فزر الرجوع (في أندرويد والمتصفح) يغلقها
// بدل أن يخرج من التطبيق. نفس الشيء لصفحة السجل.
let curPage = 'home';
function openOv(id) {
    const el = $(id);
    if (el.classList.contains('show')) return;
    el.classList.add('show');
    history.pushState({ ov: id, page: curPage }, '');
}
function closeOv(id) {
    if (!$(id).classList.contains('show')) return;
    if (history.state && history.state.ov === id) history.back();   // popstate يكمل الإغلاق
    else hideOv(id);
}
function hideOv(id) {
    $(id).classList.remove('show');
    if (id === 'scannerWrap') stopScanner();
    if (id === 'ovSim' && simResolve) { const r = simResolve; simResolve = null; r(null); }
    // إغلاق رد المحفظة لا يغيّر شيئًا في السجل — تبقى الحركة «غير مؤكد» حتى يعلّمها المستخدم
    if (id === 'ovReply') retry = null;
    showPending();
}
// يفتح نافذة مكان أخرى إن كانت ظاهرة، وإلا يفتحها عادي (المستخدم قد يكون أغلق الأولى بزر الرجوع)
function showOver(from, to) {
    if (from && $(from).classList.contains('show')) swapOv(from, to); else openOv(to);
}
// نافذة تفتح مكان أخرى دون خطوة رجوع إضافية
function swapOv(from, to) {
    $(from).classList.remove('show');
    $(to).classList.add('show');
    history.replaceState({ ov: to, page: curPage }, '');
}
window.addEventListener('popstate', e => {
    const st = e.state || {};
    document.querySelectorAll('.overlay.show, .scanner-wrap.show').forEach(o => { if (o.id !== st.ov) hideOv(o.id); });
    showPage(st.page || 'home');
});

let askHandler = null;
function ask(title, text, yesLabel, onYes, from) {
    $('askTitle').textContent = title;
    $('askText').textContent = text;
    $('askYes').textContent = yesLabel;
    askHandler = onYes;
    if (from) swapOv(from, 'ovAsk'); else openOv('ovAsk');
}
$('askYes').addEventListener('click', () => {
    const fn = askHandler;
    askHandler = null;
    closeOv('ovAsk');
    if (fn) fn();
});

// ===== NAVIGATION =====
function showPage(page) {
    if (page === curPage) return;
    curPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page' + page.charAt(0).toUpperCase() + page.slice(1)));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
    if (page === 'history') { histShown = 60; renderHistFull(); renderAnalytics(); }
    window.scrollTo(0, 0);
}
function navTo(page) {
    vib();
    if (page === curPage) return;
    if (page === 'history') { showPage('history'); history.pushState({ page: 'history' }, ''); }
    else if (history.state && history.state.page === 'history') history.back();
    else showPage(page);
}

function showHelp() { vib(); openOv('ovHelp'); }
function closeOnboard() { closeOv('ovOnboard'); store.set('fp_onboarded', '1'); }

// ===== SEND: SERVICE & FORM =====
function selectService(svc) {
    tab = svc;
    document.querySelectorAll('#sendServices .service-card').forEach(c => c.classList.toggle('active', c.dataset.svc === svc));
    $('formCard').hidden = false;
    $('actionBar').hidden = false;
    document.body.classList.add('has-action');
    $('scanCta').hidden = true;
    const bop = svc === 'bop';
    $('jawwalTypeGroup').hidden = svc !== 'jawwal';
    $('phoneGroup').hidden = bop;
    $('amountGroup').hidden = bop;
    setBeneficiaries(false);
    updateTypeUI();
    $('pinLabel').innerHTML = esc(SVC[svc].pinTitle) + ' <span class="optional">(اختياري)</span>';
    $('pin').placeholder = SVC[svc].pinPh;
    store.set('fp_last_svc', svc);   // المرة الجاية يفتح التطبيق على نفس المحفظة
    $('pasteBtn').hidden = !canPaste;
    renderAmounts();
    renderRecent();
    gen();
}
function switchTab(t) { vib(); selectService(t); }

// أزرار المبالغ: المبالغ التي تحوّلها كثيرًا بهذه المحفظة أولاً، والباقي من الافتراضي
function renderAmounts() {
    const count = {};
    hist.forEach(h => {
        if (h.service === (SVC[tab] && SVC[tab].name) && h.status !== 'فشل' && isValidAmt(h.amount)) count[h.amount] = (count[h.amount] || 0) + 1;
    });
    const picks = Object.keys(count).filter(a => count[a] >= 2).sort((a, b) => count[b] - count[a]).slice(0, 4);
    for (const d of ['5', '10', '20', '50']) if (picks.length < 4 && !picks.some(p => parseFloat(p) === parseFloat(d))) picks.push(d);
    picks.sort((a, b) => parseFloat(a) - parseFloat(b));
    const cur = $('amount').value;
    $('sendAmounts').innerHTML = picks.map(a => `<button class="amt-btn${a === cur ? ' sel' : ''}" onclick="setAmt('${esc(a)}',this)">${esc(a)}</button>`).join('');
}

// اقتراحات أثناء كتابة الرقم: من المحفوظين ومن الأرقام التي حوّلت لها سابقًا
function renderSuggest() {
    const box = $('phoneSuggest');
    const v = $('phone').value.trim();
    let html = '';
    if (tab && tab !== 'bop' && !isMerchant()) {
        if (isValidPh(v)) {
            const c = contacts.find(c => c.phone === v);
            if (c) html = `<span class="phone-known">✓ ${esc(c.name)}</span>`;
        } else if (v.length >= 3) {
            const seen = new Set(), out = [];
            const add = (phone, name) => { if (out.length < 4 && isValidPh(phone) && phone.includes(v) && !seen.has(phone)) { seen.add(phone); out.push([phone, name]); } };
            contacts.forEach(c => add(c.phone, c.name));
            hist.forEach(h => add(h.phone, ''));
            html = out.map(([p, n]) => `<button class="suggest-item" onclick="pickSuggest('${p}')"><b>${esc(n || p)}</b>${n ? '<small>' + p + '</small>' : ''}</button>`).join('');
        }
    }
    box.innerHTML = html;
    box.hidden = !html;
}
function pickSuggest(phone) {
    vib();
    const c = contacts.find(c => c.phone === phone);
    $('phone').value = phone;
    $('phoneErr').classList.remove('show');
    $('phone').classList.remove('error');
    if (c && c.lastAmount && !$('amount').value) { $('amount').value = c.lastAmount; renderAmounts(); }
    gen();
    if (!$('amount').value) $('amount').focus(); else $('phone').blur();
}

// لصق رقم منسوخ (من واتساب مثلاً): نلتقط أول رقم جوال صالح من النص مهما كان حوله
function extractPhone(text) {
    const t = toDigits(text);
    for (const m of t.match(/[+\d][\d\s\-()]{6,20}/g) || []) {
        const p = normalizePhone(m);
        if (isMerchant() ? /^\d{4,12}$/.test(p) : isValidPh(p)) return p;
    }
    return '';
}
const canPaste = !!(Native.paste || (navigator.clipboard && navigator.clipboard.readText));
function pastePhone() {
    vib();
    (Native.paste ? Native.paste() : navigator.clipboard.readText()).then(text => {
        const p = extractPhone(text);
        if (!p) { toast(isMerchant() ? 'ما في رقم تاجر في الحافظة' : 'ما في رقم جوال في الحافظة'); return; }
        $('phone').value = p;
        onPhoneInput();
        toast('تم لصق ' + (contactName(p) || p));
        if (!$('amount').value) $('amount').focus();
    }).catch(() => toast('تعذّر قراءة الحافظة — الصق الرقم يدويًا'));
}

function setJawwalType(type) { vib(); jawwalType = type; updateTypeUI(); onPhoneInput(); }
function updateTypeUI() {
    document.querySelectorAll('#jawwalTypeGroup button').forEach(b => b.classList.toggle('active', b.dataset.type === jawwalType));
    $('phoneLabel').textContent = tab === 'jawwal' ? (jawwalType === '2' ? 'رقم التاجر' : 'رقم الصديق') : 'رقم المحوّل إليه';
}

// تحويل سريع: آخر من حوّلت لهم بأي محفظة — ضغطة وحدة تختار المحفظة وتعبّي الرقم والمبلغ
function renderRecent() {
    const seen = new Set(), items = [];
    for (const h of hist) {
        if (items.length >= 6) break;
        const k = svcKey(h.service), merchant = h.transferType === 'تاجر';
        if (!k || k === 'bop' || h.status === 'فشل' || !isValidAmt(h.amount)) continue;
        if (merchant ? !/^\d{4,12}$/.test(h.phone) : !isValidPh(h.phone)) continue;
        const key = k + h.phone;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ k, h, type: merchant ? '2' : '1' });
    }
    $('quickWrap').hidden = !items.length;
    $('recentBar').innerHTML = items.map(({ k, h, type }) => {
        const name = contactName(h.phone);
        return `<button class="recent-chip" data-svc="${k}" onclick="repeatTransfer('${k}','${esc(h.phone)}','${esc(h.amount)}','${type}')"><b>${esc(name || h.phone)}</b><small>${esc(h.amount)} ₪ · ${esc(h.service)}</small></button>`;
    }).join('');
}

function onPhoneInput() {
    const el = $('phone');
    const v = normalizePhone(el.value);
    if (v !== el.value) el.value = v;
    const bad = !isMerchant() && v.length >= 2 && (v.startsWith('05') ? v.length > 10 : !/^(\+|00|9)/.test(v));
    $('phoneErr').classList.toggle('show', bad);
    el.classList.toggle('error', bad);
    gen();
}
function onAmountInput() {
    const el = $('amount');
    const v = cleanAmount(el.value);
    if (v !== el.value) el.value = v;
    clearAmtBtns('sendAmounts');
    gen();
}
function onPinInput() {
    const el = $('pin');
    const v = toDigits(el.value).replace(/\D/g, '').slice(0, 4);
    if (v !== el.value) el.value = v;
    gen();
}
function togglePin(btn) {
    const el = $('pin');
    const show = el.type === 'password';
    el.type = show ? 'tel' : 'password';
    btn.textContent = show ? '🙈' : '👁️';
}
function setAmt(v, el) { vib(); clearAmtBtns('sendAmounts'); el.classList.add('sel'); $('amount').value = v; gen(); }
function clearAmtBtns(id) { $(id).querySelectorAll('.amt-btn.sel').forEach(b => b.classList.remove('sel')); }

function formValues() {
    return { phone: $('phone').value.trim(), amount: $('amount').value.trim(), pin: $('pin').value };
}
function buildCode() {
    const { phone, amount, pin } = formValues();
    const full = isValidTo(phone) && isValidAmt(amount);
    const okPin = /^\d{4}$/.test(pin);
    if (tab === 'jawwal') return okPin && full ? `*110*${jawwalType}*${pin}*${phone}*${amount}*1#` : `*110*${jawwalType}#`;
    // بال باي ترفض الرقم السري داخل الكود («Invalid Transaction Code»): تسأل عنه ثم عن
    // «1. تأكيد» أثناء الجلسة، فيُنسخ الرقم السري للصق
    if (tab === 'palpay') return full ? `*370*1*1*${phone}*${amount}#` : '*370*1#';
    if (tab === 'bop') return okPin ? `*267*${pin}#` : '*267#';
    return '';
}
function isReady() {
    const { phone, amount } = formValues();
    return tab === 'bop' || (!!tab && isValidTo(phone) && isValidAmt(amount));
}
function gen() {
    const ready = isReady();
    $('callBtn').disabled = !ready;
    // الزر يقول بالضبط ماذا سيحدث: «حوّل 20 ₪ لأحمد»
    const { phone, amount } = formValues();
    let label = CAN_DIAL ? '📞 حوّل الآن' : '📋 جهّز الكود';
    if (tab === 'bop') label = CAN_DIAL ? '📞 افتح قائمة البنك' : label;
    else if (ready) label = (CAN_DIAL ? '📞 حوّل ' : '📋 جهّز ') + amount + ' ₪ لـ ' + (contactName(phone) || phone);
    $('callBtn').textContent = label;
    $('amountWarn').classList.toggle('show', tab !== 'bop' && parseFloat(amount) > threshold());
    // رقم جديد صحيح؟ نعرض حفظه هنا — بلا علاقة بنتيجة أي تحويل
    renderSuggest();
    $('saveNumBtn').hidden = !(tab && tab !== 'bop' && !isMerchant() && isValidPh(phone) && !contacts.some(c => c.phone === phone));
}
function saveCurrentNumber() {
    vib();
    const ph = $('phone').value.trim();
    fillContactForm(-1, { phone: ph, name: scanNames[ph] || '' }, 'حفظ المستفيد');
    openOv('ovContact');
}

function confirmCall() {
    vib(30);
    const { phone, amount, pin } = formValues();
    if (pin && pin.length !== 4) { toast('الرقم السري يجب أن يكون 4 أرقام'); return; }
    if (tab !== 'bop') {
        if (!isValidTo(phone)) { toast(isMerchant() ? 'أدخل رقم التاجر' : 'أدخل رقم صحيح (يبدأ بـ 05)'); return; }
        if (!isValidAmt(amount)) { toast('أدخل المبلغ'); return; }
    }
    let info;
    if (tab === 'bop') {
        info = '<div class="confirm-main">رح تفتح قائمة بنك فلسطين</div>';
    } else {
        const typeText = tab === 'jawwal' ? (jawwalType === '2' ? 'دفع لتاجر' : 'تحويل لصديق') : 'تحويل';
        const who = contactName(phone) || phone;
        info = `<div class="confirm-main">${typeText}: <span class="amt">${esc(amount)} شيكل</span><br>لـ <span class="who">${esc(who)}</span><br>عبر ${SVC[tab].name}</div>`;
        if (parseFloat(amount) > threshold()) info += '<div class="confirm-warn">⚠️ مبلغ كبير — تأكد جيداً</div>';
    }
    const code = buildCode();
    info += `<div class="code-box">${esc(maskPin(code))}</div>`;
    info += '<ul class="steps-mini">' + ussdSteps(code).map(t => `<li>${t}</li>`).join('') + '</ul>';
    $('confirmInfo').innerHTML = info;
    $('ovConfirm').querySelector('.m-primary').textContent = CAN_DIAL ? 'يلّا، حوّل 📞' : 'انسخ الكود 📋';
    openOv('ovConfirm');
}

// الرقم السري لا يظهر على الشاشة حتى في المعاينة
function maskPin(code) {
    const pin = $('pin').value;
    if (!/^\d{4}$/.test(pin)) return code;
    // الرقم السري يأتي مباشرة بعد بادئة الكود: *110*1*PIN* أو *267*PIN#
    return code.replace(/^(\*110\*\d\*|\*267\*)\d{4}/, '$1••••');
}

// ماذا سيحدث بعد الاتصال — حتى لا يتفاجأ المستخدم بالقائمة
function ussdSteps(code) {
    const pin = /^\d{4}$/.test($('pin').value);
    const steps = [];
    if (!CAN_DIAL) steps.push('رح ننسخ الكود — الصقه في تطبيق الهاتف واضغط اتصال');
    if (tab === 'jawwal') {
        if (pin) steps.push('الكود كامل بخطوة وحدة — التأكيد برسالة جوال باي (SMS)');
        else steps.push('رح تفتح قائمة جوال باي — رقم المستلم منسوخ جاهز للصق، وبعده المبلغ والرقم السري');
    } else if (tab === 'palpay') {
        steps.push(pin ? 'لما يطلب الرقم السري: اضغط مطوّلاً ← لصق (منسوخ جاهز) ← Send' : 'لما يطلب الرقم السري: اكتبه ← Send');
        steps.push('بعدها بيطلع اسم المستلم: اكتب 1 للتأكيد ← Send');
    } else if (tab === 'bop') {
        steps.push(pin ? 'رح تدخل قائمة بنك فلسطين مباشرة — اختر نوع العملية' : 'رح يطلب الرقم السري ثم تظهر قائمة البنك');
    }
    if (Native.ussd && !store.get('fp_call_ok')) steps.push('أول مرة: اسمح لفلو باي بإجراء المكالمات حتى يتصل مباشرة');
    if (tab !== 'bop') steps.push('فلو باي ما بيعرف نتيجة التحويل — المرجع رسالة المحفظة');
    return steps;
}

let iosCode = '';
function copyCodeAgain() { vib(); copyText(iosCode).then(() => toast('تم نسخ الكود'), () => {}); }

// الشريحة لكل محفظة: محفوظة، أو تلقائية (شريحة جوال لجوال باي)، أو نسأل مرة وحدة
let simResolve = null;
async function chooseSim(svc) {
    const saved = store.get('fp_sim_' + svc, '');
    if (saved !== '') return Number(saved);
    const sims = await Native.ussd.sims();
    if (sims.length < 2) return -1;
    if (svc === 'jawwal') {
        const j = sims.find(x => /jawwal|جوال/i.test(x.carrier + ' ' + x.name));
        if (j) { store.set('fp_sim_' + svc, String(j.id)); return j.id; }
    }
    $('simText').textContent = 'جوالك فيه شريحتين — أي وحدة فيها محفظة ' + SVC[svc].name + '؟';
    $('simList').innerHTML = sims.map(x =>
        `<button class="sim-btn" onclick="pickSim(${Number(x.id)})">📶 ${esc(x.carrier || x.name || 'شريحة')}<small>SIM ${Number(x.slot) + 1}</small></button>`
    ).join('');
    if ($('ovConfirm').classList.contains('show')) swapOv('ovConfirm', 'ovSim'); else openOv('ovSim');
    return new Promise(resolve => {
        simResolve = id => { if (id !== null) store.set('fp_sim_' + svc, String(id)); resolve(id); };
    });
}
function pickSim(id) {
    vib();
    const r = simResolve;
    simResolve = null;
    if (r) r(id);
}
function resetSims() {
    vib();
    Object.keys(SVC).forEach(k => store.del('fp_sim_' + k));
    toast('رح نسألك عن الشريحة في التحويل الجاي');
}

// ضغطتان سريعتان على «حوّل» = تحويلان. نقفل الزر حتى ينتهي الأول
let calling = false;
async function proceedCall() {
    if (calling) return;
    calling = true;
    try { await startTransfer(); } finally { setTimeout(() => { calling = false; }, 1200); }
}

function withTimeout(promise, ms, fallback) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(fallback), ms);
        promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
}
function telHref(code) { return 'tel:' + code.replace(/#/g, '%23'); }

async function startTransfer() {
    vib(40);
    if (!isReady()) { closeOv('ovConfirm'); return; }
    const svc = tab, type = jawwalType;
    const code = buildCode();
    const { phone, amount, pin } = formValues();
    let simId = -1;
    if (Native.ussd) {
        simId = await chooseSim(svc);
        if (simId === null) return;   // ألغى اختيار الشريحة
    }
    const bop = svc === 'bop';
    // السجل يحفظ «محاولة» بلا حالة: التطبيق لا يعرف نتيجة التحويل ولا يفترضها.
    // الحالة (نجح/فشل) يضعها المستخدم فقط، إن أراد.
    const entry = {
        id: newId(), service: SVC[svc].name, phone: bop ? '' : phone, amount: bop ? '' : amount,
        transferType: svc === 'jawwal' ? (type === '2' ? 'تاجر' : 'صديق') : '',
        ts: Date.now(), status: ''
    };
    hist.unshift(entry);
    if (hist.length > histLimit()) hist.length = histLimit();
    saveHist();
    const ci = contacts.findIndex(c => c.phone === phone);
    if (ci >= 0 && amount && !bop) { contacts[ci].lastAmount = amount; saveContacts(); }

    // نتذكر آخر محاولة (حتى لو أغلق النظام الصفحة أثناء المكالمة) لنعرض تعليمها — اختياريًا
    session.set('fp_pending', bop ? '' : entry.id);
    $('pendingCard').hidden = true;
    // الكود الكامل (يتم بخطوة واحدة) موجود لجوال باي فقط
    const fullCode = svc === 'jawwal' && /^\d{4}$/.test(pin) && isValidTo(phone);
    retry = null;

    // الرقم السري لا يبقى في الحقل بعد استخدامه
    $('pin').value = '';
    $('pin').type = 'password';
    renderRecent();
    gen();

    const shown = () => { const o = document.querySelector('.overlay.show'); return o ? o.id : ''; };

    if (!CAN_DIAL) {
        iosCode = code;
        copyText(code).catch(() => {});
        $('iosCode').textContent = code;
        showOver(shown(), 'ovIos');
        return;
    }

    // تنفيذ داخل التطبيق: الكود الكامل فقط (مع الرقم السري). الشبكة ترد برسالة واحدة وتنتهي
    // الجلسة. نعرض ردها كما هو — ولا نحكم نحن إن تم التحويل أم لا.
    if (Native.ussd && fullCode && store.get('fp_inapp') !== '0') {
        showOver(shown(), 'ovBusy');
        let res = null;
        try {
            res = await withTimeout(Native.ussd.send(code, simId), 60000, { ok: false, timeout: true });
        } catch (e) {
            res = null;   // رُفض الإذن أو الجهاز لا يدعم = لم يُرسل شيء، نكمّل بالاتصال العادي تحت
        }
        if (res) {
            // إن ردّت الشبكة بسؤال/قائمة يمكن إكمالها بالاتصال العادي (الرقم السري يُنسخ للصق)
            retry = { code: `*110*${type}#`, pin, simId };
            showReply(res, svc);
            return;
        }
    }

    dialing = true;   // من الآن حتى تبدأ المكالمة: لا شريط «شو صار؟»
    const open = shown();
    if (open) closeOv(open);
    if (svc === 'palpay' && pin) {
        copySecret(pin).then(() => toast('تم نسخ الرقم السري — الصقه عند الطلب'), () => {});
    } else if (svc === 'jawwal' && !fullCode) {
        copyText(phone).then(() => toast('رقم المستلم منسوخ — الصقه لما تطلبه القائمة'), () => toast('ستمر بعدة خطوات يدوية'));
    }
    setTimeout(() => dialCode(code, simId), svc === 'palpay' ? 700 : 120);
}

// اتصال بالكود. نافذة إذن الاتصال قد تُخفي الصفحة لحظة، فلا نعرض شريط «شو صار؟» قبل أن تبدأ المكالمة
function dialCode(code, simId) {
    dialing = true;
    const done = () => setTimeout(() => { dialing = false; showPending(); }, 1500);
    if (!Native.ussd) { location.href = telHref(code); done(); return; }
    Native.ussd.dial(code, simId).then(r => {
        if (r && r.mode === 'call') store.set('fp_call_ok', '1');
        if (r && r.mode === 'dialer') toast('اضغط زر الاتصال في المتصل');
    }).catch(() => { location.href = telHref(code); }).finally(done);
}

let dialing = false, retry = null;

// رد الشبكة على التنفيذ داخل التطبيق: يُعرض حرفيًا. لا عنوان «تم» ولا «فشل» من عندنا،
// ولا تتغير حالة الحركة في السجل — المرجع رسالة المحفظة نفسها.
function showReply(res, svc) {
    const msg = res && res.ok && res.message ? String(res.message).trim() : '';
    // سؤال أو قائمة مرقّمة = الجلسة تنتظر ردًا لا نستطيع إرساله من هنا
    const needsInput = !!msg && /(^|\n)\s*\d{1,2}\s*[.)\-:]\s*\D|أدخل|ادخل|اختر|enter|select|choose/i.test(msg);
    $('replyTitle').textContent = msg ? '📩 رد ' + SVC[svc].name : '⚠️ ما وصل رد من الشبكة';
    $('replyMsg').hidden = !msg;
    $('replyMsg').textContent = msg;
    $('replyHint').textContent = !msg
        ? 'ما قدرنا نقرأ رد الشبكة، وما بنعرف إذا التحويل تم أو لأ. افحص رسائل المحفظة أو رصيدك قبل ما تعيد — حتى ما يتكرر التحويل.'
        : needsInput
            ? 'الشبكة ردّت بسؤال أو قائمة، والتطبيق ما بيقدر يرد عليها من هنا. إذا بدك، كمّل عبر الاتصال العادي.'
            : 'هذا رد المحفظة كما وصل. فلو باي ما بيحكم إذا تم التحويل — المرجع رسالة المحفظة (SMS) أو رصيدك.';
    if (!needsInput) retry = null;
    $('replyRetry').hidden = !retry;
    showOver('ovBusy', 'ovReply');
}

// كمّل بالاتصال العادي بعد رد بقائمة/سؤال على التنفيذ داخل التطبيق
function retryByCall() {
    vib();
    const r = retry;
    retry = null;
    dialing = !!r;
    closeOv('ovReply');
    if (!r) return;
    copySecret(r.pin).then(() => toast('الرقم السري منسوخ — الصقه لما يطلبه'), () => {});
    setTimeout(() => dialCode(r.code, r.simId), 300);
}

// الرقم السري المنسوخ للصق لا يبقى في الحافظة: يُمسح عند تعليم الحركة أو بعد دقيقتين
let secretTimer = null;
function copySecret(pin) {
    clearTimeout(secretTimer);
    secretTimer = setTimeout(clearSecret, 120000);
    return copyText(pin);
}
function clearSecret() {
    if (!secretTimer) return;
    clearTimeout(secretTimer);
    secretTimer = null;
    copyText(' ').catch(() => {});
}

// شريط هادئ في الشاشة الرئيسية — لا نافذة منبثقة ولا حالة افتراضية: نافذة المحفظة تظهر فوق
// التطبيق فلا نعرف متى انتهى المستخدم ولا ماذا حدث. يعلّم النتيجة بنفسه إن أراد، أو يتجاهل.
function showPending() {
    const id = session.get('fp_pending');
    const h = id && hist.find(h => h.id === id);
    const card = $('pendingCard');
    if (!h || h.status || dialing || document.querySelector('.overlay.show')) { card.hidden = true; return; }
    const who = h.phone ? (contactName(h.phone) || h.phone) : '';
    $('pendingText').textContent = h.service + (h.amount ? ' · ' + h.amount + ' ₪' : '') + (who ? ' ← ' + who : '');
    if (!card.hidden) return;
    card.hidden = false;
    if (curPage === 'home' && !kbOpen) window.scrollTo(0, 0);   // الشريط أعلى الصفحة
}

// s: 'نجح' أو 'فشل' أو '' (تجاهل — تبقى «غير مؤكد» ويمكن تعليمها لاحقًا من السجل)
function setStatus(s) {
    vib();
    const id = session.get('fp_pending');
    session.set('fp_pending', '');
    $('pendingCard').hidden = true;
    clearSecret();
    const h = hist.find(h => h.id === id);
    if (!h || !s) return;
    h.status = s;
    saveHist();
    renderRecent();
    toast(s === 'نجح' ? 'علّمتها: تمت' : 'علّمتها: لم تتم');
}

// ===== PAYMENT LINKS & QR PAYLOADS =====
// يقبل رابط دفع من فلو باي، أو الصيغة القديمة flowpay:svc:phone:amount — ويرفض أي قيمة غير صالحة
// لأنها ستدخل في كود USSD
function parsePayload(str) {
    let svc, phone, amount, type = '1';
    str = String(str || '').trim();
    if (str.startsWith('flowpay:')) {
        [, svc, phone, amount] = str.split(':');
    } else {
        let u;
        try { u = new URL(str, location.href); } catch (e) { return null; }
        if (u.hostname !== 'flowpay.sbs' && u.origin !== location.origin) return null;
        svc = u.searchParams.get('svc');
        phone = u.searchParams.get('phone');
        amount = u.searchParams.get('amt');
        if (u.searchParams.get('type') === '2') type = '2';
    }
    // لا «ننظّف» قيم الرابط: 5*999 يجب أن يُرفض، لا أن يصبح 5999
    if (!/^[\d٠-٩۰-۹+\s-]+$/.test(phone || '')) return null;
    phone = normalizePhone(phone);
    amount = toDigits(amount);
    if (svc !== 'jawwal' && svc !== 'palpay') return null;
    if (svc !== 'jawwal' || type !== '2') { if (!isValidPh(phone)) return null; }
    else if (!/^\d{4,12}$/.test(phone)) return null;
    if (!isValidAmt(amount)) return null;
    return { svc, phone, amount, type };
}

// ===== كود QR التجار (معيار سلطة النقد — EMV) =====
// مثال من لافتة تاجر جوال باي:
//   000201 010211 26 48 [00 ps.pma.ips][01 JPAYPS22][04 0502579935][10 EPAY] ... 59 08 Top shop ... 6304 CRC
function emvFields(str) {
    const out = {};
    let i = 0;
    while (i + 4 <= str.length) {
        const id = str.substr(i, 2), len = parseInt(str.substr(i + 2, 2), 10);
        if (!/^\d{2}$/.test(id) || isNaN(len) || i + 4 + len > str.length) return null;
        out[id] = str.substr(i + 4, len);
        i += 4 + len;
    }
    return i === str.length ? out : null;
}
function crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
        crc ^= str.charCodeAt(i) << 8;
        for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}
// {svc?, phone, amount, type, name} — svc فارغ يعني «اسأل المستخدم أي محفظة»
function parseMerchantQR(str) {
    str = String(str || '').trim();
    // لافتة فيها رقم جوال فقط (مثل كود بال باي)
    const plain = normalizePhone(str);
    if (/^[\d+\s-]{9,16}$/.test(str) && isValidPh(plain)) return { svc: '', phone: plain, amount: '', type: '1', name: '' };
    if (!str.startsWith('000201')) return null;
    const f = emvFields(str);
    if (!f) return null;
    if (f['63'] && crc16(str.slice(0, -4)) !== f['63'].toUpperCase()) return null;   // قراءة خاطئة للكود
    for (let t = 26; t <= 51; t++) {
        const tpl = f[String(t)] && emvFields(f[String(t)]);
        if (!tpl) continue;
        const bank = (tpl['01'] || '') + ' ' + (tpl['10'] || '');
        let account = '';
        for (const k of ['04', '02', '03', '05', '06']) if (/^\d{4,12}$/.test(tpl[k] || '')) { account = tpl[k]; break; }
        if (!account) continue;
        const svc = /JPAY|JAWWAL/i.test(bank) ? 'jawwal' : /PALP|PALPAY/i.test(bank) ? 'palpay' : '';
        const amount = isValidAmt(f['54'] || '') ? f['54'] : '';
        const name = (f['59'] || '').slice(0, 40);
        if (svc === 'palpay' && !isValidPh(account)) continue;
        return { svc, phone: account, amount, type: svc === 'jawwal' ? '2' : '1', name };
    }
    return null;
}

let pendingScan = null;
function handleScanned(p) {
    if (p.name) scanNames[p.phone] = p.name;
    if (p.svc) { fillTransfer(p, p.name ? 'تاجر: ' + p.name : 'تم مسح QR'); return; }
    pendingScan = p;
    $('pickSvcPhone').textContent = p.phone;
    openOv('ovPickSvc');
}
function pickScannedSvc(svc, type) {
    vib();
    const p = pendingScan;
    pendingScan = null;
    closeOv('ovPickSvc');
    if (p) fillTransfer({ ...p, svc, type }, 'تم مسح QR');
}
function fillTransfer(p, msg) {
    if (curPage !== 'home') navTo('home');
    jawwalType = p.svc === 'jawwal' ? p.type : '1';
    $('phone').value = p.phone;
    $('amount').value = p.amount || '';
    $('phoneErr').classList.remove('show');
    $('phone').classList.remove('error');
    selectService(p.svc);
    const who = contactName(p.phone) || p.phone;
    if (p.amount) toast(msg + ': ' + p.amount + ' ₪ → ' + who);
    else { toast(msg + ' — اكتب المبلغ'); setTimeout(() => $('amount').focus(), 350); }
}


function shareApp() {
    vib();
    shareText({ title: 'فلو باي', text: 'جرّب تطبيق فلو باي — يسهّل عليك التحويلات بضغطة واحدة!', url: APP_URL });
}



// ===== CONTACT PICKER (Chrome Android) =====
// تطبيق أندرويد: شاشة جهات الاتصال في النظام (بلا إذن). المتصفح: Contact Picker إن وُجد
const hasContactPicker = !!Native.pickContact || ('contacts' in navigator && 'ContactsManager' in window);
async function pickFromPhone() {
    vib();
    try {
        let raw = '', name = '';
        if (Native.pickContact) {
            const r = await Native.pickContact();
            if (!r || r.cancelled) return;
            raw = r.phone || '';
            name = r.name || '';
        } else {
            const picked = await navigator.contacts.select(['tel', 'name'], { multiple: false });
            if (!picked || !picked.length) return;
            raw = (picked[0].tel && picked[0].tel[0]) || '';
            name = (picked[0].name && picked[0].name[0]) || '';
        }
        const phone = normalizePhone(raw);
        $('phone').value = phone;
        if (isValidPh(phone) && name && !contactName(phone)) scanNames[phone] = String(name).slice(0, 40);   // يظهر في التأكيد ويُقترح عند الحفظ
        onPhoneInput();
        if (!isValidPh(phone)) toast('الرقم المختار ليس رقم جوال فلسطيني');
        else { if (name) toast('تم اختيار: ' + name); if (!$('amount').value) $('amount').focus(); }
    } catch (e) {
        toast('تعذّر فتح جهات الاتصال');
    }
}

// ===== RECEIVE: كود QR للدفع بمبلغ محدد =====
// الكود رابط دفع عادي: يُمسح من داخل فلو باي، أو بكاميرا أي جوال فيفتح فلو باي والتحويل جاهز
let rcvSvc = 'jawwal', rcvLink = '', qrLibLoading = null;
function loadQrLib() {
    if (window.qrcode) return Promise.resolve();
    if (!qrLibLoading) {
        qrLibLoading = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'vendor/qrcode.js';
            s.onload = resolve;
            s.onerror = () => { qrLibLoading = null; s.remove(); reject(); };
            document.head.appendChild(s);
        });
    }
    return qrLibLoading;
}
function showReceive() {
    vib();
    if (tab === 'jawwal' || tab === 'palpay') rcvSvc = tab;
    if (!$('rcvPhone').value) $('rcvPhone').value = store.get('fp_my_phone', '');
    setRcvSvc(rcvSvc, true);
    openOv('ovReceive');
    loadQrLib().then(genQR, () => toast('تعذّر تحميل مولّد QR'));
}
function setRcvSvc(svc, quiet) {
    if (!quiet) vib();
    rcvSvc = svc;
    document.querySelectorAll('#rcvSvc button').forEach(b => b.classList.toggle('active', b.dataset.svc === svc));
    genQR();
}
function onRcvInput() {
    const ph = $('rcvPhone'), am = $('rcvAmount');
    const p = normalizePhone(ph.value), a = cleanAmount(am.value);
    if (p !== ph.value) ph.value = p;
    if (a !== am.value) am.value = a;
    if (isValidPh(p)) store.set('fp_my_phone', p);
    genQR();
}
function genQR() {
    const phone = $('rcvPhone').value.trim(), amount = $('rcvAmount').value.trim();
    const ok = isValidPh(phone) && isValidAmt(amount) && !!window.qrcode;
    $('rcvQr').hidden = !ok;
    $('rcvHint').hidden = ok;
    $('rcvShare').disabled = !ok;
    if (!ok) { rcvLink = ''; return; }
    const link = APP_URL + '?svc=' + rcvSvc + '&phone=' + phone + '&amt=' + amount;
    if (link !== rcvLink) {
        rcvLink = link;
        const qr = qrcode(0, 'M');
        qr.addData(link);
        qr.make();
        $('rcvQrSvg').innerHTML = qr.createSvgTag(6, 12);
    }
    $('rcvQrInfo').textContent = amount + ' ₪ · ' + SVC[rcvSvc].name + ' · ' + phone;
}
// صورة الكود (مع المبلغ والرقم مكتوبين تحتها) عبر شاشة المشاركة، وإلا تنزيلها
function shareQR() {
    vib();
    const svg = $('rcvQrSvg').querySelector('svg');
    if (!svg || !rcvLink) return;
    const amount = $('rcvAmount').value.trim(), phone = $('rcvPhone').value.trim(), link = rcvLink;
    const text = 'ادفع لي ' + amount + ' شيكل عبر ' + SVC[rcvSvc].name + ' — امسح الكود أو افتح الرابط:';
    const img = new Image();
    img.onload = () => {
        const size = 720, pad = 40, foot = 150;
        const canvas = document.createElement('canvas');
        canvas.width = size + pad * 2;
        canvas.height = size + pad * 2 + foot;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, pad, pad, size, size);
        ctx.fillStyle = '#0b1c2b';
        ctx.textAlign = 'center';
        ctx.direction = 'rtl';
        ctx.font = 'bold 54px sans-serif';
        ctx.fillText(amount + ' ₪ · ' + SVC[rcvSvc].name, canvas.width / 2, size + pad * 2 + 40);
        ctx.font = '38px sans-serif';
        ctx.direction = 'ltr';
        ctx.fillText(phone, canvas.width / 2, size + pad * 2 + 100);
        if (Native.isNative) {
            Native.shareFile('flowpay-qr.png', canvas.toDataURL('image/png').split(',')[1], true, 'كود الدفع — فلو باي').catch(() => {});
            return;
        }
        canvas.toBlob(blob => {
            const file = new File([blob], 'flowpay-qr.png', { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                navigator.share({ files: [file], title: 'كود الدفع — فلو باي', text: text + '\n' + link }).catch(() => {});
            } else if (navigator.share) {
                navigator.share({ title: 'كود الدفع — فلو باي', text, url: link }).catch(() => {});
            } else {
                downloadBlob(blob, 'flowpay-qr.png');
                toast('تم تنزيل صورة الكود');
            }
        }, 'image/png');
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(svg))));
}

// ===== BENEFICIARIES =====
function renderContacts() {
    const bar = $('contactsBar');
    if (!contacts.length) {
        bar.innerHTML = '<p class="empty">لا يوجد مستفيدون محفوظون</p><button class="chip-add" onclick="showAddContact()">+ إضافة أول مستفيد</button>';
        return;
    }
    bar.innerHTML = contacts.map((c, i) => {
        const st = CATS[c.category] || CATS['آخر'];
        return `<div class="beneficiary-item" role="button" tabindex="0" onclick="pickContact(${i})"><span class="beneficiary-icon" style="background:${st[1]}">${st[0]}</span><span class="beneficiary-info"><span class="beneficiary-name">${esc(c.name)}</span><span class="beneficiary-phone">${esc(c.phone)}${c.category ? ' · ' + esc(c.category) : ''}</span></span><span class="beneficiary-actions"><button onclick="event.stopPropagation();showEditContact(${i})" aria-label="تعديل">✏️</button><button onclick="event.stopPropagation();askDel(${i})" aria-label="حذف">×</button></span></div>`;
    }).join('');
}

function setBeneficiaries(open) {
    $('beneficiariesPanel').classList.toggle('show', open);
    $('beneficiariesToggle').setAttribute('aria-expanded', String(open));
}
function toggleBeneficiaries() { vib(); setBeneficiaries(!$('beneficiariesPanel').classList.contains('show')); }

function pickContact(i) {
    vib();
    const c = contacts[i];
    if (!c) return;
    $('phone').value = c.phone;
    $('phoneErr').classList.remove('show');
    $('phone').classList.remove('error');
    if (c.lastAmount) { $('amount').value = c.lastAmount; renderAmounts(); }
    setBeneficiaries(false);
    toast('تم اختيار ' + c.name);
    gen();
}

function askDel(i) {
    vib();
    const c = contacts[i];
    if (!c) return;
    ask('حذف المستفيد؟', c.name + ' - ' + c.phone, 'حذف', () => {
        contacts.splice(i, 1);
        saveContacts();
        renderContacts();
        renderRecent();
        gen();
        toast('تم الحذف');
    });
}

function fillContactForm(i, c, title) {
    editContactIdx = i;
    $('cName').value = c.name || '';
    $('cPhone').value = c.phone || '';
    $('cPhoneErr').classList.remove('show');
    $('contactTitle').textContent = title;
    selCategory = c.category || '';
    document.querySelectorAll('#catsGrid .cat-btn').forEach(b => b.classList.toggle('sel', b.dataset.cat === selCategory));
}
function showAddContact() { vib(); fillContactForm(-1, {}, 'إضافة مستفيد'); openOv('ovContact'); }
function showEditContact(i) {
    vib();
    if (!contacts[i]) return;
    fillContactForm(i, contacts[i], 'تعديل المستفيد');
    openOv('ovContact');
}

function renderCats() {
    $('catsGrid').innerHTML = Object.keys(CATS).map(c => `<button class="cat-btn" data-cat="${c}" onclick="selCat(this)">${c}</button>`).join('');
}
function selCat(el) {
    vib();
    selCategory = el.dataset.cat;
    document.querySelectorAll('#catsGrid .cat-btn').forEach(b => b.classList.toggle('sel', b === el));
}
function valCPhone() {
    const el = $('cPhone');
    const v = normalizePhone(el.value);
    if (v !== el.value) el.value = v;
    $('cPhoneErr').classList.toggle('show', v.length >= 2 && (v.startsWith('05') ? v.length > 10 : !/^(\+|00|9)/.test(v)));
}

function saveContact() {
    const name = $('cName').value.trim().slice(0, 40), phone = normalizePhone($('cPhone').value);
    if (!name) { toast('أدخل الاسم'); return; }
    if (!isValidPh(phone)) { toast('الرقم يجب أن يبدأ بـ 05 (10 أرقام)'); return; }
    const dup = contacts.findIndex(c => c.phone === phone);
    if (dup >= 0 && dup !== editContactIdx) { toast('هذا الرقم محفوظ مسبقاً'); return; }
    if (editContactIdx >= 0 && contacts[editContactIdx]) {
        contacts[editContactIdx] = { ...contacts[editContactIdx], name, phone, category: selCategory };
        toast('تم تحديث المستفيد');
    } else {
        contacts.push({ name, phone, category: selCategory });
        toast('تم الحفظ');
    }
    editContactIdx = -1;
    saveContacts();
    renderContacts();
    renderRecent();
    gen();
    closeOv('ovContact');
    vib(25);
}

// ===== HISTORY =====
let dateFmt = null;
try { dateFmt = new Intl.DateTimeFormat('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) {}
function fmtDate(h) {
    if (typeof h.ts === 'number' && dateFmt) return dateFmt.format(new Date(h.ts));
    return h.date || '';
}

function filteredHist() {
    const f = histFilterVal;
    const q = toDigits($('histSearch').value.trim()).toLowerCase();
    const names = {};
    contacts.forEach(c => { names[c.phone] = c.name; });
    return hist.filter(h => {
        if (SVC[f] && h.service !== SVC[f].name) return false;
        if (f === 'success' && h.status !== 'نجح') return false;
        if (f === 'failed' && h.status !== 'فشل') return false;
        if (f === 'unknown' && (h.status || !h.amount)) return false;
        if (!q) return true;
        return (h.phone && h.phone.includes(q)) || (h.service && h.service.includes(q)) ||
            (h.phone && names[h.phone] && names[h.phone].toLowerCase().includes(q));
    });
}

function renderHistFull() {
    const container = $('histFull');
    const list = filteredHist();
    if (!list.length) { container.innerHTML = '<div class="hist-empty">لا توجد حركات</div>'; return; }
    const names = {};
    contacts.forEach(c => { names[c.phone] = c.name; });
    let html = list.slice(0, histShown).map(h => {
        const cls = h.status === 'نجح' ? 's-ok' : h.status === 'فشل' ? 's-fail' : 's-none';
        const id = esc(h.id);
        // فتح قائمة البنك ليس تحويلاً — لا حالة له. والحالة يضعها المستخدم فقط ويقدر يغيّرها
        const mark = !h.amount ? '' : h.status
            ? `<button class="hist-undo" onclick="markHistStatus('${id}','')">تعديل</button>`
            : `<div class="hist-mark"><button class="hm-yes" onclick="markHistStatus('${id}','نجح')">✓ نجح</button><button class="hm-no" onclick="markHistStatus('${id}','فشل')">✕ فشل</button></div>`;
        const status = h.amount ? `<br><span class="hist-status ${cls}">● ${esc(h.status || 'غير مؤكد')}</span>` : '';
        const k = svcKey(h.service);
        const repeat = k && k !== 'bop' && isValidPh(h.phone) && isValidAmt(h.amount)
            ? `<button class="hist-repeat" onclick="repeatTransfer('${k}','${h.phone}','${esc(h.amount)}','${h.transferType === 'تاجر' ? '2' : '1'}')">🔁 كرّر</button>` : '';
        const who = h.phone ? ' ← <strong class="who">' + esc(names[h.phone] || h.phone) + '</strong>' : '';
        return `<div class="hist-item"><span class="hist-time">${esc(fmtDate(h))}</span><span class="svc">${esc(h.service)}${h.transferType ? ' · ' + esc(h.transferType) : ''}</span>${who}${h.amount ? '<br>المبلغ: <strong>' + esc(h.amount) + ' ₪</strong>' : ''}${status}${mark}${repeat}</div>`;
    }).join('');
    if (list.length > histShown) html += `<button class="hist-more" onclick="moreHist()">عرض المزيد (${list.length - histShown})</button>`;
    container.innerHTML = html;
}
function repeatTransfer(svc, phone, amount, type) {
    vib();
    fillTransfer({ svc, phone, amount, type }, 'جاهز للتكرار');
}
function moreHist() { histShown += 100; renderHistFull(); }

function markHistStatus(id, s) {
    vib();
    const h = hist.find(h => h.id === id);
    if (!h) return;
    h.status = s;
    saveHist();
    renderHistFull();
    renderAnalytics();
    if (id === session.get('fp_pending')) showPending();
    if (s) toast(s === 'نجح' ? 'تم تعليمها كناجحة' : 'تم تعليمها كفاشلة');
}

function setHistFilter(val) {
    vib();
    histFilterVal = val;
    histShown = 60;
    document.querySelectorAll('.hist-filter').forEach(f => f.classList.toggle('sel', f.dataset.f === val));
    renderHistFull();
}
let searchTimer = null;
function filterHist() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { histShown = 60; renderHistFull(); }, 120);
}
function askClearHist() {
    vib();
    if (!hist.length) { toast('السجل فارغ'); return; }
    ask('مسح السجل؟', 'سيتم حذف جميع الحركات (' + hist.length + ') نهائياً', 'مسح', () => {
        hist = [];
        saveHist();
        renderHistFull();
        renderAnalytics();
        toast('تم مسح السجل');
    });
}

function renderAnalytics() {
    const now = new Date(), month = now.getMonth(), year = now.getFullYear();
    let total = 0, count = 0;
    const svcCount = {}, phoneCount = {};
    hist.forEach(h => {
        if (h.status === 'فشل' || !(parseFloat(h.amount) > 0)) return;
        const t = typeof h.ts === 'number' ? h.ts : Date.parse(h.date);
        if (isNaN(t)) return;
        const d = new Date(t);
        if (d.getMonth() !== month || d.getFullYear() !== year) return;
        count++;
        total += parseFloat(h.amount) || 0;
        const s = h.service || 'غير محدد';
        svcCount[s] = (svcCount[s] || 0) + 1;
        if (h.phone) phoneCount[h.phone] = (phoneCount[h.phone] || 0) + 1;
    });
    const top = obj => Object.entries(obj).reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
    const [topSvc] = top(svcCount);
    const [topPhone, maxPh] = top(phoneCount);
    $('statTotal').textContent = (Math.round(total * 100) / 100) + ' ₪';
    $('statSuccess').textContent = count;
    $('statTop').textContent = topSvc || '-';
    $('statTopContact').textContent = topPhone ? (contactName(topPhone) || topPhone) + ' (' + maxPh + ')' : '-';
    drawPieChart(svcCount);
}

function drawPieChart(data) {
    const canvas = $('pieChart'), legend = $('pieLegend');
    if (!canvas.getContext) return;
    // رسم حاد على شاشات الجوال عالية الدقة
    const size = 120, dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const c = size / 2, r = 50;
    const entries = Object.entries(data);
    if (!entries.length) {
        legend.innerHTML = '';
        ctx.fillStyle = 'rgba(94,200,195,0.15)';
        ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#94a3b8'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('لا توجد بيانات', c, c + 4);
        return;
    }
    const total = entries.reduce((s, e) => s + e[1], 0);
    const colors = ['#5ec8c3', '#2b8fd0', '#f59e0b', '#ef4444', '#8b5cf6', '#4ade80'];
    let a = -Math.PI / 2;
    entries.forEach(([, n], i) => {
        const slice = (n / total) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, r, a, a + slice); ctx.closePath();
        ctx.fillStyle = colors[i % colors.length]; ctx.fill();
        a += slice;
    });
    // ثقب في الوسط (دونات)
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(c, c, 26, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    legend.innerHTML = entries.map(([label, n], i) =>
        `<div class="legend-row"><span class="legend-swatch" style="background:${colors[i % colors.length]}"></span><span>${esc(label)} — ${Math.round((n / total) * 100)}%</span></div>`
    ).join('');
}

// ===== SETTINGS & BACKUP =====
function showSettings() {
    vib();
    $('setLargeThreshold').value = threshold();
    $('setHistLimit').value = histLimit();
    $('appVersion').textContent = APP_VERSION;
    $('setInApp').checked = store.get('fp_inapp') !== '0';
    openOv('ovSettings');
}

function saveSettings() {
    const lt = parseInt(toDigits($('setLargeThreshold').value), 10);
    const hl = parseInt(toDigits($('setHistLimit').value), 10);
    if (lt > 0) store.set('fp_large_threshold', String(lt));
    if (hl >= 50 && hl <= 1000) {
        store.set('fp_hist_limit', String(hl));
        if (hist.length > hl) { hist.length = hl; saveHist(); }
    } else if ($('setHistLimit').value) {
        toast('حد السجل يجب أن يكون بين 50 و 1000');
        return;
    }
    store.set('fp_inapp', $('setInApp').checked ? '1' : '0');
    closeOv('ovSettings');
    toast('تم حفظ الإعدادات');
    if (curPage === 'history') { renderHistFull(); renderAnalytics(); }
    gen();
}

function stamp() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function exportData() {
    vib();
    const payload = {
        app: 'flowpay', version: APP_VERSION, exportedAt: new Date().toISOString(),
        contacts, hist,
        settings: { largeThreshold: String(threshold()), histLimit: String(histLimit()) }
    };
    const json = JSON.stringify(payload, null, 2);
    const name = 'flowpay-backup-' + stamp() + '.json';
    if (Native.isNative) {
        Native.shareFile(name, json, false, 'نسخة فلو باي الاحتياطية').catch(() => {});
        return;
    }
    downloadBlob(new Blob([json], { type: 'application/json' }), name);
    toast('تم تنزيل النسخة الاحتياطية');
}

function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ملف النسخة قد يأتي من أي مكان: نأخذ منه الحقول المعروفة فقط وبالأنواع الصحيحة
function cleanContacts(list) {
    const seen = new Set();
    return list.map(c => {
        if (!c || typeof c !== 'object') return null;
        const phone = normalizePhone(c.phone);
        const name = String(c.name || '').trim().slice(0, 40);
        if (!name || !isValidPh(phone) || seen.has(phone)) return null;
        seen.add(phone);
        const out = { name, phone, category: CATS[c.category] ? c.category : '' };
        const amt = cleanAmount(c.lastAmount);
        if (isValidAmt(amt)) out.lastAmount = amt;
        return out;
    }).filter(Boolean);
}
function cleanHist(list) {
    const str = v => (v == null ? '' : String(v).slice(0, 60));
    return list.map((h, i) => {
        if (!h || typeof h !== 'object') return null;
        const out = {
            id: str(h.id) || (Number(h.ts) || 0) + '-' + i,
            service: str(h.service), phone: str(h.phone), amount: str(h.amount),
            transferType: str(h.transferType), status: h.status === 'نجح' || h.status === 'فشل' ? h.status : ''
        };
        if (typeof h.ts === 'number') out.ts = h.ts;
        else if (h.date) out.date = str(h.date);
        return out;
    }).filter(Boolean);
}

function importData(ev) {
    const input = ev.target;
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        input.value = '';
        let data;
        try { data = JSON.parse(reader.result); } catch (e) { toast('فشل قراءة الملف — تأكد أنه نسخة احتياطية صحيحة'); return; }
        if (!data || data.app !== 'flowpay') { toast('ملف غير صالح'); return; }
        const newContacts = Array.isArray(data.contacts) ? cleanContacts(data.contacts) : null;
        const newHist = Array.isArray(data.hist) ? cleanHist(data.hist) : null;
        const text = 'سيتم استبدال بياناتك الحالية ببيانات الملف' +
            ' (' + (newContacts ? newContacts.length : 0) + ' مستفيد، ' + (newHist ? newHist.length : 0) + ' حركة).';
        ask('استيراد النسخة؟', text, 'استيراد', () => {
            if (newContacts) { contacts = newContacts; saveContacts(); }
            if (newHist) { hist = newHist.slice(0, histLimit()); saveHist(); }
            const s = data.settings || {};
            const lt = parseInt(s.largeThreshold, 10), hl = parseInt(s.histLimit, 10);
            if (lt > 0) store.set('fp_large_threshold', String(lt));
            if (hl >= 50 && hl <= 1000) store.set('fp_hist_limit', String(hl));
            renderContacts();
            if (curPage === 'history') { renderHistFull(); renderAnalytics(); }
            toast('تم استيراد البيانات بنجاح');
        }, 'ovSettings');
    };
    reader.onerror = () => { input.value = ''; toast('خطأ في قراءة الملف'); };
    reader.readAsText(file);
}

function resetAllData() {
    ask('حذف جميع البيانات؟', 'سيتم حذف جميع المستفيدين والسجل نهائياً — لا يمكن التراجع عن هذا', 'حذف الكل', () => {
        contacts = [];
        hist = [];
        ['fp_contacts', 'fp_templates', 'fp_debts', 'fp_hist', 'fp_my_phone'].forEach(store.del);
        renderContacts();
        if (curPage === 'history') { renderHistFull(); renderAnalytics(); }
        toast('تم حذف جميع البيانات');
    }, 'ovSettings');
}

// ===== QR SCANNER =====
// BarcodeDetector المدمج إن وُجد (أسرع)، وإلا jsQR — يُحمَّل عند أول استخدام فقط
let scanStream = null, scanTimer = null, detector = null, scanCanvas = null, jsqrLoading = null, lastBadScan = '';

async function getDetector() {
    if (detector !== null) return detector;
    detector = false;
    try {
        if ('BarcodeDetector' in window) {
            const formats = await BarcodeDetector.getSupportedFormats();
            if (formats.includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] });
        }
    } catch (e) {}
    return detector;
}
function loadJsQR() {
    if (window.jsQR) return Promise.resolve();
    if (!jsqrLoading) {
        jsqrLoading = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'vendor/jsQR.js';
            s.onload = resolve;
            s.onerror = () => { jsqrLoading = null; s.remove(); reject(); };
            document.head.appendChild(s);
        });
    }
    return jsqrLoading;
}

async function startScanner() {
    vib();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('جهازك لا يدعم الكاميرا هنا'); return; }
    if (!(await getDetector())) {
        try { await loadJsQR(); } catch (e) { toast('تعذّر تحميل ماسح QR'); return; }
    }
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    } catch (e) {
        const n = e && e.name;
        if (n === 'NotAllowedError' || n === 'SecurityError') toast('رفض إذن الكاميرا — فعّله من الإعدادات');
        else if (n === 'NotFoundError' || n === 'OverconstrainedError') toast('لا توجد كاميرا متاحة');
        else if (n === 'NotReadableError') toast('الكاميرا مستخدمة من تطبيق آخر');
        else toast('تعذّر فتح الكاميرا');
        return;
    }
    scanStream = stream;
    lastBadScan = '';
    const video = $('scanVideo');
    video.srcObject = stream;
    openOv('scannerWrap');
    try { await video.play(); } catch (e) {}
    scanTimer = setTimeout(scanTick, 300);
}

async function scanTick() {
    scanTimer = null;
    if (!scanStream) return;
    const v = $('scanVideo');
    if (v.readyState >= 2 && v.videoWidth) {
        try {
            let result = null;
            if (detector) {
                const codes = await detector.detect(v);
                if (codes.length) result = codes[0].rawValue;
            } else if (window.jsQR) {
                // نصغّر الإطار قبل التحليل: أسرع بكثير على الأجهزة الضعيفة ويكفي لقراءة الكود
                const k = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
                const w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k);
                if (!scanCanvas) scanCanvas = document.createElement('canvas');
                if (scanCanvas.width !== w) scanCanvas.width = w;
                if (scanCanvas.height !== h) scanCanvas.height = h;
                const ctx = scanCanvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(v, 0, 0, w, h);
                const qr = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
                if (qr) result = qr.data;
            }
            if (!scanStream) return;
            if (result) {
                if (useScanResult(result)) return;
                if (result !== lastBadScan) { lastBadScan = result; toast('هذا الكود ليس كود دفع معروف'); }
            }
        } catch (e) {}
    }
    scanTimer = setTimeout(scanTick, detector ? 150 : 100);
}

// رابط دفع فلو باي، أو لافتة تاجر (معيار سلطة النقد)، أو رقم جوال فقط
function useScanResult(result) {
    const link = parsePayload(result);
    const merchant = link ? null : parseMerchantQR(result);
    if (!link && !merchant) return false;
    vib(50);
    closeOv('scannerWrap');
    // ننتظر إغلاق الكاميرا (خطوة رجوع) قبل فتح أي نافذة جديدة
    setTimeout(() => link ? fillTransfer(link, 'تم مسح QR') : handleScanned(merchant), 250);
    return true;
}

// قراءة الكود من صورة محفوظة (لقطة شاشة أو صورة لافتة وصلتك على واتساب).
// الصورة قد تحوي أكثر من كود أو يكون الكود صغيرًا فيها: نجرّب الصورة كاملة ثم أجزاءها
async function scanImageFile(ev) {
    const input = ev.target, file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    toast('جارٍ قراءة الصورة…');
    try {
        await loadJsQR();
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.src = url;
        await img.decode();
        URL.revokeObjectURL(url);
        const W = img.naturalWidth, H = img.naturalHeight;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const read = (x, y, w, h, max, blur) => {
            const k = Math.min(1, max / Math.max(w, h));
            canvas.width = Math.round(w * k);
            canvas.height = Math.round(h * k);
            ctx.filter = blur ? 'blur(' + blur + 'px)' : 'none';
            ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
            const qr = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            return qr && qr.data;
        };
        const regions = [[0, 0, W, H]];
        for (const n of [2, 3]) {
            const w = W / n, h = H / n;
            for (let y = 0; y + h <= H + 1; y += h / 2) for (let x = 0; x + w <= W + 1; x += w / 2) regions.push([x, y, w, h]);
        }
        let bad = false;
        for (const [x, y, w, h] of regions) {
            for (const [max, blur] of [[1000, 0], [600, 0], [1000, 2]]) {
                const data = read(x, y, w, h, max, blur);
                if (!data) continue;
                if (useScanResult(data)) return;
                bad = true;
                break;
            }
            await new Promise(r => setTimeout(r));   // لا نجمّد الواجهة
        }
        toast(bad ? 'هذا الكود ليس كود دفع معروف' : 'ما لقينا كود QR في الصورة');
    } catch (e) {
        toast('تعذّرت قراءة الصورة');
    }
}

function stopScanner() {
    if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
    clearTimeout(scanTimer);
    scanTimer = null;
    $('scanVideo').srcObject = null;
}

// ===== INSTALL (PWA) & UPDATES =====
function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function hideInstallUI() {
    $('installManualBtn').hidden = true;
    $('installBanner').classList.remove('show');
}

window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (!store.get('fp_install_dismissed')) $('installBanner').classList.add('show');
});
window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallUI();
    toast('تم تثبيت التطبيق بنجاح!');
});

function installApp() {
    if (!deferredPrompt) { showInstallGuide(); return; }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(choice => {
        if (choice.outcome === 'accepted') hideInstallUI();
        deferredPrompt = null;
    });
}
function dismissInstall() { $('installBanner').classList.remove('show'); store.set('fp_install_dismissed', '1'); }

function showInstallGuide() {
    vib();
    if (deferredPrompt) { installApp(); return; }
    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /android/i.test(ua);
    const isWebView = /FBAN|FBAV|Instagram|Line\/|; wv\)|WebView/i.test(ua);
    // داخل متصفح فيسبوك/إنستغرام لا يمكن التثبيت: نفتح الرابط في Chrome
    if (isWebView && isAndroid) {
        location.href = 'intent://' + APP_URL.replace(/^https:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
        toast('جارٍ فتح المتصفح...');
        return;
    }
    if (isIOS) {
        $('installGuideTitle').textContent = 'خطوة واحدة';
        $('installSteps').innerHTML = '<li><span class="step-num">1</span><span>افتح الموقع في <strong>Safari</strong> ← اضغط 📤 ← <strong>إضافة للشاشة الرئيسية</strong></span></li>';
    } else {
        $('installGuideTitle').textContent = 'تثبيت التطبيق';
        $('installSteps').innerHTML = '<li><span class="step-num">1</span><span>اضغط على <strong>⋮</strong> (أعلى المتصفح)</span></li><li><span class="step-num">2</span><span>اختر <strong>"إضافة إلى الشاشة الرئيسية"</strong> أو <strong>"تثبيت التطبيق"</strong></span></li>';
    }
    openOv('ovInstall');
}

function registerSW() {
    if (Native.isNative || !('serviceWorker' in navigator) || location.protocol === 'file:') return;
    const hadController = !!navigator.serviceWorker.controller;
    const showBar = () => $('updateBar').classList.add('show');
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
        if (reg.waiting && hadController) { newWorker = reg.waiting; showBar(); }
        reg.addEventListener('updatefound', () => {
            const w = reg.installing;
            w.addEventListener('statechange', () => {
                if (w.state === 'installed' && navigator.serviceWorker.controller) { newWorker = w; showBar(); }
            });
        });
        // نبحث عن تحديث كلما عاد المستخدم للتطبيق
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        // أول تثبيت لا يحتاج إعادة تحميل؛ فقط حين يحلّ إصدار جديد محل القديم
        if (!hadController || reloaded) return;
        reloaded = true;
        location.reload();
    });
}

function applyUpdate() {
    $('updateBar').classList.remove('show');
    if (newWorker) { newWorker.postMessage('skipWaiting'); return; }
    navigator.serviceWorker.getRegistration().then(reg => {
        if (reg && reg.waiting) reg.waiting.postMessage('skipWaiting');
        else location.reload();
    });
}

// ===== KEYBOARD =====
// لوحة المفاتيح تأخذ نصف الشاشة، والشريط السفلي وزر التحويل (ثابتان أسفل الشاشة) يصعدان فوقها
// فيغطّيان الحقل الذي تكتب فيه. أثناء الكتابة: نخفي الشريط السفلي، نصغّر زر التحويل، ونمرّر
// الحقل إلى منتصف المساحة الظاهرة.
const vv = window.visualViewport;
let fullH = 0, fullW = 0, kbOpen = false;
function isTyping() {
    const a = document.activeElement;
    return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|file|button|submit|range)$/.test(a.type)));
}
function updateKeyboard() {
    const h = vv ? vv.height * vv.scale : window.innerHeight, w = window.innerWidth;
    if (w !== fullW) { fullW = w; fullH = h; }   // تدوير الشاشة
    if (h > fullH) fullH = h;
    const open = isTyping() && fullH - h > 120;
    // المتصفحات التي تُبقي الصفحة بحجمها وتضع اللوحة فوقها (آيفون): نرفع العناصر الثابتة بمقدارها
    const inset = open && vv ? Math.max(0, Math.round(window.innerHeight - vv.height * vv.scale - vv.offsetTop)) : 0;
    document.documentElement.style.setProperty('--kb', inset + 'px');
    document.body.classList.toggle('kb-tight', open && h < 380);
    if (open === kbOpen) return;
    kbOpen = open;
    document.body.classList.toggle('kb-open', open);
    if (open) revealFocused();
}
function revealFocused() {
    const a = document.activeElement;
    if (!kbOpen || !isTyping()) return;
    setTimeout(() => {
        try { a.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { a.scrollIntoView(); }
    }, 60);
}
function initKeyboard() {
    if (vv) { vv.addEventListener('resize', updateKeyboard); vv.addEventListener('scroll', updateKeyboard); }
    window.addEventListener('resize', updateKeyboard);
    document.addEventListener('focusin', () => { updateKeyboard(); revealFocused(); });
    document.addEventListener('focusout', () => setTimeout(updateKeyboard, 60));
    updateKeyboard();
    // زر «التالي/تم» في لوحة المفاتيح ينقل للحقل التالي بدل أن لا يفعل شيئًا
    const chain = { phone: 'amount', amount: 'pin', pin: '', cName: 'cPhone', cPhone: '' };
    Object.keys(chain).forEach(id => $(id).addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const next = chain[id] && $(chain[id]);
        if (next && next.offsetParent !== null) next.focus(); else e.target.blur();
    }));
}

// ===== INIT =====
function init() {
    if (Native.isNative || isStandalone()) hideInstallUI();
    $('pickContactBtn').hidden = !hasContactPicker;
    $('phone').classList.toggle('has-icon', hasContactPicker);
    renderCats();
    renderContacts();

    // بداية نظيفة لسجل الرجوع (بعد إعادة تحميل قد يبقى state قديم)
    if (history.state) history.replaceState(null, '');

    // رابط دفع: ?svc=jawwal&phone=05...&amt=10
    if (location.search) {
        const p = parsePayload(location.href);
        history.replaceState(null, '', location.pathname);
        if (p) fillTransfer(p, 'رابط دفع');
        else if (new URLSearchParams(location.search).get('svc')) toast('رابط الدفع غير صالح');
    }

    if (Native.onLink) Native.onLink(url => { const p = parsePayload(url); if (p) fillTransfer(p, 'رابط دفع'); });

    // زر الرجوع في أندرويد: يغلق النافذة المفتوحة أو يرجع من السجل، ومن الشاشة الرئيسية يصغّر التطبيق.
    // أثناء انتظار رد الشبكة لا يفعل شيئًا.
    if (Native.onBack) Native.onBack(() => {
        if ($('ovBusy').classList.contains('show')) return;
        if (document.querySelector('.overlay.show, .scanner-wrap.show') || curPage !== 'home') history.back();
        else Native.minimize();
    });

    initKeyboard();

    // يفتح على آخر محفظة استخدمتها: اكتب الرقم مباشرة
    const last = store.get('fp_last_svc', '');
    if (!tab && SVC[last]) selectService(last);
    renderRecent();

    if (!store.get('fp_onboarded')) openOv('ovOnboard');

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { if (scanStream) closeOv('scannerWrap'); }
        else showPending();
    });
    window.addEventListener('pageshow', showPending);
    showPending();
    registerSW();
}

init();
