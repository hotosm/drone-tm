import 'dart:async';

import 'package:flutter/services.dart';

import '../models/diagnostic_report.dart';
import '../models/mission.dart';
import '../platform/mtp_channel.dart';
import 'diagnostics_service.dart';
import 'transfer_strategy.dart';

/// How the USB permission handshake resolved. `timeout` is distinct from
/// `denied` because on Android 14 a timeout can mean the permission broadcast
/// never arrived rather than the user saying no — a different bug to chase.
enum _PermOutcome { granted, denied, timeout }

/// Combine a [PlatformException]'s message with any structured `details`
/// (e.g. the DJI-path traversal context attached to `DIR_NOT_FOUND`).
String? _detailOf(PlatformException e) {
  if (e.details == null) return e.message;
  return '${e.message ?? ''} ${e.details}'.trim();
}

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
      DiagnosticLog.instance.mark('Find controller on USB', DiagStatus.fail,
          code: 'NO_DEVICE',
          detail: 'no DJI/MTP device on the USB bus (OTG/cable/USB-mode?)');
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
    DiagnosticLog.instance.mark('Find controller on USB', DiagStatus.ok,
        detail:
            '${device.name} (vid=${device.vendorId} pid=${device.productId})');

    if (!device.hasPermission) {
      final alreadyGranted =
          await _channel.requestPermission(deviceName: device.name);
      if (!alreadyGranted) {
        final outcome = await _awaitPermissionDecision();
        if (outcome != _PermOutcome.granted) {
          DiagnosticLog.instance.mark(
            'USB permission',
            outcome == _PermOutcome.timeout
                ? DiagStatus.timeout
                : DiagStatus.fail,
            code: 'NO_PERMISSION',
            detail: outcome == _PermOutcome.timeout
                ? 'no grant within 45s — denied, or the permission broadcast '
                    'never arrived (Android 14 RECEIVER_EXPORTED class)'
                : 'permission denied',
          );
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
      DiagnosticLog.instance.mark('USB permission', DiagStatus.ok);
    } else {
      DiagnosticLog.instance
          .mark('USB permission', DiagStatus.ok, detail: 'already granted');
    }

    final sw = Stopwatch()..start();
    try {
      final info = await _channel.openDevice(deviceName: device.name);
      _opened = true;
      final di = coerceMap(info);
      DiagnosticLog.instance.mark('Open MTP session', DiagStatus.ok,
          durationMs: sw.elapsedMilliseconds,
          detail:
              'mfr=${di['manufacturer']} model=${di['model']} serial=${di['serialNumber']}');
    } on PlatformException catch (e) {
      DiagnosticLog.instance.mark('Open MTP session', DiagStatus.fail,
          code: e.code, detail: e.message, durationMs: sw.elapsedMilliseconds);
      throw _mapError(e);
    }
  }

  @override
  Future<List<Mission>> listMissions() async {
    final sw = Stopwatch()..start();
    try {
      final missions = await _channel.listMissions();
      DiagnosticLog.instance.mark('List mission slots', DiagStatus.ok,
          durationMs: sw.elapsedMilliseconds,
          detail: '${missions.length} slot(s)');
      return missions;
    } on PlatformException catch (e) {
      DiagnosticLog.instance.mark('List mission slots', DiagStatus.fail,
          code: e.code,
          detail: _detailOf(e),
          durationMs: sw.elapsedMilliseconds);
      throw _mapError(e);
    }
  }

  @override
  Future<void> transfer({
    required String uuid,
    required Uint8List kmzData,
  }) async {
    final sw = Stopwatch()..start();
    try {
      final ok = await _channel.transferKmz(uuid: uuid, kmzData: kmzData);
      if (!ok) {
        DiagnosticLog.instance.mark('Transfer KMZ', DiagStatus.fail,
            code: 'SEND_FAILED',
            detail: 'controller returned false',
            durationMs: sw.elapsedMilliseconds);
        throw const TransferException(
          code: 'SEND_FAILED',
          message:
              'The controller rejected the transfer. Try again, or switch to '
              'the file-access fallback.',
          canFallbackToSaf: true,
        );
      }
      DiagnosticLog.instance.mark('Transfer KMZ', DiagStatus.ok,
          durationMs: sw.elapsedMilliseconds,
          detail: '${kmzData.length} bytes → $uuid');
    } on PlatformException catch (e) {
      DiagnosticLog.instance.mark('Transfer KMZ', DiagStatus.fail,
          code: e.code,
          detail: _detailOf(e),
          durationMs: sw.elapsedMilliseconds);
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
  /// that follows a permission dialog, distinguishing grant, denial, and a
  /// timeout (which may mean the broadcast never arrived).
  Future<_PermOutcome> _awaitPermissionDecision() {
    final completer = Completer<_PermOutcome>();
    late final StreamSubscription<MtpEvent> sub;

    void finish(_PermOutcome outcome) {
      if (completer.isCompleted) return;
      sub.cancel();
      completer.complete(outcome);
    }

    sub = _channel.events.listen(
      (event) {
        switch (event.type) {
          case MtpEventType.usbPermissionGranted:
            finish(_PermOutcome.granted);
          case MtpEventType.usbPermissionDenied:
            finish(_PermOutcome.denied);
          default:
            break;
        }
      },
      onError: (_) => finish(_PermOutcome.denied),
    );

    return completer.future.timeout(
      _permissionTimeout,
      onTimeout: () {
        finish(_PermOutcome.timeout);
        return _PermOutcome.timeout;
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
