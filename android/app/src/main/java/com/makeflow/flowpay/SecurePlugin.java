package com.makeflow.flowpay;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * قفل التطبيق والرقم السري المحفوظ:
 *  - authenticate: بصمة/وجه، أو قفل الشاشة (رمز/نمط) إن لم توجد بصمة.
 *  - setSecret/getSecret/removeSecret: قيمة صغيرة مشفّرة بمفتاح في Android Keystore
 *    (المفتاح لا يغادر الجهاز ولا يدخل في النسخ الاحتياطي)، والنص المشفّر في تخزين التطبيق الخاص.
 */
@CapacitorPlugin(name = "FlowPaySecure")
public class SecurePlugin extends Plugin {

    private static final int AUTH =
        BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
    private static final String KEY_ALIAS = "flowpay_secrets";
    private static final String PREFS = "flowpay_secure";

    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject();
        boolean ok = false;
        try {
            ok = BiometricManager.from(getContext()).canAuthenticate(AUTH) == BiometricManager.BIOMETRIC_SUCCESS;
        } catch (Exception ignored) {
        }
        r.put("available", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void authenticate(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                BiometricPrompt prompt = new BiometricPrompt(
                    getActivity(),
                    ContextCompat.getMainExecutor(getContext()),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            done(call, true);
                        }

                        @Override
                        public void onAuthenticationError(int code, @NonNull CharSequence msg) {
                            done(call, false);
                        }
                    }
                );
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(call.getString("title", "FlowPay"))
                    .setSubtitle(call.getString("subtitle", ""))
                    .setAllowedAuthenticators(AUTH)
                    .build();
                prompt.authenticate(info);
            } catch (Exception e) {
                done(call, false);
            }
        });
    }

    private void done(PluginCall call, boolean ok) {
        JSObject r = new JSObject();
        r.put("ok", ok);
        call.resolve(r);
    }

    // ===== encrypted storage =====
    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) return (SecretKey) ks.getKey(KEY_ALIAS, null);
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return gen.generateKey();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void setSecret(PluginCall call) {
        String k = call.getString("key"), v = call.getString("value");
        if (k == null || v == null) {
            call.reject("key and value are required");
            return;
        }
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            String out = Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":"
                + Base64.encodeToString(c.doFinal(v.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            prefs().edit().putString(k, out).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("failed", e);
        }
    }

    // قيمة فارغة إن لم توجد أو تعذّر فكّها (مثلاً بعد استعادة نسخة احتياطية على جهاز آخر)
    @PluginMethod
    public void getSecret(PluginCall call) {
        JSObject r = new JSObject();
        String value = "";
        try {
            String stored = prefs().getString(call.getString("key", ""), null);
            if (stored != null) {
                String[] parts = stored.split(":");
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                value = new String(c.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
            }
        } catch (Exception ignored) {
        }
        r.put("value", value);
        call.resolve(r);
    }

    @PluginMethod
    public void removeSecret(PluginCall call) {
        prefs().edit().remove(call.getString("key", "")).apply();
        call.resolve();
    }
}
