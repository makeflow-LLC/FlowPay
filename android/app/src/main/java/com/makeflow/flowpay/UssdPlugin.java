package com.makeflow.flowpay;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.List;

/**
 * أكواد USSD من داخل التطبيق:
 *  - dial: اتصال مباشر بالكود (بدون شاشة المتصل) ومن الشريحة المختارة.
 *    إن رفض المستخدم إذن الاتصال نفتح المتصل بالكود جاهزًا كما في نسخة الويب.
 *  - send: تنفيذ الكود داخل التطبيق وقراءة رد الشبكة (أندرويد 8+). يصلح فقط
 *    للأكواد الكاملة التي لا تطلب ردًا (لا قوائم تفاعلية).
 *  - sims: الشرائح الموجودة في الجوال، لاختيار شريحة كل محفظة.
 */
@CapacitorPlugin(
    name = "FlowPayUssd",
    permissions = {
        @Permission(alias = "call", strings = { Manifest.permission.CALL_PHONE }),
        @Permission(alias = "phone", strings = { Manifest.permission.READ_PHONE_STATE })
    }
)
public class UssdPlugin extends Plugin {

    // ===== sims =====
    @PluginMethod
    public void sims(PluginCall call) {
        if (getPermissionState("phone") != PermissionState.GRANTED) {
            requestPermissionForAlias("phone", call, "simsPermission");
            return;
        }
        listSims(call);
    }

    @PermissionCallback
    private void simsPermission(PluginCall call) {
        if (getPermissionState("phone") == PermissionState.GRANTED) {
            listSims(call);
        } else {
            JSObject r = new JSObject();
            r.put("sims", new JSArray());
            r.put("denied", true);
            call.resolve(r);
        }
    }

    @SuppressLint("MissingPermission")
    private void listSims(PluginCall call) {
        JSArray arr = new JSArray();
        try {
            SubscriptionManager sm = getContext().getSystemService(SubscriptionManager.class);
            List<SubscriptionInfo> subs = sm != null ? sm.getActiveSubscriptionInfoList() : null;
            if (subs != null) {
                for (SubscriptionInfo s : subs) {
                    JSObject o = new JSObject();
                    o.put("id", s.getSubscriptionId());
                    o.put("slot", s.getSimSlotIndex());
                    o.put("carrier", s.getCarrierName() != null ? s.getCarrierName().toString() : "");
                    o.put("name", s.getDisplayName() != null ? s.getDisplayName().toString() : "");
                    arr.put(o);
                }
            }
        } catch (Exception ignored) {
        }
        JSObject r = new JSObject();
        r.put("sims", arr);
        call.resolve(r);
    }

    // ===== dial =====
    @PluginMethod
    public void dial(PluginCall call) {
        if (call.getString("code") == null) {
            call.reject("code is required");
            return;
        }
        if (getPermissionState("call") != PermissionState.GRANTED) {
            requestPermissionForAlias("call", call, "dialPermission");
            return;
        }
        placeCall(call);
    }

    @PermissionCallback
    private void dialPermission(PluginCall call) {
        if (getPermissionState("call") == PermissionState.GRANTED) {
            placeCall(call);
        } else {
            openDialer(call);
        }
    }

    @SuppressLint("MissingPermission")
    private void placeCall(PluginCall call) {
        Uri uri = Uri.fromParts("tel", call.getString("code"), null);
        try {
            TelecomManager tm = getContext().getSystemService(TelecomManager.class);
            Bundle extras = new Bundle();
            PhoneAccountHandle handle = handleFor(call.getInt("simId", -1));
            if (handle != null) extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle);
            tm.placeCall(uri, extras);
            JSObject r = new JSObject();
            r.put("mode", "call");
            call.resolve(r);
        } catch (Exception e) {
            openDialer(call);
        }
    }

    private void openDialer(PluginCall call) {
        try {
            Intent i = new Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", call.getString("code"), null));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            JSObject r = new JSObject();
            r.put("mode", "dialer");
            call.resolve(r);
        } catch (Exception e) {
            call.reject("no dialer");
        }
    }

    // يحتاج إذن قراءة حالة الهاتف؛ بدونه نترك أندرويد يختار الشريحة
    @SuppressLint("MissingPermission")
    private PhoneAccountHandle handleFor(int subId) {
        if (subId < 0 || getPermissionState("phone") != PermissionState.GRANTED) return null;
        try {
            TelecomManager tm = getContext().getSystemService(TelecomManager.class);
            List<PhoneAccountHandle> handles = tm.getCallCapablePhoneAccounts();
            String iccId = null;
            SubscriptionManager sm = getContext().getSystemService(SubscriptionManager.class);
            SubscriptionInfo info = sm != null ? sm.getActiveSubscriptionInfo(subId) : null;
            if (info != null) iccId = info.getIccId();
            TelephonyManager tel = getContext().getSystemService(TelephonyManager.class);
            for (PhoneAccountHandle h : handles) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && tel != null) {
                    if (tel.getSubscriptionId(h) == subId) return h;
                } else {
                    // قبل أندرويد 11: معرّف الحساب هو رقم الاشتراك أو رقم الشريحة (ICCID) حسب الشركة المصنعة
                    String id = h.getId();
                    if (id == null) continue;
                    if (id.equals(String.valueOf(subId))) return h;
                    if (iccId != null && !iccId.isEmpty() && id.startsWith(iccId)) return h;
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    // ===== send (in-app USSD) =====
    @PluginMethod
    public void send(PluginCall call) {
        if (call.getString("code") == null) {
            call.reject("code is required");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("unsupported");
            return;
        }
        if (getPermissionState("call") != PermissionState.GRANTED) {
            requestPermissionForAlias("call", call, "sendPermission");
            return;
        }
        sendUssd(call);
    }

    @PermissionCallback
    private void sendPermission(PluginCall call) {
        if (getPermissionState("call") == PermissionState.GRANTED) sendUssd(call);
        else call.reject("denied");
    }

    @SuppressLint("MissingPermission")
    private void sendUssd(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("unsupported");
            return;
        }
        try {
            TelephonyManager tm = (TelephonyManager) getContext().getSystemService(Context.TELEPHONY_SERVICE);
            int subId = call.getInt("simId", -1);
            if (subId >= 0) tm = tm.createForSubscriptionId(subId);
            tm.sendUssdRequest(call.getString("code"), new TelephonyManager.UssdResponseCallback() {
                @Override
                public void onReceiveUssdResponse(TelephonyManager t, String request, CharSequence response) {
                    JSObject r = new JSObject();
                    r.put("ok", true);
                    r.put("message", response != null ? response.toString() : "");
                    call.resolve(r);
                }

                @Override
                public void onReceiveUssdResponseFailed(TelephonyManager t, String request, int failureCode) {
                    JSObject r = new JSObject();
                    r.put("ok", false);
                    r.put("failure", failureCode);
                    call.resolve(r);
                }
            }, new Handler(Looper.getMainLooper()));
        } catch (Exception e) {
            call.reject("failed", e);
        }
    }
}
