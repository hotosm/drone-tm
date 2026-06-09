import 'package:flutter/services.dart';

import '../models/kmz_file.dart';
import '../models/mission.dart';
import '../models/usb_device.dart';

/// Kinds of asynchronous events pushed from the native MTP plugin over the
/// `org.hotosm.drone_tm/mtp_events` EventChannel. Mirrors the `type` strings
/// emitted by `MtpTransferPlugin.sendEvent(...)`.
enum MtpEventType {
  usbPermissionGranted,
  usbPermissionDenied,
  deviceAttached,
  deviceDisconnected,
  fileReceived,
  transferComplete,
  unknown,
}

/// A decoded event from the native side.
class MtpEvent {
  const MtpEvent(this.type, this.data);

  final MtpEventType type;
  final Map<dynamic, dynamic> data;

  /// URI string for [MtpEventType.fileReceived].
  String? get uri => data['uri'] as String?;

  /// Device name for [MtpEventType.usbPermissionGranted].
  String? get deviceName => data['deviceName'] as String?;

  factory MtpEvent.fromMap(Map<dynamic, dynamic> map) {
    final type = switch (map['type'] as String?) {
      'usb_permission_granted' => MtpEventType.usbPermissionGranted,
      'usb_permission_denied' => MtpEventType.usbPermissionDenied,
      'device_attached' => MtpEventType.deviceAttached,
      'device_disconnected' => MtpEventType.deviceDisconnected,
      'file_received' => MtpEventType.fileReceived,
      'transfer_complete' => MtpEventType.transferComplete,
      _ => MtpEventType.unknown,
    };
    return MtpEvent(type, map);
  }
}

/// Result of `getInitialIntent` / a `file_received` event: how the app was
/// launched and the file URI it was asked to transfer.
class IncomingFile {
  const IncomingFile({required this.uri, this.action = 'view'});

  final String uri;
  final String action; // 'share' | 'deeplink' | 'view'

  factory IncomingFile.fromMap(Map<dynamic, dynamic> map) => IncomingFile(
        uri: (map['uri'] as String?) ?? '',
        action: (map['action'] as String?) ?? 'view',
      );

  bool get isValid => uri.isNotEmpty;
}

/// Thin, typed wrapper around the native MTP method + event channels.
///
/// This class does no orchestration; it only translates between Dart types and
/// the platform message maps. The connection/permission state machine lives in
/// `MtpTransferStrategy`.
class MtpChannel {
  MtpChannel()
      : _method = const MethodChannel('org.hotosm.drone_tm/mtp'),
        _events = const EventChannel('org.hotosm.drone_tm/mtp_events');

  final MethodChannel _method;
  final EventChannel _events;

  Stream<MtpEvent>? _eventStream;

  /// Broadcast stream of native events. Lazily started and shared so multiple
  /// listeners (controller + transient awaiters) can subscribe.
  Stream<MtpEvent> get events => _eventStream ??= _events
      .receiveBroadcastStream()
      .map((dynamic e) => MtpEvent.fromMap(e as Map<dynamic, dynamic>))
      .asBroadcastStream();

  Future<List<UsbDeviceInfo>> getConnectedDevices() async {
    final raw = await _method.invokeListMethod<dynamic>('getConnectedDevices');
    if (raw == null) return const [];
    return raw
        .whereType<Map<dynamic, dynamic>>()
        .map(UsbDeviceInfo.fromPlatform)
        .toList(growable: false);
  }

  /// Requests USB permission. Returns `true` if permission was *already*
  /// granted; `false` means the system dialog was shown and the outcome will
  /// arrive as a [MtpEventType.usbPermissionGranted] / `usbPermissionDenied`
  /// event.
  Future<bool> requestPermission({String? deviceName}) async {
    final granted = await _method.invokeMethod<bool>(
      'requestPermission',
      {'deviceName': deviceName},
    );
    return granted ?? false;
  }

  /// Opens the MTP session. Must be called before [listMissions]/[transferKmz].
  /// Returns the device descriptor map on success; throws [PlatformException]
  /// otherwise.
  Future<Map<dynamic, dynamic>> openDevice({String? deviceName}) async {
    final info = await _method.invokeMapMethod<dynamic, dynamic>(
      'openDevice',
      {'deviceName': deviceName},
    );
    return info ?? const {};
  }

