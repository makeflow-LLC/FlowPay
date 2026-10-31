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
    // الرجوع من نافذة «تم التحويل؟» = تبقى الحركة ناجحة ولا نسأل مرة أخرى
    if (id === 'ovStatus') { session.set('fp_pending', ''); session.set('fp_pending_phone', ''); }
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
    renderRecent();
    gen();
}
function switchTab(t) { vib(); selectService(t); }

function setJawwalType(type) { vib(); jawwalType = type; updateTypeUI(); onPhoneInput(); }
function updateTypeUI() {
    document.querySelectorAll('#jawwalTypeGroup button').forEach(b => b.classList.toggle('active', b.dataset.type === jawwalType));
    $('phoneLabel').textContent = tab === 'jawwal' ? (jawwalType === '2' ? 'رقم التاجر' : 'رقم الصديق') : 'رقم المحوّل إليه';
}

// آخر من حوّلت لهم بهذه المحفظة: ضغطة وحدة تعبّي الرقم والمبلغ
function renderRecent() {
    const bar = $('recentBar');
    const seen = new Set(), items = [];
    for (const h of hist) {
        if (items.length >= 5) break;
        if (h.service !== (SVC[tab] && SVC[tab].name) || !isValidPh(h.phone) || seen.has(h.phone) || h.status === 'فشل') continue;
        seen.add(h.phone);
        items.push(h);
    }
    bar.hidden = !items.length || tab === 'bop';
    bar.innerHTML = items.map(h => {
        const name = contactName(h.phone);
        return `<button class="recent-chip" onclick="useRecent('${h.phone}','${esc(isValidAmt(h.amount) ? h.amount : '')}')"><b>${esc(name || h.phone)}</b><small>${name ? esc(h.phone.slice(-4)) + ' · ' : ''}${esc(h.amount || '')} ₪</small></button>`;
    }).join('');
}
function useRecent(phone, amount) {
    vib();
    $('phone').value = phone;
    $('phoneErr').classList.remove('show');
    $('phone').classList.remove('error');
    if (amount) { $('amount').value = amount; clearAmtBtns('sendAmounts'); }
    gen();
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
        if (pin) steps.push('التحويل يتم بخطوة وحدة — استنى رسالة التأكيد من جوال باي');
        else steps.push('رح تفتح قائمة جوال باي — أدخل الرقم والمبلغ والرقم السري لما يطلبهم');
    } else if (tab === 'palpay') {
        steps.push(pin ? 'لما يطلب الرقم السري: اضغط مطوّلاً ← لصق (منسوخ جاهز)' : 'لما يطلب الرقم السري: اكتبه وأكّد');
    } else if (tab === 'bop') {
        steps.push(pin ? 'رح تدخل قائمة بنك فلسطين مباشرة — اختر نوع العملية' : 'رح يطلب الرقم السري ثم تظهر قائمة البنك');
    }
    if (Native.ussd && !store.get('fp_call_ok')) steps.push('أول مرة: اسمح لفلو باي بإجراء المكالمات حتى يتصل مباشرة');
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

