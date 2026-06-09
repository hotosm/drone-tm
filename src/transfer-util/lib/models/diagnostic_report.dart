/// Structured, exportable record of a transfer attempt or a standalone scan.
///
/// The whole point of these types is to turn a field failure into something a
/// maintainer can act on remotely: which step broke, and the raw USB/MTP facts
/// underneath it. A report serialises to both JSON (machine) and plain text
/// (paste into a chat).
library;

/// Outcome of a single diagnostic step.
enum DiagStatus { ok, fail, timeout, info, running }

extension DiagStatusGlyph on DiagStatus {
  String get glyph => switch (this) {
        DiagStatus.ok => 'OK ',
        DiagStatus.fail => 'FAIL',
        DiagStatus.timeout => 'TIME',
        DiagStatus.info => 'INFO',
        DiagStatus.running => '... ',
      };

  String get label => switch (this) {
        DiagStatus.ok => 'ok',
        DiagStatus.fail => 'fail',
        DiagStatus.timeout => 'timeout',
        DiagStatus.info => 'info',
        DiagStatus.running => 'running',
      };
}

/// One step in a flow (e.g. "open device", "request permission", "send object")
/// with its outcome and any error/code detail.
class DiagnosticStep {
  DiagnosticStep({
    required this.name,
    required this.status,
    this.code,
    this.detail,
    this.durationMs,
    DateTime? at,
  }) : at = at ?? DateTime.now();

  final String name;
  final DiagStatus status;

  /// Stable machine code where there is one (mirrors the native error codes).
  final String? code;

  /// Free-text detail: the native `technical` string, structured context, etc.
  final String? detail;

  /// Wall-clock duration of the step, when measured.
  final int? durationMs;

  /// When the step finished (or started, for `running`).
  final DateTime at;

  DiagnosticStep copyWith({
    DiagStatus? status,
    String? code,
    String? detail,
    int? durationMs,
  }) =>
      DiagnosticStep(
        name: name,
        status: status ?? this.status,
        code: code ?? this.code,
        detail: detail ?? this.detail,
        durationMs: durationMs ?? this.durationMs,
        at: at,
      );

  Map<String, dynamic> toJson() => {
        'name': name,
        'status': status.label,
        if (code != null) 'code': code,
        if (detail != null) 'detail': detail,
        if (durationMs != null) 'durationMs': durationMs,
        'at': at.toIso8601String(),
      };

  String toLine() {
    final dur = durationMs != null ? ' (${durationMs}ms)' : '';
    final codePart = code != null ? ' [$code]' : '';
    final detailPart = detail != null && detail!.isNotEmpty ? '\n      $detail' : '';
    return '${status.glyph}  $name$codePart$dur$detailPart';
  }
}

