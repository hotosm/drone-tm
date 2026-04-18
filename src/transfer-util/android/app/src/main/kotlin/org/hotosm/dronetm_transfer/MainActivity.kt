package org.hotosm.dronetm_transfer

import android.content.Intent
import android.hardware.usb.UsbManager
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {

    private lateinit var mtpPlugin: MtpTransferPlugin

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        mtpPlugin = MtpTransferPlugin()
        mtpPlugin.register(this, flutterEngine)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent) {
        when (intent.action) {
            UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
                mtpPlugin.onUsbDeviceAttached()
            }
            Intent.ACTION_SEND -> {
                val uri = intent.getParcelableExtra<android.net.Uri>(Intent.EXTRA_STREAM)
                if (uri != null) {
                    mtpPlugin.onFileReceived(uri.toString())
                }
            }
            Intent.ACTION_VIEW -> {
                val uri = intent.data
                if (uri != null) {
                    if (uri.scheme == "dronetm") {
                        val fileUri = uri.getQueryParameter("file")
                        if (fileUri != null) {
                            mtpPlugin.onFileReceived(fileUri)
                        }
                    } else {
                        mtpPlugin.onFileReceived(uri.toString())
                    }
                }
            }
        }
    }
}
