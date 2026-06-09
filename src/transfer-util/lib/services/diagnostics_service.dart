import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../models/diagnostic_report.dart';
import '../platform/diag_channel.dart';
import '../platform/mtp_channel.dart';

/// Always-on, app-wide log of diagnostic steps.
///
/// The transfer flow and the standalone scan both write here, so an exported
/// report carries the full recent history regardless of where a failure
/// happened. It's a global singleton so the transfer strategy can record
/// without threading a dependency through the whole app.
class DiagnosticLog extends ChangeNotifier {
  DiagnosticLog._();
  static final DiagnosticLog instance = DiagnosticLog._();

  static const _cap = 200;
  final List<DiagnosticStep> _steps = [];
  List<DiagnosticStep> get steps => List.unmodifiable(_steps);

  // Most recent heavy captures (from a scan, or grabbed lazily at report time).
  Map<String, dynamic>? lastEnvironment;
  List<Map<String, dynamic>>? lastUsbDevices;
  Map<String, dynamic>? lastMtpTree;

  void record(DiagnosticStep step) {
    _steps.add(step);
    if (_steps.length > _cap) _steps.removeRange(0, _steps.length - _cap);
    notifyListeners();
  }

  /// Record a finished step. Safe to call from anywhere in the transfer flow.
  void mark(
    String name,
    DiagStatus status, {
    String? code,
    String? detail,
    int? durationMs,
  }) {
    record(DiagnosticStep(
      name: name,
      status: status,
      code: code,
      detail: detail,
      durationMs: durationMs,
    ));
  }

  void clear() {
    _steps.clear();
    // Also drop the cached heavy captures, else a later export would reuse a
    // stale environment/USB/MTP-tree alongside an empty step log.
    lastEnvironment = null;
    lastUsbDevices = null;
    lastMtpTree = null;
    notifyListeners();
  }
}

/// Orchestrates the standalone diagnostic scan and the four report-export paths
/// (share, clipboard, save-to-Downloads, offline POST queue). Watches its own
/// `busy` state; the live step list lives in [DiagnosticLog].
class DiagnosticsService extends ChangeNotifier {
  DiagnosticsService({MtpChannel? mtp, DiagChannel? diag})
      : _mtp = mtp ?? MtpChannel(),
        _diag = diag ?? DiagChannel();

  final MtpChannel _mtp;
  final DiagChannel _diag;
  final DiagnosticLog _log = DiagnosticLog.instance;

  static const _permissionTimeout = Duration(seconds: 45);

  bool _busy = false;
  bool get busy => _busy;

  String? _endpoint;
  String? get endpoint => _endpoint;

  DiagnosticLog get log => _log;

  /// Load any persisted upload endpoint and try to flush queued reports. Call
  /// once at startup. Best-effort: never throws.
  Future<void> init() async {
    try {
      await _loadEndpoint();
      await flushQueue();
    } catch (_) {
      // Diagnostics must never block app startup.
    }
  }

  // ---- Standalone scan --------------------------------------------------