/// A full diagnostic report: the phone/app context, the raw USB enumeration,
/// the MTP responder inspection, and the step-by-step log.
class DiagnosticReport {
  DiagnosticReport({
    required this.kind,
    required this.environment,
    required this.usbDevices,
    required this.mtpTree,
    required this.steps,
    required this.summary,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

  /// 'scan' for a standalone diagnostic scan, 'attempt' for a real transfer.
  final String kind;

  /// `getEnvironment()` map (phone make/model, Android SDK, USB-host feature…).
  final Map<String, dynamic> environment;

  /// `dumpUsbDevices()` — every USB device, unfiltered.
  final List<Map<String, dynamic>> usbDevices;

  /// `dumpMtpTree()` map, or null when no device was opened.
  final Map<String, dynamic>? mtpTree;

  final List<DiagnosticStep> steps;

  /// One-line verdict computed by the service.
  final String summary;

  final DateTime createdAt;

  String get fileName {
    final model = (environment['model'] as String?)?.replaceAll(RegExp(r'\s+'), '-') ?? 'phone';
    final ts = createdAt
        .toIso8601String()
        .replaceAll(':', '')
        .replaceAll('.', '-')
        .split('T')
        .join('_');
    return 'dronetm-$kind-$model-$ts.txt';
  }

  Map<String, dynamic> toJson() => {
        'kind': kind,
        'createdAt': createdAt.toIso8601String(),
        'summary': summary,
        'environment': environment,
        'usbDevices': usbDevices,
        'mtpTree': mtpTree,
        'steps': steps.map((s) => s.toJson()).toList(),
      };

  /// Human-readable report a tester can paste straight into a chat.
  String toText() {
    final b = StringBuffer();
    b.writeln('=== DroneTM Transfer — diagnostic report ===');
    b.writeln('kind:    $kind');
    b.writeln('time:    ${createdAt.toIso8601String()}');
    b.writeln('verdict: $summary');
    b.writeln();

    b.writeln('--- Environment ---');
    _writeEnv(b);
    b.writeln();

    b.writeln('--- USB devices (${usbDevices.length}) ---');
    if (usbDevices.isEmpty) {
      b.writeln('(none enumerated — no OTG/USB-host, a charge-only cable, or the '
          'controller is not in a USB data mode)');
    } else {
      for (final d in usbDevices) {
        _writeUsbDevice(b, d);
      }
    }
    b.writeln();

    b.writeln('--- MTP responder ---');
    _writeMtp(b);
    b.writeln();

    b.writeln('--- Steps ---');
    if (steps.isEmpty) {
      b.writeln('(no steps recorded)');
    } else {
      for (final s in steps) {
        b.writeln(s.toLine());
      }
    }
    return b.toString();
  }

  void _writeEnv(StringBuffer b) {
    String e(String k) => '${environment[k] ?? '?'}';
    b.writeln('phone:   ${e('manufacturer')} ${e('model')} (${e('device')})');
    b.writeln('android: ${e('androidRelease')} (SDK ${e('androidSdk')}), abi ${e('abi')}');
    b.writeln('usbHost: ${environment['hasUsbHostFeature'] == true ? 'yes' : 'NO (cannot act as USB host!)'}');
    b.writeln('app:     ${e('appVersion')}+${e('appBuild')}');
  }

  void _writeUsbDevice(StringBuffer b, Map<String, dynamic> d) {
    final vid = d['vendorId'];
    final pid = d['productId'];
    final tags = <String>[
      if (d['isDji'] == true) 'DJI',
      if (d['looksMtp'] == true) 'MTP-class',
      if (d['hasPermission'] == true) 'permitted' else 'no-perm',
    ];
    b.writeln('• ${d['productName'] ?? d['deviceName'] ?? '?'}  '
        'vid=$vid pid=$pid  '
        'class=${d['deviceClass']}  [${tags.join(', ')}]');
    final ifaces = (d['interfaces'] as List?) ?? const [];
    for (final i in ifaces) {
      final m = i as Map;
      b.writeln('    iface#${m['id']}: class=${m['interfaceClass']} '
          'sub=${m['subclass']} proto=${m['protocol']} eps=${m['endpointCount']}');
    }
  }

  void _writeMtp(StringBuffer b) {
    final tree = mtpTree;
    if (tree == null) {
      b.writeln('(device not opened — see steps above for why)');
      return;
    }
    final info = (tree['deviceInfo'] as Map?) ?? const {};
    b.writeln('device:  ${info['manufacturer'] ?? '?'} ${info['model'] ?? ''} '
        'serial=${info['serialNumber'] ?? '?'}');
    final storages = (tree['storages'] as List?) ?? const [];
    b.writeln('storage: ${tree['storageCount'] ?? storages.length} volume(s)');
    for (final s in storages) {
      final m = s as Map;
      b.writeln('    id=${m['id']} "${m['description']}" '
          'free=${m['freeSpaceBytes']} cap=${m['maxCapacityBytes']}');
    }
    final dji = (tree['djiPath'] as Map?) ?? const {};
    final missing = dji['missingSegment'];
    if (missing == null) {
      final slots = (dji['waypointSlots'] as List?) ?? const [];
      b.writeln('djiPath: reached waypoint/ — ${slots.length} mission slot(s)');
      if (slots.isNotEmpty) b.writeln('    slots: ${slots.join(', ')}');
    } else {
      final children = (dji['childrenAtFailure'] as List?) ?? const [];
      b.writeln('djiPath: STOPPED at "${dji['deepestSegment'] ?? '(root)'}" — '
          'missing "$missing" (depth ${dji['reachedDepth']})');
      b.writeln('    present here: ${children.isEmpty ? '(empty)' : children.join(', ')}');
    }
  }
}
