package com.makeflow.flowpay;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UssdPlugin.class);
        registerPlugin(ContactsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
