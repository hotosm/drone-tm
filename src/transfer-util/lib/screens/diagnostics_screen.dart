import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/diagnostic_report.dart';
import '../services/diagnostics_service.dart';

/// Field diagnostics: characterise this phone + controller in one tap, watch the
/// step-by-step log, and export a report that pinpoints why a transfer fails.
class DiagnosticsScreen extends StatefulWidget {
  const DiagnosticsScreen({super.key});

  @override
  State<DiagnosticsScreen> createState() => _DiagnosticsScreenState();
}

class _DiagnosticsScreenState extends State<DiagnosticsScreen> {
  DiagnosticReport? _report;
  bool _exporting = false;

  DiagnosticsService get _service => context.read<DiagnosticsService>();

  Future<void> _runScan() async {
    final report = await _service.runFullScan();
    if (!mounted) return;
    setState(() => _report = report);
  }

  /// The report to export: the last scan, or a freshly assembled session report
  /// (which still includes environment + USB enumeration + the full step log).
  Future<DiagnosticReport> _reportToExport() async =>
      _report ?? await _service.buildSessionReport();

  Future<void> _export(
    String label,
    Future<String?> Function(DiagnosticReport) action,
  ) async {
    setState(() => _exporting = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final report = await _reportToExport();
      final result = await action(report);
      if (!mounted) return;
      setState(() => _report = report);
      messenger.showSnackBar(SnackBar(content: Text(result ?? label)));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('$label failed: $e')));
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final service = context.watch<DiagnosticsService>();
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Diagnostics'),
        actions: [
          IconButton(
            tooltip: 'Clear log',
            onPressed: service.busy
                ? null
                : () {
                    service.log.clear();
                    setState(() => _report = null);
                  },
            icon: const Icon(Icons.delete_sweep_outlined),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 620),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              children: [
                Text(
                  'Run a scan with the controller plugged in to capture exactly '
                  'what this phone sees — USB enumeration, permission, MTP storage '
                  'and the DJI waypoint path — then export the report.',
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: service.busy ? null : _runScan,
                  icon: service.busy
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.troubleshoot),
                  label: Text(service.busy
                      ? 'Scanning…'
                      : 'Run full diagnostic scan'),
                ),
                if (_report != null) ...[
                  const SizedBox(height: 16),
                  _SummaryCard(report: _report!),
                ],
                const SizedBox(height: 20),
                _ExportBar(
                  busy: _exporting || service.busy,
                  onShare: () =>
                      _export('Shared', (r) async => (await _service.share(r)) ? 'Opened share sheet' : 'Share cancelled'),
                  onCopy: () => _export('Copied to clipboard', (r) async {
                    await _service.copyToClipboard(r);
                    return 'Copied to clipboard';
                  }),
                  onSave: () => _export('Saved', (r) async {
                    final path = await _service.saveToDownloads(r);
                    return path != null ? 'Saved to Downloads/DroneTM' : 'Saved';
                  }),
                  onSend: () => _export('Queued for upload', (r) async {
                    await _service.uploadWhenOnline(r);
                    final pending = await _service.pendingUploads();
                    return service.endpoint == null
                        ? 'Queued ($pending pending) — set an endpoint to upload'
                        : 'Queued/sent ($pending pending)';
                  }),
                ),
                const SizedBox(height: 20),
                Text('Log', style: theme.textTheme.titleMedium),
                const SizedBox(height: 8),
                _StepLog(log: service.log),
                const SizedBox(height: 20),
                _EndpointConfig(service: service),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.report});

  final DiagnosticReport report;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.summarize, size: 20, color: scheme.onSurface),
              const SizedBox(width: 10),
              Text('Summary',
                  style: theme.textTheme.titleSmall
                      ?.copyWith(fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 8),
          Text(report.summary, style: theme.textTheme.bodyMedium),
        ],
      ),
    );
  }
}

class _ExportBar extends StatelessWidget {
  const _ExportBar({
    required this.busy,
    required this.onShare,
    required this.onCopy,
    required this.onSave,
    required this.onSend,
  });

  final bool busy;
  final VoidCallback onShare;
  final VoidCallback onCopy;
  final VoidCallback onSave;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        OutlinedButton.icon(
          onPressed: busy ? null : onShare,
          icon: const Icon(Icons.ios_share),
          label: const Text('Share'),
        ),
        OutlinedButton.icon(
          onPressed: busy ? null : onCopy,
          icon: const Icon(Icons.copy),
          label: const Text('Copy'),
        ),
        OutlinedButton.icon(
          onPressed: busy ? null : onSave,
          icon: const Icon(Icons.download),
          label: const Text('Save'),
        ),
        OutlinedButton.icon(
          onPressed: busy ? null : onSend,
          icon: const Icon(Icons.cloud_upload_outlined),
          label: const Text('Send'),
        ),
      ],
    );
  }
}

class _StepLog extends StatelessWidget {
  const _StepLog({required this.log});

  final DiagnosticLog log;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: log,
      builder: (context, _) {
        final steps = log.steps;
        if (steps.isEmpty) {
          return Text(
            'No steps yet. Run a scan, or attempt a transfer from the main '
            'screen — every step is recorded here.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          );
        }
        return Container(
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerHigh,
            borderRadius: BorderRadius.circular(12),
          ),
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(
            children: [
              for (final step in steps.reversed) _StepRow(step: step),
            ],
          ),
        );
      },
    );
  }
}

class _StepRow extends StatelessWidget {
  const _StepRow({required this.step});

  final DiagnosticStep step;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final (color, icon) = switch (step.status) {
      DiagStatus.ok => (Colors.green, Icons.check_circle),
      DiagStatus.fail => (scheme.error, Icons.error),
      DiagStatus.timeout => (Colors.orange, Icons.timer_off),
      DiagStatus.info => (scheme.onSurfaceVariant, Icons.info_outline),
      DiagStatus.running => (scheme.primary, Icons.more_horiz),
    };
    final dur = step.durationMs != null ? '  ${step.durationMs}ms' : '';
    final code = step.code != null ? '  [${step.code}]' : '';

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${step.name}$code$dur',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(fontWeight: FontWeight.w600),
                ),
                if (step.detail != null && step.detail!.isNotEmpty)
                  Text(
                    step.detail!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                      fontFamily: 'monospace',
                      fontSize: 11.5,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EndpointConfig extends StatefulWidget {
  const _EndpointConfig({required this.service});

  final DiagnosticsService service;

  @override
  State<_EndpointConfig> createState() => _EndpointConfigState();
}

class _EndpointConfigState extends State<_EndpointConfig> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.service.endpoint ?? '');

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Theme(
      data: theme.copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        tilePadding: EdgeInsets.zero,
        childrenPadding: const EdgeInsets.only(bottom: 8),
        title: Text('Upload endpoint (optional)',
            style: theme.textTheme.titleSmall),
        subtitle: Text(
          widget.service.endpoint == null
              ? 'Not set — “Send” queues reports on disk until configured.'
              : widget.service.endpoint!,
          style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        children: [
          TextField(
            controller: _controller,
            keyboardType: TextInputType.url,
            decoration: const InputDecoration(
              hintText: 'https://…/diagnostics',
              border: OutlineInputBorder(),
              isDense: true,
            ),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.tonal(
              onPressed: () async {
                await widget.service.setEndpoint(_controller.text);
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Endpoint saved')),
                );
              },
              child: const Text('Save endpoint'),
            ),
          ),
        ],
      ),
    );
  }
}