  /// Probe the phone, the USB bus, and (if a controller is present) the MTP
  /// responder, recording each step. Needs no KMZ, so any phone+controller combo
  /// can be characterised in one tap. Returns the assembled report.
  Future<DiagnosticReport> runFullScan() async {
    _setBusy(true);
    try {
      _log.mark('— diagnostic scan started —', DiagStatus.info);

      final env = await _timed('Read phone environment', _mtp.getEnvironment);
      if (env != null) _log.lastEnvironment = env;

      final usb = await _timed('Enumerate USB devices', _mtp.dumpUsbDevices);
      if (usb != null) {
        _log.lastUsbDevices = usb;
        _log.mark('USB bus: ${usb.length} device(s)', DiagStatus.info,
            detail: usb.isEmpty
                ? null
                : usb
                    .map((d) =>
                        'vid=${d['vendorId']} pid=${d['productId']}${d['isDji'] == true ? ' DJI' : ''}')
                    .join('; '));
      }

      Map<String, dynamic>? tree;
      final devices = await _safe(_mtp.getConnectedDevices) ?? const [];
      if (devices.isEmpty) {
        _log.mark('Find controller on USB', DiagStatus.fail,
            code: 'NO_DEVICE',
            detail: (usb == null || usb.isEmpty)
                ? 'No USB devices enumerated at all — no OTG/USB-host support, a '
                    'charge-only cable, or the controller is not in a USB data mode.'
                : 'USB devices are present but none match a DJI/MTP controller. '
                    'Check the product id against device_filter.xml.');
      } else {
        final target =
            devices.firstWhere((d) => d.isDji, orElse: () => devices.first);
        _log.mark('Find controller on USB', DiagStatus.ok,
            detail:
                '${target.name} (vid=${target.vendorId} pid=${target.productId})');

        final granted = await _ensurePermission(target.name, target.hasPermission);
        if (granted) {
          final opened = await _timed(
            'Open MTP session',
            () => _mtp.openDevice(deviceName: target.name),
          );
          if (opened != null) {
            final info = coerceMap(opened);
            _log.mark('MTP device info', DiagStatus.info,
                detail:
                    'mfr=${info['manufacturer']} model=${info['model']} serial=${info['serialNumber']}');
            tree = await _timed(
                'Inspect MTP storage + DJI path', () => _mtp.dumpMtpTree());
            if (tree != null) {
              _log.lastMtpTree = tree;
              _recordDjiPath(tree);
            }
            await _safe(_mtp.closeDevice);
          }
        }
      }

      _log.mark('— diagnostic scan finished —', DiagStatus.info);
      return _assemble('scan', env ?? {}, usb ?? const [], tree);
    } finally {
      _setBusy(false);
    }
  }

  /// Polls for the USB permission grant rather than using the event channel,
  /// which the [TransferController] owns. Distinguishes grant from a timeout
  /// (which on Android 14 can mean the permission broadcast never arrived).
  Future<bool> _ensurePermission(String name, bool alreadyHas) async {
    if (alreadyHas) {
      _log.mark('USB permission', DiagStatus.ok, detail: 'already granted');
      return true;
    }
    final granted = await _safe(() => _mtp.requestPermission(deviceName: name));
    if (granted == true) {
      _log.mark('USB permission', DiagStatus.ok, detail: 'already granted');
      return true;
    }
    final sw = Stopwatch()..start();
    while (sw.elapsed < _permissionTimeout) {
      await Future<void>.delayed(const Duration(milliseconds: 500));
      final devices = await _safe(_mtp.getConnectedDevices) ?? const [];
      final match = devices.where((d) => d.name == name);
      if (match.isNotEmpty && match.first.hasPermission) {
        _log.mark('USB permission', DiagStatus.ok,
            durationMs: sw.elapsedMilliseconds);
        return true;
      }
    }
    _log.mark('USB permission', DiagStatus.timeout,
        code: 'NO_PERMISSION',
        durationMs: sw.elapsedMilliseconds,
        detail:
            'No grant within 45s. Either the dialog was denied/dismissed, or the '
            'permission broadcast never arrived (the Android 14 RECEIVER_EXPORTED '
            'class of hang).');
    return false;
  }

  void _recordDjiPath(Map<String, dynamic> tree) {
    final dji = (tree['djiPath'] as Map?) ?? const {};
    final missing = dji['missingSegment'];
    if (missing == null) {
      final slots = (dji['waypointSlots'] as List?) ?? const [];
      _log.mark('DJI waypoint path', DiagStatus.ok,
          detail: 'reached waypoint/ — ${slots.length} mission slot(s)');
    } else {
      final children = (dji['childrenAtFailure'] as List?) ?? const [];
      _log.mark('DJI waypoint path', DiagStatus.fail,
          code: 'DIR_NOT_FOUND',
          detail:
              'stopped at "${dji['deepestSegment'] ?? '(root)'}", missing "$missing". '
              'present here: ${children.isEmpty ? '(empty)' : children.join(', ')}');
    }
  }

