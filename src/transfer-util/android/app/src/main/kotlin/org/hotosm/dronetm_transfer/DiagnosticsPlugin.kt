package org.hotosm.dronetm_transfer

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import androidx.core.content.FileProvider
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File

/**
 * Native side of diagnostic-report export.
 *
 * Writing to Downloads (MediaStore) and sharing via the system share sheet
 * (FileProvider) are done natively because they need platform APIs. The Dart
 * layer owns the other two return paths: clipboard (Flutter built-in) and the
 * offline POST queue (dart:io). [getAppFilesDir] gives Dart a stable directory
 * to persist that queue in.
 */
class DiagnosticsPlugin : MethodChannel.MethodCallHandler {

    companion object {
        private const val TAG = "Diagnostics"
        private const val METHOD_CHANNEL = "org.hotosm.drone_tm/diag"
    }

    private lateinit var activity: Activity
    private lateinit var methodChannel: MethodChannel

    fun register(activity: Activity, flutterEngine: FlutterEngine) {
        this.activity = activity
        methodChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, METHOD_CHANNEL)
        methodChannel.setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "getAppFilesDir" -> result.success(activity.filesDir.absolutePath)
            "saveReportToDownloads" -> {
                val fileName = call.argument<String>("fileName") ?: "dronetm-report.txt"
                val content = call.argument<String>("content") ?: ""
                saveToDownloads(fileName, content, result)
            }
            "shareReport" -> {
                val fileName = call.argument<String>("fileName") ?: "dronetm-report.txt"
                val content = call.argument<String>("content") ?: ""
                shareReport(fileName, content, result)
            }
            else -> result.notImplemented()
        }
    }

    /** Save to the public Downloads/DroneTM folder so it can be pulled off the phone later. */
    private fun saveToDownloads(fileName: String, content: String, result: MethodChannel.Result) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = activity.contentResolver
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                    put(MediaStore.Downloads.MIME_TYPE, "text/plain")
                    put(
                        MediaStore.Downloads.RELATIVE_PATH,
                        Environment.DIRECTORY_DOWNLOADS + "/DroneTM",
                    )
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: return result.error("SAVE_FAILED", "Could not create a Downloads entry", null)
                resolver.openOutputStream(uri)?.use { it.write(content.toByteArray()) }
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                result.success(uri.toString())
            } else {
                // Pre-Q: writing to PUBLIC Downloads needs the WRITE_EXTERNAL_STORAGE
                // runtime permission, which this app never requests — so it would
                // silently fail. Use the app-specific external Downloads dir
                // instead: no permission on any API level, and still retrievable
                // over USB at Android/data/<pkg>/files/Download/DroneTM.
                val base = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                    ?: activity.filesDir
                val dir = File(base, "DroneTM")
                if (!dir.exists()) dir.mkdirs()
                val file = File(dir, fileName)
                file.writeText(content)
                result.success(file.absolutePath)
            }
        } catch (e: Exception) {
            Log.e(TAG, "saveToDownloads failed", e)
            result.error("SAVE_FAILED", "Could not save report: ${e.message}", null)
        }
    }

    /** Write the report to a FileProvider-shared cache file and fire the share sheet. */
    private fun shareReport(fileName: String, content: String, result: MethodChannel.Result) {
        try {
            val dir = File(activity.cacheDir, "reports")
            if (!dir.exists()) dir.mkdirs()
            val file = File(dir, fileName)
            file.writeText(content)

            val uri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                file,
            )
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, fileName)
                // Also attach the text so chat/SMS apps that ignore the stream
                // still receive the report body.
                putExtra(Intent.EXTRA_TEXT, content)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(send, "Share diagnostic report").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(chooser)
            result.success(true)
        } catch (e: Exception) {
            Log.e(TAG, "shareReport failed", e)
            result.error("SHARE_FAILED", "Could not share report: ${e.message}", null)
        }
    }
}
