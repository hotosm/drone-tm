import 'dart:typed_data';

import '../models/mission.dart';

/// Which underlying transport a [TransferStrategy] uses.
enum TransferMethod { mtp, saf }

/// A user-facing failure raised by a [TransferStrategy].
///
/// Native code throws `PlatformException`s with terse codes; strategies
/// translate those into a [TransferException] carrying a sentence the user can
/// actually act on, plus hints for the controller (whether falling back to SAF
/// might help, or whether the user must act in DJI Fly first).
class TransferException implements Exception {
  const TransferException({
    required this.code,
    required this.message,
    this.canFallbackToSaf = false,
    this.requiresDjiSetup = false,
    this.technical,
  });

  /// Stable machine code (mirrors the native error code where there is one).
  final String code;

  /// Friendly, actionable sentence shown to the user.
  final String message;

  /// True when retrying via the SAF strategy could plausibly succeed.
  final bool canFallbackToSaf;

  /// True when the fix is in DJI Fly (e.g. create a mission slot first).
  final bool requiresDjiSetup;

  /// Original technical detail, surfaced only in a "details" expander.
  final String? technical;

  @override
  String toString() => 'TransferException($code): $message';
}

/// A way of getting a KMZ file onto the controller. Implementations are the
/// direct-MTP path (primary) and the SAF path (fallback).
abstract class TransferStrategy {
  TransferMethod get method;

  /// Short label, e.g. "Direct USB".
  String get displayName;

  /// One-line explanation for the strategy picker.
  String get description;

  /// Establishes a usable session (open device / confirm directory access).
  /// Throws [TransferException] if it cannot be prepared.
  Future<void> prepare();

  /// Lists the mission slots already present on the controller.
  Future<List<Mission>> listMissions();

  /// Writes [kmzData] into the `<uuid>/<uuid>.kmz` slot, replacing any existing
  /// file. Throws [TransferException] on failure.
  Future<void> transfer({required String uuid, required Uint8List kmzData});

  /// Releases any held resources (open MTP handle, etc.). Safe to call twice.
  Future<void> dispose();
}
