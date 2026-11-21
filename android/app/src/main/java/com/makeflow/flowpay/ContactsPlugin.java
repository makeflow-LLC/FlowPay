package com.makeflow.flowpay;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.provider.ContactsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * اختيار رقم من جهات الاتصال عبر شاشة النظام. لا يحتاج إذن قراءة جهات الاتصال:
 * أندرويد يعطي التطبيق الرقم الذي اختاره المستخدم فقط، ولا شيء غيره.
 */
@CapacitorPlugin(name = "FlowPayContacts")
public class ContactsPlugin extends Plugin {

    @PluginMethod
    public void pick(PluginCall call) {
        try {
            Intent i = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
            startActivityForResult(call, i, "picked");
        } catch (Exception e) {
            call.reject("no picker");
        }
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            r.put("cancelled", true);
            call.resolve(r);
            return;
        }
        String[] cols = {
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME
        };
        try (Cursor c = getContext().getContentResolver().query(data.getData(), cols, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                r.put("phone", c.getString(0));
                r.put("name", c.getString(1));
            }
        } catch (Exception ignored) {
        }
        call.resolve(r);
    }
}