async function proceedCall() {
    vib(40);
    if (!isReady()) { closeOv('ovConfirm'); return; }
    const code = buildCode();
    let simId = -1;
    if (Native.ussd) {
        simId = await chooseSim(tab);
        if (simId === null) return;   // ألغى اختيار الشريحة
    }
    const { phone, amount, pin } = formValues();
    const bop = tab === 'bop';
    const entry = {
        id: newId(), service: SVC[tab].name, phone: bop ? '' : phone, amount: bop ? '' : amount,
        transferType: tab === 'jawwal' ? (jawwalType === '2' ? 'تاجر' : 'صديق') : '',
        ts: Date.now(), status: 'نجح'
    };
    hist.unshift(entry);
    if (hist.length > histLimit()) hist.length = histLimit();
    saveHist();
    const ci = contacts.findIndex(c => c.phone === phone);
    if (ci >= 0 && amount && !bop) { contacts[ci].lastAmount = amount; saveContacts(); }

    // نتذكر الحركة المعلّقة حتى لو أغلق النظام الصفحة أثناء المكالمة
    session.set('fp_pending', entry.id);
    session.set('fp_pending_phone', !bop && ci < 0 ? phone : '');
    const open = document.querySelector('.overlay.show');
    const fullCode = tab === 'jawwal' && /^\d{4}$/.test(pin) && isValidTo(phone);

    // الرقم السري لا يبقى في الحقل بعد استخدامه
    $('pin').value = '';
    $('pin').type = 'password';
    renderRecent();

    if (!CAN_DIAL) {
        iosCode = code;
        copyText(code).catch(() => {});
        $('iosCode').textContent = code;
        if (open) swapOv(open.id, 'ovIos'); else openOv('ovIos');
        return;
    }

    // تنفيذ داخل التطبيق: الكود الكامل فقط (جوال باي مع الرقم السري) — لا قوائم تحتاج رداً
    if (Native.ussd && fullCode && store.get('fp_inapp') === '1') {
        if (open) swapOv(open.id, 'ovBusy'); else openOv('ovBusy');
        let res;
        try { res = await Native.ussd.send(code, simId); } catch (e) { res = { ok: false }; }
        $('statusMsg').hidden = false;
        $('statusMsg').textContent = res.ok && res.message
            ? res.message
            : '⚠️ ما وصل رد من الشبكة. افحص رسائل جوال باي قبل ما تعيد المحاولة — لا تكرر التحويل قبل ما تتأكد.';
        swapOv('ovBusy', 'ovStatus');
        return;
    }

    if (open) closeOv(open.id);
    if (tab === 'palpay' && pin) {
        copyText(pin).then(() => toast('تم نسخ الرقم السري — الصقه عند الطلب'), () => {});
    } else if (!pin && tab !== 'palpay') {
        toast('ستمر بعدة خطوات يدوية');
    }
    setTimeout(() => {
        if (Native.ussd) {
            // نافذة إذن الاتصال قد تُخفي الصفحة لحظة — لا نسأل «تم التحويل؟» قبل أن تبدأ المكالمة
            dialing = true;
            Native.ussd.dial(code, simId).then(r => {
                if (r && r.mode === 'call') store.set('fp_call_ok', '1');
                if (r && r.mode === 'dialer') toast('اضغط زر الاتصال في المتصل');
            }).catch(() => { location.href = 'tel:' + code.replace(/#/g, '%23'); })
              .finally(() => setTimeout(() => { dialing = false; maybeShowStatus(); }, 1500));
        } else {
            location.href = 'tel:' + code.replace(/#/g, '%23');
        }
    }, tab === 'palpay' ? 700 : 120);
}

let dialing = false;
function maybeShowStatus() {
    if (!session.get('fp_pending') || document.hidden || dialing) return;
    setTimeout(() => {
        if (session.get('fp_pending') && !document.hidden && !document.querySelector('.overlay.show')) {
            $('statusMsg').hidden = true;
            openOv('ovStatus');
        }
    }, 600);
}

function setStatus(s) {
    const id = session.get('fp_pending'), phone = session.get('fp_pending_phone');
    session.set('fp_pending', '');
    session.set('fp_pending_phone', '');
    const h = hist.find(h => h.id === id);
    if (h) { h.status = s; saveHist(); }
    toast(s === 'نجح' ? 'تم تسجيل: تحويل ناجح' : 'تم تسجيل: تحويل فاشل');
    if (phone && s === 'نجح' && !contacts.some(c => c.phone === phone)) {
        $('savePhone').textContent = phone;
        swapOv('ovStatus', 'ovSave');
    } else {
        closeOv('ovStatus');
    }
}

function acceptSave() {
    const ph = $('savePhone').textContent;
    fillContactForm(-1, { phone: ph, name: scanNames[ph] || '' }, 'حفظ المستفيد');
    swapOv('ovSave', 'ovContact');
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
    clearAmtBtns('sendAmounts');
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
const hasContactPicker = 'contacts' in navigator && 'ContactsManager' in window;
async function pickFromPhone() {
    vib();
    try {
        const picked = await navigator.contacts.select(['tel', 'name'], { multiple: false });
        if (!picked || !picked.length) return;
        const phone = normalizePhone((picked[0].tel && picked[0].tel[0]) || '');
        $('phone').value = phone;
        onPhoneInput();
        const name = picked[0].name && picked[0].name[0];
        if (!isValidPh(phone)) toast('الرقم المختار ليس رقم جوال فلسطيني');
        else if (name) toast('تم اختيار: ' + name);
    } catch (e) {
        toast('لم يتم اختيار جهة اتصال');
    }
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
    if (c.lastAmount) { $('amount').value = c.lastAmount; clearAmtBtns('sendAmounts'); }
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
        const mark = h.status ? '' : `<div class="hist-mark"><button class="hm-yes" onclick="markHistStatus('${id}','نجح')">✓ نجح</button><button class="hm-no" onclick="markHistStatus('${id}','فشل')">✕ فشل</button></div>`;
        const k = svcKey(h.service);
        const repeat = k && k !== 'bop' && isValidPh(h.phone) && isValidAmt(h.amount)
            ? `<button class="hist-repeat" onclick="repeatTransfer('${k}','${h.phone}','${esc(h.amount)}','${h.transferType === 'تاجر' ? '2' : '1'}')">🔁 كرّر</button>` : '';
        const who = h.phone ? ' ← <strong class="who">' + esc(names[h.phone] || h.phone) + '</strong>' : '';
        return `<div class="hist-item"><span class="hist-time">${esc(fmtDate(h))}</span><span class="svc">${esc(h.service)}${h.transferType ? ' · ' + esc(h.transferType) : ''}</span>${who}${h.amount ? '<br>المبلغ: <strong>' + esc(h.amount) + ' ₪</strong>' : ''}<br><span class="hist-status ${cls}">● ${esc(h.status || 'بدون حالة')}</span>${mark}${repeat}</div>`;
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
    toast(s === 'نجح' ? 'تم تعليمها كناجحة' : 'تم تعليمها كفاشلة');
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
        if (h.status !== 'نجح') return;
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
    $('setInApp').checked = store.get('fp_inapp') === '1';
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
                const link = parsePayload(result);
                const merchant = link ? null : parseMerchantQR(result);
                if (link || merchant) {
                    vib(50);
                    closeOv('scannerWrap');
                    // ننتظر إغلاق الكاميرا (خطوة رجوع) قبل فتح أي نافذة جديدة
                    setTimeout(() => link ? fillTransfer(link, 'تم مسح QR') : handleScanned(merchant), 250);
                    return;
                }
                if (result !== lastBadScan) { lastBadScan = result; toast('هذا الكود ليس كود دفع معروف'); }
            }
        } catch (e) {}
    }
    scanTimer = setTimeout(scanTick, detector ? 150 : 100);
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

    if (!store.get('fp_onboarded')) openOv('ovOnboard');

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { if (scanStream) closeOv('scannerWrap'); }
        else maybeShowStatus();
    });
    window.addEventListener('pageshow', maybeShowStatus);
    maybeShowStatus();
    registerSW();
}

init();
