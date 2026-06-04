import 'package:flutter/services.dart';

import '../models/mission.dart';

/// Thin, typed wrapper around the native SAF (Storage Access Framework)
/// fallback plugin on `org.hotosm.drone_tm/saf`.
///
/// SAF is the fallback for phones where the direct MTP API is unavailable or
/// flaky. Unlike the old dronetm-mobile app, the native side persists the
/// directory permission, so the user only has to navigate the picker once.
class SafChannel {
  SafChannel() : _method = const MethodChannel('org.hotosm.drone_tm/saf');

  final MethodChannel _method;

  /// Whether a previously-granted waypoint directory permission is still valid.
  Future<bool> hasPersistedUri() async {
    final ok = await _method.invokeMethod<bool>('hasPersistedUri');
    return ok ?? false;
  }

  /// Launches the system directory picker. Returns `true` once the user has
  /// selected a directory and the permission has been persisted; `false` if
  /// they cancelled.
  Future<bool> openDirectoryPicker() async {
    final ok = await _method.invokeMethod<bool>('openDirectoryPicker');
    return ok ?? false;
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

  Future<void> clearPersistedUri() =>
      _method.invokeMethod<void>('clearPersistedUri');
}
