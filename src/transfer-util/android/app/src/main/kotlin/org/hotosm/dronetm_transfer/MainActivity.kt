package org.hotosm.dronetm_transfer

import android.content.Intent
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {

    private lateinit var mtpPlugin: MtpTransferPlugin
    private lateinit var safPlugin: SafTransferPlugin

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        mtpPlugin = MtpTransferPlugin()
        mtpPlugin.register(this, flutterEngine)
        safPlugin = SafTransferPlugin()
        safPlugin.register(this, flutterEngine)
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

    @Deprecated("Use registerForActivityResult", ReplaceWith("registerForActivityResult"))
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (safPlugin.onActivityResult(requestCode, resultCode, data)) return
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun handleIntent(intent: Intent) {
        when (intent.action) {
            UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
                mtpPlugin.onUsbDeviceAttached()
            }
            Intent.ACTION_SEND -> {
                val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, android.net.Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra<android.net.Uri>(Intent.EXTRA_STREAM)
                }
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
