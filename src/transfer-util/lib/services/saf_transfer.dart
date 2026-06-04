import 'package:flutter/services.dart';

import '../models/mission.dart';
import '../platform/saf_channel.dart';
import 'transfer_strategy.dart';

/// Fallback strategy: Storage Access Framework (SAF).
///
/// Used when the direct MTP API is unavailable or fails. The big improvement
/// over the legacy app is that the granted directory permission is persisted
/// natively, so the user navigates the folder picker exactly once and every
/// later transfer is one tap.
class SafTransferStrategy implements TransferStrategy {
  SafTransferStrategy(this._channel);

  final SafChannel _channel;

  @override
  TransferMethod get method => TransferMethod.saf;

  @override
  String get displayName => 'File access';

  @override
  String get description =>
      'Uses Android\'s folder picker. You point it at the controller\'s '
      'waypoint folder once, then it is remembered.';

  /// Whether the user has already granted (and we still hold) access to the
  /// waypoint directory.
  Future<bool> hasAccess() => _channel.hasPersistedUri();

  /// Launches the system folder picker. Returns `true` once a directory is
  /// chosen and persisted.
  Future<bool> requestAccess() async {
    try {
      return await _channel.openDirectoryPicker();
    } on PlatformException catch (e) {
      throw _mapError(e);
    }
  }

  @override
  Future<void> prepare() async {
    if (await _channel.hasPersistedUri()) return;
    final granted = await requestAccess();
    if (!granted) {
      throw const TransferException(
        code: 'NO_DIR',
        message:
            'Folder access is needed. Tap "Choose folder" and browse to the '
            'controller\'s DJI waypoint folder '
            '(Android > data > dji.go.v5 > files > waypoint).',
      );
    }
  }

  @override
  Future<List<Mission>> listMissions() async {
    try {
      return await _channel.listMissions();
    } on PlatformException catch (e) {
      throw _mapError(e);
    }
  }

  @override
  Future<void> transfer({
    required String uuid,
    required Uint8List kmzData,
  }) async {
    try {
      final ok = await _channel.transferKmz(uuid: uuid, kmzData: kmzData);
      if (!ok) {
        throw const TransferException(
          code: 'WRITE_FAILED',
          message: 'Could not write the file to the controller. Try again.',
        );
      }
    } on PlatformException catch (e) {
      throw _mapError(e);
    }
  }

  @override
  Future<void> dispose() async {
    // Nothing to release; the persisted permission is intentionally kept.
  }

  /// Forgets the saved directory so the user can re-pick it (e.g. they granted
  /// the wrong folder).
  Future<void> resetAccess() => _channel.clearPersistedUri();

  TransferException _mapError(PlatformException e) {
    final detail = e.message;
    return switch (e.code) {
      'NO_DIR' => TransferException(
          code: e.code,
          message:
              'No folder has been chosen yet. Tap "Choose folder" and browse '
              'to the controller\'s waypoint folder.',
          technical: detail,
        ),
      'MISSION_NOT_FOUND' => TransferException(
          code: e.code,
          message:
              'That mission slot was not found in the chosen folder. Refresh '
              'and pick another, or re-choose the folder.',
          technical: detail,
        ),
      'INVALID_DIR' || 'PERMISSION_FAILED' => TransferException(
          code: e.code,
          message:
              'That folder can\'t be used. Re-open the picker and select the '
              'waypoint folder on the controller, not local phone storage.',
          technical: detail,
        ),
      'CREATE_FAILED' || 'WRITE_FAILED' => TransferException(
          code: e.code,
          message:
              'Could not write to the controller. Reconnect it and make sure '
              'the chosen folder is still accessible.',
          technical: detail,
        ),
      'PICKER_FAILED' => TransferException(
          code: e.code,
          message: 'Could not open the folder picker on this device.',
          technical: detail,
        ),
      _ => TransferException(
          code: e.code,
          message: 'File access failed. ${detail ?? ''}'.trim(),
          technical: detail,
        ),
    };
  }
}
