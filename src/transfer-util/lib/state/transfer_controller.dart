import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';

import '../models/diagnostic_report.dart';
import '../models/drone_model.dart';
import '../models/kmz_file.dart';
import '../models/mission.dart';
import '../platform/mtp_channel.dart';
import '../platform/saf_channel.dart';
import '../services/diagnostics_service.dart';
import '../services/mtp_transfer.dart';
import '../services/saf_transfer.dart';
import '../services/transfer_strategy.dart';

/// The distinct steps the user moves through. The UI renders one "step" widget
/// per phase, which keeps navigation flat and the flow obvious.
enum TransferPhase {
  /// The selected drone model can't be transferred to from this app
  /// (Potensic): show guidance to use the web method instead.
  unsupportedModel,

  /// No KMZ chosen yet.
  awaitingFile,

  /// Opening the controller / confirming access.
  connecting,

  /// SAF chosen but the waypoint folder hasn't been granted yet.
  needsFolder,

  /// Connected; mission slots loaded and ready to transfer.
  ready,

  /// Writing the file to the controller.
  transferring,

  /// Transfer finished successfully.
  done,

  /// Something failed; [error] explains what.
  failed,
}

/// Single source of truth for the transfer flow. Screens are thin observers of
/// this controller; all platform interaction is funnelled through it.
class TransferController extends ChangeNotifier {
  TransferController({MtpChannel? mtpChannel, SafChannel? safChannel})
      : _mtpChannel = mtpChannel ?? MtpChannel(),
        _safChannel = safChannel ?? SafChannel() {
    _mtp = MtpTransferStrategy(_mtpChannel);
    _saf = SafTransferStrategy(_safChannel);
  }

  final MtpChannel _mtpChannel;
  final SafChannel _safChannel;
  late final MtpTransferStrategy _mtp;
  late final SafTransferStrategy _saf;

  StreamSubscription<MtpEvent>? _eventSub;

  // ---- Observable state -------------------------------------------------

  TransferPhase _phase = TransferPhase.awaitingFile;
  TransferPhase get phase => _phase;

  DroneModel _model = DroneModels.fallback;
  DroneModel get model => _model;

  KmzFile? _file;
  KmzFile? get file => _file;

  TransferMethod _method = TransferMethod.mtp;
  TransferMethod get method => _method;

  List<Mission> _missions = const [];
  List<Mission> get missions => _missions;

  Mission? _selected;
  Mission? get selectedMission => _selected;

  TransferException? _error;
  TransferException? get error => _error;

  /// Human-readable status line shown under the header (device name, etc.).
  String _status = '';
  String get status => _status;

  bool _usbDevicePresent = false;

  /// Whether the active strategy is the direct-USB one.
  bool get isUsb => _method == TransferMethod.mtp;

  TransferStrategy get _strategy => isUsb ? _mtp : _saf;

  // ---- Lifecycle --------------------------------------------------------

  /// Wire up native events and pick up any file the app was launched with.
  /// All native calls are guarded so a missing plugin (e.g. in tests) never
  /// blocks the first frame.
  Future<void> init() async {
    _eventSub = _mtpChannel.events.listen(
      _onNativeEvent,
      onError: (_) {/* no plugin / no listener – ignore */},
    );

    try {
      _usbDevicePresent = await _mtp.hasDevice();
    } catch (_) {
      _usbDevicePresent = false;
    }
    _method =
        _usbDevicePresent ? TransferMethod.mtp : TransferMethod.saf;

    try {
      final incoming = await _mtpChannel.getInitialIntent();
      if (incoming != null) {
        await _loadFromUri(incoming.uri);
      }
    } catch (_) {
      // No launch intent / no plugin.
    }
    notifyListeners();
  }

  @override
  void dispose() {
    _eventSub?.cancel();
    _mtp.dispose();
    _saf.dispose();
    super.dispose();
  }

  // ---- Native events ----------------------------------------------------

  void _onNativeEvent(MtpEvent event) {
    switch (event.type) {
      case MtpEventType.fileReceived:
        final uri = event.uri;
        if (uri != null && uri.isNotEmpty) _loadFromUri(uri);
      case MtpEventType.deviceAttached:
        _usbDevicePresent = true;
        // If we were stuck waiting for a USB device, retry automatically.
        if (_file != null &&
            isUsb &&
            (_phase == TransferPhase.failed ||
                _phase == TransferPhase.awaitingFile)) {
          connectAndList();
        } else {
          notifyListeners();
        }
      case MtpEventType.deviceDisconnected:
        _usbDevicePresent = false;
        if (isUsb &&
            (_phase == TransferPhase.ready ||
                _phase == TransferPhase.connecting)) {
          _fail(const TransferException(
            code: 'NOT_CONNECTED',
            message:
                'The controller was unplugged. Reconnect it and try again.',
            canFallbackToSaf: true,
          ));
        } else {
          notifyListeners();
        }
      case MtpEventType.usbPermissionGranted:
      case MtpEventType.usbPermissionDenied:
      case MtpEventType.transferComplete:
      case MtpEventType.unknown:
        break;
    }
  }

  // ---- Drone model ------------------------------------------------------

  /// Changes the target drone model. Potensic can't be transferred to from
  /// this app, so it drops into the [TransferPhase.unsupportedModel] guidance
  /// step; DJI resumes the normal flow.
  Future<void> selectModel(DroneModel next) async {
    if (next.id == _model.id) return;
    _model = next;
    _error = null;

    if (!next.onDeviceTransfer) {
      await _strategy.dispose();
      _setPhase(TransferPhase.unsupportedModel);
      return;
    }

    // DJI: continue where it makes sense.
    if (_file != null) {
      await connectAndList();
    } else {
      _setPhase(TransferPhase.awaitingFile);
    }
  }