  Future<List<Mission>> listMissions() async {
    final raw = await _method.invokeListMethod<dynamic>('listMissions');
    if (raw == null) return const [];
    return raw
        .whereType<Map<dynamic, dynamic>>()
        .map(Mission.fromPlatform)
        .where((m) => m.isValid)
        .toList(growable: false);
  }

  Future<bool> transferKmz({
    required String uuid,
    required Uint8List kmzData,
  }) async {
    final ok = await _method.invokeMethod<bool>('transferKmz', {
      'uuid': uuid,
      'kmzData': kmzData,
    });
    return ok ?? false;
  }

  Future<void> closeDevice() => _method.invokeMethod<void>('closeDevice');

  Future<bool> isConnected() async {
    final status =
        await _method.invokeMapMethod<dynamic, dynamic>('getDeviceStatus');
    return (status?['isConnected'] as bool?) ?? false;
  }

  /// Reads a `content://` (or `file://`) URI on the native side and returns it
  /// as an in-memory [KmzFile].
  Future<KmzFile> readContentUri(String uri) async {
    final map = await _method.invokeMapMethod<dynamic, dynamic>(
      'readContentUri',
      {'uri': uri},
    );
    if (map == null) {
      throw PlatformException(code: 'READ_FAILED', message: 'Empty file read');
    }
    final bytes = map['bytes'];
    return KmzFile(
      name: (map['name'] as String?) ?? 'mission.kmz',
      bytes: bytes is Uint8List ? bytes : Uint8List(0),
    );
  }

  /// Returns the file the app was cold-launched with (share/deeplink/open), or
  /// `null` for a normal launch. Native guarantees this fires at most once.
  Future<IncomingFile?> getInitialIntent() async {
    final map =
        await _method.invokeMapMethod<dynamic, dynamic>('getInitialIntent');
    if (map == null) return null;
    final incoming = IncomingFile.fromMap(map);
    return incoming.isValid ? incoming : null;
  }

  // ---- Diagnostics capture ----------------------------------------------

  /// Phone + app facts (make/model, Android SDK, USB-host feature, app version).
  Future<Map<String, dynamic>> getEnvironment() async {
    final map = await _method.invokeMapMethod<dynamic, dynamic>('getEnvironment');
    return coerceMap(map);
  }

  /// Every USB device the phone enumerates, UNFILTERED, with interface detail.
  Future<List<Map<String, dynamic>>> dumpUsbDevices() async {
    final raw = await _method.invokeListMethod<dynamic>('dumpUsbDevices');
    if (raw == null) return const [];
    return raw
        .whereType<Map<dynamic, dynamic>>()
        .map(coerceMap)
        .toList(growable: false);
  }

  /// Inspect the open MTP responder: identity, storage, DJI-path traversal, and
  /// a bounded object-tree sample. Requires [openDevice] to have succeeded.
  Future<Map<String, dynamic>> dumpMtpTree({
    int maxDepth = 2,
    int maxChildren = 40,
  }) async {
    final map = await _method.invokeMapMethod<dynamic, dynamic>(
      'dumpMtpTree',
      {'maxDepth': maxDepth, 'maxChildren': maxChildren},
    );
    return coerceMap(map);
  }
}

/// Platform channels hand back `Map<Object?, Object?>` / `List<Object?>` whose
/// keys are Strings at runtime but not statically. Deep-convert so the result
/// is a clean `Map<String, dynamic>` that `jsonEncode` and typed access accept.
Map<String, dynamic> coerceMap(Map<dynamic, dynamic>? map) {
  if (map == null) return <String, dynamic>{};
  return map.map((key, value) => MapEntry('$key', _coerceValue(value)));
}

dynamic _coerceValue(dynamic value) {
  if (value is Map) {
    return value.map((k, v) => MapEntry('$k', _coerceValue(v)));
  }
  if (value is List) {
    return value.map(_coerceValue).toList();
  }
  return value;
}