  // ---- Report assembly --------------------------------------------------

  /// Build a report from the current session: the last heavy captures (lazily
  /// grabbing environment + USB if a scan was never run) plus the full step log.
  Future<DiagnosticReport> buildSessionReport() async {
    final env = _log.lastEnvironment ?? await _safe(_mtp.getEnvironment) ?? {};
    final usb =
        _log.lastUsbDevices ?? await _safe(_mtp.dumpUsbDevices) ?? const [];
    _log.lastEnvironment = env;
    _log.lastUsbDevices = usb;
    return _assemble('session', env, usb, _log.lastMtpTree);
  }

  DiagnosticReport _assemble(
    String kind,
    Map<String, dynamic> env,
    List<Map<String, dynamic>> usb,
    Map<String, dynamic>? tree,
  ) {
    final snapshot = List<DiagnosticStep>.from(_log.steps);
    return DiagnosticReport(
      kind: kind,
      environment: env,
      usbDevices: usb,
      mtpTree: tree,
      steps: snapshot,
      // Scope the "last fail" verdict to THIS run so a clean scan after an
      // earlier failure isn't mislabelled with a stale failure code.
      summary: _summarize(env, usb, tree, _scopeForSummary(snapshot, kind)),
    );
  }

  /// For a scan report, restrict the summary to the steps since the most recent
  /// scan boundary marker; a session report summarises the whole log. Done by
  /// content (not index) so it's safe against the 200-entry ring-buffer trim.
  List<DiagnosticStep> _scopeForSummary(List<DiagnosticStep> all, String kind) {
    if (kind != 'scan') return all;
    for (var i = all.length - 1; i >= 0; i--) {
      if (all[i].status == DiagStatus.info &&
          all[i].name.contains('scan started')) {
        return all.sublist(i);
      }
    }
    return all;
  }

  String _summarize(
    Map<String, dynamic> env,
    List<Map<String, dynamic>> usb,
    Map<String, dynamic>? tree,
    List<DiagnosticStep> runSteps,
  ) {
    final parts = <String>[];
    final dji = usb.where((d) => d['isDji'] == true).length;
    final mtp = usb.where((d) => d['looksMtp'] == true).length;
    parts.add('USB ${usb.length} (DJI $dji, MTP $mtp)');
    if (env['hasUsbHostFeature'] == false) parts.add('NO USB-host');
    if (tree != null) {
      final dpath = (tree['djiPath'] as Map?) ?? const {};
      parts.add(dpath['missingSegment'] == null
          ? 'waypoint OK (${(dpath['waypointSlots'] as List?)?.length ?? 0} slots)'
          : 'path stops @ ${dpath['deepestSegment'] ?? 'root'}');
    }
    DiagnosticStep? lastFail;
    for (final s in runSteps) {
      if (s.status == DiagStatus.fail || s.status == DiagStatus.timeout) {
        lastFail = s;
      }
    }
    if (lastFail != null) {
      parts.add('last fail: ${lastFail.code ?? lastFail.name}');
    } else if (parts.isNotEmpty) {
      parts.add('no failures recorded');
    }
    return parts.join(' | ');
  }

  // ---- Export paths -----------------------------------------------------

  Future<bool> share(DiagnosticReport r) =>
      _diag.shareReport(r.fileName, r.toText());

  Future<void> copyToClipboard(DiagnosticReport r) =>
      Clipboard.setData(ClipboardData(text: r.toText()));

  Future<String?> saveToDownloads(DiagnosticReport r) =>
      _diag.saveReportToDownloads(r.fileName, r.toText());