  // ---- File intake ------------------------------------------------------

  /// Opens the system file picker for the user to choose a `.kmz`.
  Future<void> pickFile() async {
    try {
      final result = await FilePicker.pickFiles(withData: true);
      if (result == null || result.files.isEmpty) return; // cancelled
      final picked = result.files.first;
      final bytes = picked.bytes;
      if (bytes == null) {
        _fail(const TransferException(
          code: 'READ_FAILED',
          message: 'Could not read that file. Try choosing it again.',
        ));
        return;
      }
      await setFile(KmzFile(name: picked.name, bytes: bytes));
    } catch (e) {
      _fail(TransferException(
        code: 'PICK_FAILED',
        message: 'Could not open the file picker.',
        technical: '$e',
      ));
    }
  }

  Future<void> _loadFromUri(String uri) async {
    try {
      final kmz = await _mtpChannel.readContentUri(uri);
      await setFile(kmz);
    } catch (e) {
      _fail(TransferException(
        code: 'READ_FAILED',
        message: 'Could not read the shared file.',
        technical: '$e',
      ));
    }
  }

  /// Accepts a KMZ and kicks off the connect → list flow.
  Future<void> setFile(KmzFile kmz) async {
    _file = kmz;
    _error = null;
    notifyListeners();
    await connectAndList();
  }

  // ---- Strategy / connection -------------------------------------------

  /// Switches transport (e.g. falling back to SAF) and reconnects.
  Future<void> useMethod(TransferMethod next) async {
    if (next == _method) return;
    await _strategy.dispose();
    _method = next;
    _error = null;
    await connectAndList();
  }

  Future<void> fallbackToSaf() => useMethod(TransferMethod.saf);

  /// Prepares the active strategy and loads the controller's mission slots.
  Future<void> connectAndList() async {
    if (_file == null) return;
    if (!_model.onDeviceTransfer) {
      _setPhase(TransferPhase.unsupportedModel);
      return;
    }
    _error = null;
    _setPhase(TransferPhase.connecting);
    _status = isUsb ? 'Opening controller over USB…' : 'Checking folder access…';
    DiagnosticLog.instance.mark(
      '— ${isUsb ? 'USB/MTP' : 'SAF'} attempt —',
      DiagStatus.info,
      detail: 'model=${_model.id} file=${_file?.name}',
    );
    notifyListeners();

    try {
      // For SAF, surface the folder picker step explicitly instead of
      // launching it from under a spinner.
      if (!isUsb && !await _saf.hasAccess()) {
        _setPhase(TransferPhase.needsFolder);
        return;
      }

      await _strategy.prepare();
      _missions = await _strategy.listMissions();
      _autoSelect();
      _status = isUsb ? 'Connected over USB' : 'Folder access granted';
      _setPhase(TransferPhase.ready);
    } on TransferException catch (e) {
      if (e.code == 'NO_DIR') {
        _setPhase(TransferPhase.needsFolder);
      } else {
        _fail(e);
      }
    } catch (e) {
      _fail(TransferException(
        code: 'UNEXPECTED',
        message: 'Something went wrong while connecting.',
        canFallbackToSaf: isUsb,
        technical: '$e',
      ));
    }
  }

  /// Launches the SAF folder picker, then lists missions on success.
  Future<void> chooseFolder() async {
    try {
      final granted = await _saf.requestAccess();
      if (!granted) return; // user cancelled; stay on needsFolder
      await connectAndList();
    } on TransferException catch (e) {
      _fail(e);
    }
  }

  void _autoSelect() {
    if (_missions.isEmpty) {
      _selected = null;
      return;
    }
    final inferred = _file?.inferredUuid;
    _selected = _missions.firstWhere(
      (m) => inferred != null && m.uuid == inferred,
      orElse: () => _missions.first, // most-recent (native sorts desc)
    );
  }

  void selectMission(Mission mission) {
    _selected = mission;
    notifyListeners();
  }

  // ---- Transfer ---------------------------------------------------------

  Future<void> startTransfer() async {
    final file = _file;
    final mission = _selected;
    if (file == null || mission == null) return;

    _setPhase(TransferPhase.transferring);
    _status = 'Sending ${file.name}…';
    notifyListeners();

    try {
      await _strategy.transfer(uuid: mission.uuid, kmzData: file.bytes);
      _status = 'Sent to ${mission.uuid}';
      _setPhase(TransferPhase.done);
    } on TransferException catch (e) {
      if (e.code == 'MISSION_NOT_FOUND') {
        // The slot vanished – refresh and let the user re-pick.
        await connectAndList();
      }
      _fail(e);
    } catch (e) {
      _fail(TransferException(
        code: 'UNEXPECTED',
        message: 'The transfer failed unexpectedly.',
        canFallbackToSaf: isUsb,
        technical: '$e',
      ));
    }
  }

  /// Retries the current step after a failure.
  Future<void> retry() async {
    _error = null;
    await connectAndList();
  }

  /// Clears the file and returns to the start to send another mission.
  void reset() {
    _file = null;
    _missions = const [];
    _selected = null;
    _error = null;
    _status = '';
    _setPhase(TransferPhase.awaitingFile);
  }

  // ---- Helpers ----------------------------------------------------------

  void _setPhase(TransferPhase p) {
    _phase = p;
    notifyListeners();
  }

  void _fail(TransferException e) {
    _error = e;
    _phase = TransferPhase.failed;
    notifyListeners();
  }
}
