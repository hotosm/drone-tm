import 'dart:async';

import 'package:flutter/services.dart';

import '../models/mission.dart';
import '../platform/mtp_channel.dart';
import 'transfer_strategy.dart';

/// Primary strategy: talk to the controller directly with Android's
/// `android.mtp.MtpDevice` API (wrapped by `MtpTransferPlugin.kt`).
///
/// This avoids the SAF directory picker entirely – navigation happens
/// programmatically on the native side – which is the whole point of the
/// rewrite. The tricky part handled here is the USB *permission* handshake:
/// `requestPermission` returns immediately, and the user's choice arrives later
/// as an event, so [prepare] bridges that into a single awaitable step.
class MtpTransferStrategy implements TransferStrategy {
  MtpTransferStrategy(this._channel);

  final MtpChannel _channel;

  bool _opened = false;

  /// How long to wait for the user to respond to the USB permission dialog
  /// before giving up so they can retry rather than stare at a spinner.
  static const _permissionTimeout = Duration(seconds: 45);

  @override
  TransferMethod get method => TransferMethod.mtp;

  @override
  String get displayName => 'Direct USB';

  @override
  String get description =>
      'Talks to the controller directly over the cable. Fastest and needs no '
      'folder picking. Recommended.';

  /// True when a DJI (or generic MTP) device is currently plugged in. Used by
  /// the controller to decide whether to default to this strategy.
  Future<bool> hasDevice() async {
    final devices = await _channel.getConnectedDevices();
    return devices.isNotEmpty;
  }

  @override
  Future<void> prepare() async {
    final devices = await _channel.getConnectedDevices();
    if (devices.isEmpty) {
      throw const TransferException(
        code: 'NO_DEVICE',
        message:
            'No controller detected over USB. This transfers to a controller '
            'that has its own screen (e.g. DJI RC 2) — connect it with a data '
            'USB cable (charge-only cables won\'t work).\n\n'
            'Using an RC-N2 that holds this phone? Then DJI Fly already runs on '
            'this phone, so the mission is here — no transfer needed.',
        canFallbackToSaf: true,
      );
    }

    // Prefer a recognised DJI device, otherwise the first MTP device.
    final device = devices.firstWhere(
      (d) => d.isDji,
      orElse: () => devices.first,
    );

    if (!device.hasPermission) {
      final alreadyGranted =
          await _channel.requestPermission(deviceName: device.name);
      if (!alreadyGranted) {
        final granted = await _awaitPermissionDecision();
        if (!granted) {
          throw const TransferException(
            code: 'NO_PERMISSION',
            message:
                'USB access was not granted. Reconnect the controller and tap '
                '"OK" (optionally "Always allow") when Android asks for '
                'permission.',
            canFallbackToSaf: true,
          );
        }
      }
    }

    try {
      await _channel.openDevice(deviceName: device.name);
      _opened = true;
    } on PlatformException catch (e) {
      throw _mapError(e);
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
          code: 'SEND_FAILED',
          message:
              'The controller rejected the transfer. Try again, or switch to '
              'the file-access fallback.',
          canFallbackToSaf: true,
        );
      }
    } on PlatformException catch (e) {
      throw _mapError(e);
    }
  }

  @override
  Future<void> dispose() async {
    if (!_opened) return;
    _opened = false;
    try {
      await _channel.closeDevice();
    } on PlatformException {
      // Best-effort cleanup; ignore.
    }
  }

  /// Waits for the `usb_permission_granted` / `usb_permission_denied` event
  /// that follows a permission dialog. Resolves `true` on grant, `false` on
  /// denial or timeout.
  Future<bool> _awaitPermissionDecision() {
    final completer = Completer<bool>();
    late final StreamSubscription<MtpEvent> sub;

    void finish(bool granted) {
      if (completer.isCompleted) return;
      sub.cancel();
      completer.complete(granted);
    }

    sub = _channel.events.listen(
      (event) {
        switch (event.type) {
          case MtpEventType.usbPermissionGranted:
            finish(true);
          case MtpEventType.usbPermissionDenied:
            finish(false);
          default:
            break;
        }
      },
      onError: (_) => finish(false),
    );

    return completer.future.timeout(
      _permissionTimeout,
      onTimeout: () {
        finish(false);
        return false;
      },
    );
  }

  TransferException _mapError(PlatformException e) {
    final detail = e.message;
    return switch (e.code) {
      'NO_PERMISSION' => TransferException(
          code: e.code,
          message:
              'USB access was not granted. Reconnect the controller and allow '
              'access when prompted.',
          canFallbackToSaf: true,
          technical: detail,
        ),
      'OPEN_FAILED' || 'MTP_OPEN_FAILED' => TransferException(
          code: e.code,
          message:
              'Could not open the controller over USB. Unplug and replug the '
              'cable, then try again. If it keeps failing, use file access.',
          canFallbackToSaf: true,
          technical: detail,
        ),
      'NOT_CONNECTED' => TransferException(
          code: e.code,
          message:
              'Lost the connection to the controller. Check the cable and '
              'reconnect.',
          canFallbackToSaf: true,
          technical: detail,
        ),
      'NO_STORAGE' => TransferException(
          code: e.code,
          message:
              'The controller did not expose any storage. Make sure it is '
              'powered on and unlocked.',
          canFallbackToSaf: true,
          technical: detail,
        ),
      'DIR_NOT_FOUND' => TransferException(
          code: e.code,
          message:
              'The DJI waypoint folder was not found. Open DJI Fly on the '
              'controller and create at least one waypoint mission first.',
          requiresDjiSetup: true,
          technical: detail,
        ),
      'MISSION_NOT_FOUND' => TransferException(
          code: e.code,
          message:
              'That mission slot is no longer on the controller. Refresh the '
              'list and pick another.',
          technical: detail,
        ),
      'SEND_INFO_FAILED' || 'SEND_FAILED' => TransferException(
          code: e.code,
          message:
              'The controller rejected the file. Try again, or switch to the '
              'file-access fallback.',
          canFallbackToSaf: true,
          technical: detail,
        ),
      _ => TransferException(
          code: e.code,
          message: 'USB transfer failed. ${detail ?? ''}'.trim(),
          canFallbackToSaf: true,
          technical: detail,
        ),
    };
  }
}
