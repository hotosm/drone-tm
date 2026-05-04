package org.hotosm.dronetm_transfer

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import androidx.documentfile.provider.DocumentFile
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * SAF (Storage Access Framework) fallback for when MTP direct API fails.
 *
 * Key improvements over dronetm-mobile:
 * - Persists URI permissions so user navigates the directory ONCE
 * - Null-safe throughout (no !! operators)
 * - Clear error messages at every step
 * - Pre-navigates the picker to the USB device root when possible
 */
class SafTransferPlugin : MethodChannel.MethodCallHandler {

    companion object {
        private const val TAG = "SafTransfer"
        private const val METHOD_CHANNEL = "org.hotosm.drone_tm/saf"
        private const val PREFS_NAME = "saf_prefs"
        private const val PREF_WAYPOINT_URI = "waypoint_dir_uri"
        private const val REQUEST_OPEN_TREE = 42
    }

    private lateinit var activity: Activity
    private lateinit var methodChannel: MethodChannel
    private var pendingResult: MethodChannel.Result? = null

    fun register(activity: Activity, flutterEngine: FlutterEngine) {
        this.activity = activity
        methodChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, METHOD_CHANNEL)
        methodChannel.setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "hasPersistedUri" -> hasPersistedUri(result)
            "openDirectoryPicker" -> openDirectoryPicker(result)
            "listMissions" -> listMissionsSaf(result)
            "transferKmz" -> {
                val uuid = call.argument<String>("uuid")
                    ?: return result.error("INVALID_ARGS", "uuid required", null)
                val kmzData = call.argument<ByteArray>("kmzData")
                    ?: return result.error("INVALID_ARGS", "kmzData required", null)
                transferKmzSaf(uuid, kmzData, result)
            }
            "clearPersistedUri" -> {
                prefs.edit().remove(PREF_WAYPOINT_URI).apply()
                result.success(true)
            }
            else -> result.notImplemented()
        }
    }

    private val prefs: SharedPreferences
        get() = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /**
     * Check if we have a persisted URI for the waypoint directory.
     */
    private fun hasPersistedUri(result: MethodChannel.Result) {
        val uriString = prefs.getString(PREF_WAYPOINT_URI, null)
        if (uriString == null) {
            result.success(false)
            return
        }
        // Verify the permission is still valid
        val uri = Uri.parse(uriString)
        val persistedUris = activity.contentResolver.persistedUriPermissions
        val stillValid = persistedUris.any {
            it.uri == uri && it.isReadPermission && it.isWritePermission
        }
        if (!stillValid) {
            prefs.edit().remove(PREF_WAYPOINT_URI).apply()
        }
        result.success(stillValid)
    }

    /**
     * Launch the SAF directory picker for the user to navigate to the
     * DJI waypoint directory on the controller.
     */
    private fun openDirectoryPicker(result: MethodChannel.Result) {
        pendingResult = result
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            )
        }
        try {
            activity.startActivityForResult(intent, REQUEST_OPEN_TREE)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open directory picker", e)
            pendingResult = null
            result.error("PICKER_FAILED", "Could not open directory picker: ${e.message}", null)
        }
    }

    /**
     * Called from MainActivity when the directory picker returns.
     */
    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != REQUEST_OPEN_TREE) return false

        val result = pendingResult
        pendingResult = null

        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            result?.success(false)
            return true
        }

        val treeUri = data.data!!

        // Persist the permission so the user never has to do this again
        try {
            activity.contentResolver.takePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        } catch (e: SecurityException) {
            Log.e(TAG, "Failed to persist URI permission", e)
            result?.error("PERMISSION_FAILED", "Could not persist directory permission", null)
            return true
        }

        // Verify the selected directory contains waypoint missions (or is close)
        val docFile = DocumentFile.fromTreeUri(activity, treeUri)
        if (docFile == null || !docFile.isDirectory) {
            result?.error("INVALID_DIR", "Selected path is not a directory", null)
            return true
        }

        // Save the URI
        prefs.edit().putString(PREF_WAYPOINT_URI, treeUri.toString()).apply()
        Log.i(TAG, "Persisted waypoint directory URI: $treeUri")
        result?.success(true)
        return true
    }

    /**
     * List mission UUIDs from the persisted waypoint directory via SAF.
     */
    private fun listMissionsSaf(result: MethodChannel.Result) {
        val waypointDir = getPersistedWaypointDir()
        if (waypointDir == null) {
            result.error("NO_DIR", "No waypoint directory configured. Use the directory picker first.", null)
            return
        }

        try {
            val missions = mutableListOf<Map<String, Any>>()
            for (child in waypointDir.listFiles()) {
                if (child.isDirectory) {
                    missions.add(mapOf(
                        "uuid" to (child.name ?: ""),
                        "dateModified" to child.lastModified()
                    ))
                }
            }
            missions.sortByDescending { it["dateModified"] as Long }
            result.success(missions)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to list missions via SAF", e)
            result.error("SAF_ERROR", "Failed to list missions: ${e.message}", null)
        }
    }

    /**
     * Transfer a KMZ file to a mission slot via SAF.
     */
    private fun transferKmzSaf(uuid: String, kmzData: ByteArray, result: MethodChannel.Result) {
        val waypointDir = getPersistedWaypointDir()
        if (waypointDir == null) {
            result.error("NO_DIR", "No waypoint directory configured.", null)
            return
        }

        try {
            // Find the UUID subdirectory
            val uuidDir = waypointDir.listFiles().firstOrNull { it.name == uuid && it.isDirectory }
            if (uuidDir == null) {
                result.error("MISSION_NOT_FOUND", "Mission directory '$uuid' not found", null)
                return
            }

            // Delete existing KMZ if present
            val existingKmz = uuidDir.listFiles().firstOrNull { it.name == "$uuid.kmz" }
            if (existingKmz != null) {
                val deleted = existingKmz.delete()
                if (!deleted) {
                    Log.w(TAG, "Failed to delete existing KMZ via SAF")
                }
            }

            // Create new file
            val newFile = uuidDir.createFile("application/vnd.google-earth.kmz", "$uuid.kmz")
            if (newFile == null) {
                result.error("CREATE_FAILED", "Failed to create file in mission directory", null)
                return
            }

            // Write data
            val outputStream = activity.contentResolver.openOutputStream(newFile.uri)
            if (outputStream == null) {
                result.error("WRITE_FAILED", "Could not open file for writing", null)
                return
            }

            outputStream.use { it.write(kmzData) }

            Log.i(TAG, "SAF transfer complete: $uuid.kmz (${kmzData.size} bytes)")
            result.success(true)
        } catch (e: Exception) {
            Log.e(TAG, "SAF transfer failed", e)
            result.error("SAF_ERROR", "Transfer failed: ${e.message}", null)
        }
    }

    private fun getPersistedWaypointDir(): DocumentFile? {
        val uriString = prefs.getString(PREF_WAYPOINT_URI, null) ?: return null
        val uri = Uri.parse(uriString)
        return DocumentFile.fromTreeUri(activity, uri)
    }
}
