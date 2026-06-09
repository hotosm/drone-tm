package org.hotosm.dronetm_transfer

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.mtp.MtpConstants
import android.mtp.MtpDevice
import android.mtp.MtpObjectInfo
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

class MtpTransferPlugin : MethodChannel.MethodCallHandler {

    companion object {
        private const val TAG = "MtpTransfer"
        private const val METHOD_CHANNEL = "org.hotosm.drone_tm/mtp"
        private const val EVENT_CHANNEL = "org.hotosm.drone_tm/mtp_events"
        private const val ACTION_USB_PERMISSION = "org.hotosm.drone_tm.USB_PERMISSION"

        // DJI vendor ID
        private const val DJI_VENDOR_ID = 11427

        // MTP "no parent" / storage-root handle (0xFFFFFFFF as a signed Int).
        private const val MTP_ROOT_HANDLE = -1

        // DJI waypoint path segments
        private val DJI_PATH_SEGMENTS = listOf("Android", "data", "dji.go.v5", "files", "waypoint")
    }

    private lateinit var activity: Activity
    private lateinit var methodChannel: MethodChannel
    private lateinit var eventChannel: EventChannel
    private var eventSink: EventChannel.EventSink? = null
    private var currentMtpDevice: MtpDevice? = null

    // Serializes the heavy diagnostic tree walk off the platform thread so it
    // can never block the UI / trigger an ANR.
    private val mtpExecutor: ExecutorService = Executors.newSingleThreadExecutor()

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                ACTION_USB_PERMISSION -> {
                    val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                    }
                    val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                    if (granted && device != null) {
                        sendEvent("usb_permission_granted", mapOf("deviceName" to (device.productName ?: "Unknown")))
                    } else {
                        sendEvent("usb_permission_denied", null)
                    }
                }
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    closeMtpDevice()
                    sendEvent("device_disconnected", null)
                }
            }
        }
    }

    fun register(activity: Activity, flutterEngine: FlutterEngine) {
        this.activity = activity
        methodChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, METHOD_CHANNEL)
        methodChannel.setMethodCallHandler(this)

        eventChannel = EventChannel(flutterEngine.dartExecutor.binaryMessenger, EVENT_CHANNEL)
        eventChannel.setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                eventSink = events
            }
            override fun onCancel(arguments: Any?) {
                eventSink = null
            }
        })

        val filter = IntentFilter().apply {
            addAction(ACTION_USB_PERMISSION)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // EXPORTED: on Android 14+ the USB permission result can be
            // delivered as an external broadcast, so a NOT_EXPORTED receiver
            // may never fire and the permission step would hang.
            activity.registerReceiver(usbReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            activity.registerReceiver(usbReceiver, filter)
        }
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "getConnectedDevices" -> getConnectedDevices(result)
            "requestPermission" -> {
                val deviceName = call.argument<String>("deviceName")
                requestPermission(deviceName, result)
            }
            "openDevice" -> {
                val deviceName = call.argument<String>("deviceName")
                openDevice(deviceName, result)
            }
            "listMissions" -> listMissions(result)
            "transferKmz" -> {
                val uuid = call.argument<String>("uuid") ?: return result.error("INVALID_ARGS", "uuid required", null)
                val kmzData = call.argument<ByteArray>("kmzData") ?: return result.error("INVALID_ARGS", "kmzData required", null)
                transferKmz(uuid, kmzData, result)
            }
            "closeDevice" -> {
                closeMtpDevice()
                result.success(true)
            }
            "getDeviceStatus" -> getDeviceStatus(result)
            "getEnvironment" -> getEnvironment(result)
            "dumpUsbDevices" -> dumpUsbDevices(result)
            "dumpMtpTree" -> dumpMtpTree(call, result)
            "readContentUri" -> {
                val uri = call.argument<String>("uri") ?: return result.error("INVALID_ARGS", "uri required", null)
                readContentUri(uri, result)
            }
            "getInitialIntent" -> getInitialIntent(result)
            else -> result.notImplemented()
        }
    }

    fun onUsbDeviceAttached() {
        sendEvent("device_attached", null)
    }

    fun onFileReceived(fileUri: String) {
        sendEvent("file_received", mapOf("uri" to fileUri))
    }

    private fun getConnectedDevices(result: MethodChannel.Result) {
        val usbManager = activity.getSystemService(Context.USB_SERVICE) as UsbManager
        val devices = usbManager.deviceList.values
            .filter { it.vendorId == DJI_VENDOR_ID || isMtpDevice(it) }
            .map { device ->
                mapOf(
                    "name" to (device.productName ?: "USB Device"),
                    "vendorId" to device.vendorId,
                    "productId" to device.productId,
                    "hasPermission" to usbManager.hasPermission(device),
                    "isDji" to (device.vendorId == DJI_VENDOR_ID)
                )
            }
        result.success(devices)
    }

    private fun requestPermission(deviceName: String?, result: MethodChannel.Result) {
        val usbManager = activity.getSystemService(Context.USB_SERVICE) as UsbManager
        val device = findDevice(usbManager, deviceName)
        if (device == null) {
            result.error("DEVICE_NOT_FOUND", "No matching USB device found", null)
            return
        }
        if (usbManager.hasPermission(device)) {
            result.success(true)
            return
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val permissionIntent = PendingIntent.getBroadcast(activity, 0, Intent(ACTION_USB_PERMISSION), flags)
        usbManager.requestPermission(device, permissionIntent)
        result.success(false) // Permission dialog shown, result comes via event
    }

    private fun openDevice(deviceName: String?, result: MethodChannel.Result) {
        val usbManager = activity.getSystemService(Context.USB_SERVICE) as UsbManager
        val device = findDevice(usbManager, deviceName)
        if (device == null) {
            result.error("DEVICE_NOT_FOUND", "No matching USB device found", null)
            return
        }
        if (!usbManager.hasPermission(device)) {
            result.error("NO_PERMISSION", "USB permission not granted", null)
            return
        }
        try {
            closeMtpDevice()
            val mtpDevice = MtpDevice(device)
            val connection = usbManager.openDevice(device)
            if (connection == null) {
                result.error("OPEN_FAILED", "Failed to open USB connection", null)
                return
            }
            if (!mtpDevice.open(connection)) {
                result.error("MTP_OPEN_FAILED", "Failed to open MTP device", null)
                return
            }
            currentMtpDevice = mtpDevice
            val deviceInfo = mtpDevice.deviceInfo
            result.success(mapOf(
                "name" to (device.productName ?: "Unknown"),
                "manufacturer" to (deviceInfo?.manufacturer ?: "Unknown"),
                "model" to (deviceInfo?.model ?: "Unknown"),
                "serialNumber" to (deviceInfo?.serialNumber ?: "Unknown")
            ))
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open MTP device", e)
            result.error("MTP_ERROR", "Failed to open MTP device: ${e.message}", null)
        }
    }

    private fun listMissions(result: MethodChannel.Result) {
        val device = currentMtpDevice
        if (device == null) {
            result.error("NOT_CONNECTED", "No MTP device connected", null)
            return
        }
        try {
            val waypointHandle = navigateToWaypointDir(device)
            if (waypointHandle == null) {
                result.success(emptyList<Map<String, Any>>())
                return
            }

            val storageId = device.storageIds?.firstOrNull()
            if (storageId == null) {
                result.error("NO_STORAGE", "No storage found on device", null)
                return
            }

            val objectHandles = device.getObjectHandles(storageId, 0, waypointHandle)
            if (objectHandles == null) {
                result.success(emptyList<Map<String, Any>>())
                return
            }

            val missions = mutableListOf<Map<String, Any>>()
            for (handle in objectHandles) {
                val info = device.getObjectInfo(handle) ?: continue
                if (info.format == MtpConstants.FORMAT_ASSOCIATION) {
                    missions.add(mapOf(
                        "uuid" to (info.name ?: ""),
                        "handle" to handle,
                        "dateModified" to (info.dateModified * 1000L)
                    ))
                }
            }
            missions.sortByDescending { it["dateModified"] as Long }

            result.success(missions)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to list missions", e)
            result.error("MTP_ERROR", "Failed to list missions: ${e.message}", null)
        }
    }

    private fun transferKmz(uuid: String, kmzData: ByteArray, result: MethodChannel.Result) {
        val device = currentMtpDevice
        if (device == null) {
            result.error("NOT_CONNECTED", "No MTP device connected", null)
            return
        }
        try {
            val waypointHandle = navigateToWaypointDir(device)
            if (waypointHandle == null) {
                val ctx = describeDjiPath(device)
                result.error(
                    "DIR_NOT_FOUND",
                    "DJI waypoint directory not found (missing: ${ctx["missingSegment"]})",
                    ctx,
                )
                return
            }

            val storageId = device.storageIds?.firstOrNull()
            if (storageId == null) {
                result.error("NO_STORAGE", "No storage found on device", null)
                return
            }

            // Find the UUID subdirectory
            val uuidHandle = findChildByName(device, storageId, waypointHandle, uuid)
            if (uuidHandle == null) {
                result.error("MISSION_NOT_FOUND", "Mission directory '$uuid' not found", null)
                return
            }

            // Delete existing KMZ file if present
            val existingKmzHandle = findChildByName(device, storageId, uuidHandle, "$uuid.kmz")
            if (existingKmzHandle != null) {
                val deleted = device.deleteObject(existingKmzHandle)
                if (!deleted) {
                    Log.w(TAG, "Failed to delete existing KMZ, attempting overwrite")
                }
            }

            // Create and send new KMZ
            val objectInfo = MtpObjectInfo.Builder()
                .setStorageId(storageId)
                .setParent(uuidHandle)
                .setFormat(MtpConstants.FORMAT_UNDEFINED)
                .setName("$uuid.kmz")
                .setCompressedSize(kmzData.size.toLong())
                .build()

            val newHandle = device.sendObjectInfo(objectInfo)
            if (newHandle == null) {
                result.error("SEND_INFO_FAILED", "Failed to send object info to device", null)
                return
            }

            // MtpDevice.sendObject requires a ParcelFileDescriptor, so write to a temp file
            val tempFile = File(activity.cacheDir, "$uuid.kmz")
            try {
                tempFile.writeBytes(kmzData)
                val pfd = ParcelFileDescriptor.open(tempFile, ParcelFileDescriptor.MODE_READ_ONLY)
                val sent = pfd.use {
                    device.sendObject(
                        newHandle.objectHandle,
                        kmzData.size.toLong(),
                        it
                    )
                }

                if (sent) {
                    sendEvent("transfer_complete", mapOf("uuid" to uuid))
                    result.success(true)
                } else {
                    result.error("SEND_FAILED", "Failed to send KMZ data to device", null)
                }
            } finally {
                tempFile.delete()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to transfer KMZ", e)
            result.error("MTP_ERROR", "Transfer failed: ${e.message}", null)
        }
    }

    private fun getDeviceStatus(result: MethodChannel.Result) {
        result.success(mapOf(
            "isConnected" to (currentMtpDevice != null)
        ))
    }

    // ---- Diagnostics capture ---------------------------------------------
    // Read-only inspection of the phone, the USB bus, and the connected MTP
    // responder. These exist so a field failure produces an actionable report
    // (which step broke and why) instead of a generic error code.

    /** Phone + app facts that frame every report. */
    private fun getEnvironment(result: MethodChannel.Result) {
        val pm = activity.packageManager
        val hasUsbHost = pm.hasSystemFeature(PackageManager.FEATURE_USB_HOST)
        val pkg = try {
            pm.getPackageInfo(activity.packageName, 0)
        } catch (e: Exception) {
            null
        }
        val build = if (pkg == null) {
            -1L
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            pkg.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            pkg.versionCode.toLong()
        }
        result.success(mapOf(
            "manufacturer" to Build.MANUFACTURER,
            "brand" to Build.BRAND,
            "model" to Build.MODEL,
            "device" to Build.DEVICE,
            "androidSdk" to Build.VERSION.SDK_INT,
            "androidRelease" to Build.VERSION.RELEASE,
            "hasUsbHostFeature" to hasUsbHost,
            "appVersion" to (pkg?.versionName ?: "unknown"),
            "appBuild" to build,
            "abi" to (Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"),
        ))
    }

    /**
     * Every USB device the phone currently enumerates, UNFILTERED, with full
     * interface detail. This is the highest-value diagnostic: if the RC2 shows
     * up with an unexpected product id or behind a non-class-6 interface, the
     * normal device filter silently drops it and "no controller detected"
     * becomes indistinguishable from "nothing plugged in".
     */
    private fun dumpUsbDevices(result: MethodChannel.Result) {
        val usbManager = activity.getSystemService(Context.USB_SERVICE) as UsbManager
        val devices = usbManager.deviceList.values.map { device ->
            val interfaces = (0 until device.interfaceCount).map { i ->
                val iface = device.getInterface(i)
                mapOf(
                    "id" to iface.id,
                    "interfaceClass" to iface.interfaceClass,
                    "subclass" to iface.interfaceSubclass,
                    "protocol" to iface.interfaceProtocol,
                    "endpointCount" to iface.endpointCount,
                )
            }
            val serial = try {
                device.serialNumber
            } catch (e: SecurityException) {
                null
            }
            mapOf(
                "deviceName" to device.deviceName,
                "vendorId" to device.vendorId,
                "productId" to device.productId,
                "deviceClass" to device.deviceClass,
                "deviceSubclass" to device.deviceSubclass,
                "deviceProtocol" to device.deviceProtocol,
                "manufacturerName" to (device.manufacturerName ?: ""),
                "productName" to (device.productName ?: ""),
                "serialNumber" to (serial ?: ""),
                "interfaceCount" to device.interfaceCount,
                "hasPermission" to usbManager.hasPermission(device),
                "isDji" to (device.vendorId == DJI_VENDOR_ID),
                "looksMtp" to isMtpDevice(device),
                "interfaces" to interfaces,
            )
        }
        result.success(devices)
    }

    /**
     * Inspect the connected MTP responder: its identity, storage volumes, the
     * exact DJI-path traversal result, and a shallow object-tree sample. Needs
     * an already-opened device (call openDevice first).
     */
    private fun dumpMtpTree(call: MethodCall, result: MethodChannel.Result) {
        val device = currentMtpDevice
        if (device == null) {
            result.error("NOT_CONNECTED", "No MTP device connected", null)
            return
        }
        val maxDepth = call.argument<Int>("maxDepth") ?: 2
        val maxChildren = call.argument<Int>("maxChildren") ?: 40
        // The tree walk is up to a few hundred synchronous USB round-trips; run
        // it on the dedicated worker so it never blocks the platform thread, then
        // post the channel reply back on the main thread (results must be
        // delivered there).
        mtpExecutor.execute {
            try {
                val payload = buildMtpTree(device, maxDepth, maxChildren)
                activity.runOnUiThread { result.success(payload) }
            } catch (e: Exception) {
                Log.e(TAG, "dumpMtpTree failed", e)
                activity.runOnUiThread {
                    result.error("MTP_ERROR", "Tree dump failed: ${e.message}", null)
                }
            }
        }
    }

    private fun buildMtpTree(device: MtpDevice, maxDepth: Int, maxChildren: Int): Map<String, Any?> {
        val storageIds = device.storageIds?.toList() ?: emptyList()
        val storages = storageIds.map { sid ->
            val info = device.getStorageInfo(sid)
            mapOf(
                "id" to sid,
                "description" to (info?.description ?: ""),
                "volumeIdentifier" to (info?.volumeIdentifier ?: ""),
                "freeSpaceBytes" to (info?.freeSpace ?: -1L),
                "maxCapacityBytes" to (info?.maxCapacity ?: -1L),
            )
        }
        val di = device.deviceInfo
        val deviceInfo = mapOf(
            "manufacturer" to (di?.manufacturer ?: ""),
            "model" to (di?.model ?: ""),
            "serialNumber" to (di?.serialNumber ?: ""),
            "version" to (di?.version ?: ""),
        )
        val djiPath = describeDjiPath(device)
        val firstStorage = storageIds.firstOrNull()
        val tree = if (firstStorage != null) {
            val budget = intArrayOf(400)
            walkTree(device, firstStorage, MTP_ROOT_HANDLE, maxDepth, maxChildren, "(root)", budget)
        } else {
            null
        }
        return mapOf(
            "storageCount" to storageIds.size,
            "storages" to storages,
            "deviceInfo" to deviceInfo,
            "djiPath" to djiPath,
            "tree" to tree,
        )
    }

    /**
     * Walk the DJI waypoint path segment by segment and report exactly how far
     * it got: the deepest segment that resolved, the first missing one, and the
     * sibling names present where it stopped. When the full path resolves, the
     * existing UUID slots are returned instead.
     */
    private fun describeDjiPath(device: MtpDevice): Map<String, Any?> {
        val storageId = device.storageIds?.firstOrNull()
            ?: return mapOf(
                "reachedDepth" to 0,
                "deepestSegment" to null,
                "missingSegment" to DJI_PATH_SEGMENTS.first(),
                "childrenAtFailure" to emptyList<String>(),
                "note" to "no storage exposed",
            )
        var currentParent = MTP_ROOT_HANDLE
        var depth = 0
        var deepest: String? = null
        for (segment in DJI_PATH_SEGMENTS) {
            val handle = findChildByName(device, storageId, currentParent, segment)
            if (handle == null) {
                return mapOf(
                    "reachedDepth" to depth,
                    "deepestSegment" to deepest,
                    "missingSegment" to segment,
                    "childrenAtFailure" to childNames(device, storageId, currentParent),
                )
            }
            currentParent = handle
            deepest = segment
            depth++
        }
        return mapOf(
            "reachedDepth" to depth,
            "deepestSegment" to deepest,
            "missingSegment" to null,
            "childrenAtFailure" to emptyList<String>(),
            "waypointSlots" to childNames(device, storageId, currentParent),
        )
    }

    /** Names of the immediate children of [parent]. */
    private fun childNames(device: MtpDevice, storageId: Int, parent: Int): List<String> {
        val handles = device.getObjectHandles(storageId, 0, parent) ?: return emptyList()
        val names = mutableListOf<String>()
        for (handle in handles) {
            val name = device.getObjectInfo(handle)?.name
            if (name != null) names.add(name)
        }
        return names
    }

    /**
     * Bounded recursive sample of the object tree. Depth- and width-limited and
     * capped by a shared node [budget] so a controller full of media never turns
     * a diagnostic scan into thousands of slow USB round-trips.
     */
    private fun walkTree(
        device: MtpDevice,
        storageId: Int,
        parent: Int,
        depthRemaining: Int,
        maxChildren: Int,
        name: String,
        budget: IntArray,
    ): Map<String, Any?> {
        val node = linkedMapOf<String, Any?>("name" to name, "isDir" to true)
        if (depthRemaining <= 0) {
            node["truncated"] = true
            return node
        }
        val handles = device.getObjectHandles(storageId, 0, parent)
        if (handles == null || handles.isEmpty()) {
            node["children"] = emptyList<Map<String, Any?>>()
            return node
        }
        val children = mutableListOf<Map<String, Any?>>()
        var count = 0
        for (handle in handles) {
            if (count >= maxChildren) {
                node["childrenTruncated"] = handles.size - count
                break
            }
            if (budget[0] <= 0) {
                node["budgetExhausted"] = true
                break
            }
            budget[0]--
            val info = device.getObjectInfo(handle) ?: continue
            val childName = info.name ?: "?"
            if (info.format == MtpConstants.FORMAT_ASSOCIATION) {
                children.add(
                    walkTree(device, storageId, handle, depthRemaining - 1, maxChildren, childName, budget),
                )
            } else {
                children.add(mapOf(
                    "name" to childName,
                    // 64-bit accessor (API 24+, matches minSdk): getCompressedSize()
                    // is a 32-bit int that wraps for files >= 2 GiB — exactly the
                    // large DJI media we want an honest size for.
                    "sizeBytes" to info.compressedSizeLong,
                    "format" to info.format,
                ))
            }
            count++
        }
        node["children"] = children
        return node
    }

    /**
     * Read bytes from a content:// URI using ContentResolver.
     * Returns a map with "bytes" (ByteArray), "name" (String), and "size" (Long).
     */
    private fun readContentUri(uriString: String, result: MethodChannel.Result) {
        try {
            val uri = android.net.Uri.parse(uriString)
            val contentResolver = activity.contentResolver

            // Get display name
            var displayName = "unknown.kmz"
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                    if (nameIndex >= 0) {
                        displayName = cursor.getString(nameIndex) ?: displayName
                    }
                }
            }

            // Read bytes
            val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
            if (bytes == null) {
                result.error("READ_FAILED", "Could not read file from URI", null)
                return
            }

            result.success(mapOf(
                "bytes" to bytes,
                "name" to displayName,
                "size" to bytes.size.toLong()
            ))
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read content URI", e)
            result.error("READ_ERROR", "Failed to read file: ${e.message}", null)
        }
    }

    /**
     * Return the intent that launched the activity (for cold-start share/deeplink handling).
     */
    private var initialIntentHandled = false
    private fun getInitialIntent(result: MethodChannel.Result) {
        if (initialIntentHandled) {
            result.success(null)
            return
        }
        initialIntentHandled = true
        val intent = activity.intent ?: return result.success(null)
        when (intent.action) {
            Intent.ACTION_SEND -> {
                val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, android.net.Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_STREAM)
                }
                if (uri != null) {
                    result.success(mapOf("action" to "share", "uri" to uri.toString()))
                } else {
                    result.success(null)
                }
            }
            Intent.ACTION_VIEW -> {
                val uri = intent.data
                if (uri != null) {
                    if (uri.scheme == "dronetm") {
                        result.success(mapOf(
                            "action" to "deeplink",
                            "uri" to (uri.getQueryParameter("file") ?: ""),
                            "host" to (uri.host ?: "")
                        ))
                    } else {
                        result.success(mapOf("action" to "view", "uri" to uri.toString()))
                    }
                } else {
                    result.success(null)
                }
            }
            else -> result.success(null)
        }
    }

    /**
     * Navigate the MTP object tree to find the DJI waypoint directory:
     * Android/data/dji.go.v5/files/waypoint
     */
    private fun navigateToWaypointDir(device: MtpDevice): Int? {
        val storageId = device.storageIds?.firstOrNull() ?: return null
        var currentParent = MTP_ROOT_HANDLE // MTP root handle

        for (segment in DJI_PATH_SEGMENTS) {
            val handle = findChildByName(device, storageId, currentParent, segment)
            if (handle == null) {
                Log.d(TAG, "Path segment '$segment' not found in MTP tree")
                return null
            }
            currentParent = handle
        }
        return currentParent
    }

    /**
     * Find a child object by name within a parent directory on the MTP device.
     */
    private fun findChildByName(device: MtpDevice, storageId: Int, parentHandle: Int, name: String): Int? {
        val handles = device.getObjectHandles(storageId, 0, parentHandle) ?: return null
        for (handle in handles) {
            val info = device.getObjectInfo(handle)
            if (info?.name == name) {
                return handle
            }
        }
        return null
    }

    private fun isMtpDevice(device: UsbDevice): Boolean {
        for (i in 0 until device.interfaceCount) {
            val iface = device.getInterface(i)
            // USB class 6 = Still Image / MTP
            if (iface.interfaceClass == 6) return true
        }
        return false
    }

    private fun findDevice(usbManager: UsbManager, deviceName: String?): UsbDevice? {
        val devices = usbManager.deviceList.values
        if (deviceName != null) {
            return devices.firstOrNull { it.productName == deviceName || it.deviceName == deviceName }
        }
        // Default: find first DJI device, or first MTP device
        return devices.firstOrNull { it.vendorId == DJI_VENDOR_ID }
            ?: devices.firstOrNull { isMtpDevice(it) }
    }

    private fun closeMtpDevice() {
        try {
            currentMtpDevice?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing MTP device", e)
        }
        currentMtpDevice = null
    }

    private fun sendEvent(type: String, data: Map<String, Any?>?) {
        activity.runOnUiThread {
            val event = mutableMapOf<String, Any?>("type" to type)
            if (data != null) event.putAll(data)
            eventSink?.success(event)
        }
    }
}