  /// Queue the report for upload and attempt an immediate flush. Failures stay
  /// on disk and are retried on the next [init]/scan. No-op send until an
  /// endpoint is configured, but the report is always persisted.
  Future<void> uploadWhenOnline(DiagnosticReport r) async {
    await _enqueue(r);
    try {
      await flushQueue();
    } catch (_) {/* stays queued */}
  }

  Future<void> _enqueue(DiagnosticReport r) async {
    final dir = await _diag.getAppFilesDir();
    if (dir == null) return;
    final qdir = Directory('$dir/diag_queue');
    if (!await qdir.exists()) await qdir.create(recursive: true);
    final file = File('${qdir.path}/${r.fileName}.json');
    await file.writeAsString(jsonEncode(r.toJson()));
  }

  /// Try to POST every queued report to the configured endpoint. Returns the
  /// number sent. Sent reports are deleted; the rest stay queued.
  Future<int> flushQueue() async {
    final url = _endpoint;
    if (url == null) return 0;
    final dir = await _diag.getAppFilesDir();
    if (dir == null) return 0;
    final qdir = Directory('$dir/diag_queue');
    if (!await qdir.exists()) return 0;
    var sent = 0;
    for (final entity in qdir.listSync()) {
      if (entity is! File) continue;
      try {
        final body = await entity.readAsString();
        if (await _post(url, body)) {
          await entity.delete();
          sent++;
        }
      } catch (_) {/* keep queued */}
    }
    return sent;
  }

  Future<bool> _post(String url, String body) async {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15);
    try {
      final req = await client.postUrl(Uri.parse(url));
      req.headers.contentType = ContentType.json;
      req.add(utf8.encode(body));
      final resp = await req.close();
      await resp.drain<void>();
      return resp.statusCode >= 200 && resp.statusCode < 300;
    } finally {
      client.close(force: true);
    }
  }

  /// Count of reports currently waiting to upload.
  Future<int> pendingUploads() async {
    final dir = await _diag.getAppFilesDir();
    if (dir == null) return 0;
    final qdir = Directory('$dir/diag_queue');
    if (!await qdir.exists()) return 0;
    return qdir.listSync().whereType<File>().length;
  }

  // ---- Upload endpoint config (persisted) -------------------------------

  Future<void> setEndpoint(String? url) async {
    final cleaned = (url == null || url.trim().isEmpty) ? null : url.trim();
    _endpoint = cleaned;
    final dir = await _diag.getAppFilesDir();
    if (dir != null) {
      await File('$dir/diag_endpoint.txt').writeAsString(cleaned ?? '');
    }
    notifyListeners();
  }

  Future<void> _loadEndpoint() async {
    final dir = await _diag.getAppFilesDir();
    if (dir == null) return;
    final file = File('$dir/diag_endpoint.txt');
    if (await file.exists()) {
      final value = (await file.readAsString()).trim();
      _endpoint = value.isEmpty ? null : value;
      notifyListeners();
    }
  }

  // ---- Helpers ----------------------------------------------------------

  /// Run [fn], recording a timed step with its outcome; returns null on failure.
  Future<T?> _timed<T>(String name, Future<T> Function() fn) async {
    final sw = Stopwatch()..start();
    try {
      final value = await fn();
      _log.mark(name, DiagStatus.ok, durationMs: sw.elapsedMilliseconds);
      return value;
    } on PlatformException catch (e) {
      _log.mark(name, DiagStatus.fail,
          code: e.code, detail: e.message, durationMs: sw.elapsedMilliseconds);
      return null;
    } catch (e) {
      _log.mark(name, DiagStatus.fail,
          detail: '$e', durationMs: sw.elapsedMilliseconds);
      return null;
    }
  }

  /// Run [fn], swallowing errors and returning null. Used where we don't want a
  /// recorded step (cleanup, polling).
  Future<T?> _safe<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } catch (_) {
      return null;
    }
  }

  void _setBusy(bool value) {
    _busy = value;
    notifyListeners();
  }
}
