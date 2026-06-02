import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/transfer_strategy.dart';
import '../state/transfer_controller.dart';
import '../widgets/mission_selector.dart';

/// The single screen the whole app lives on. It renders one "step" per
/// [TransferPhase], keeping the flow flat and obvious rather than spread across
/// routes the user has to navigate.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<TransferController>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('DroneTM Transfer'),
        actions: [
          IconButton(
            tooltip: 'How it works',
            onPressed: () => _showHelp(context),
            icon: const Icon(Icons.help_outline),
          ),
        ],
      ),
      body: SafeArea(
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 250),
          child: SingleChildScrollView(
            key: ValueKey(controller.phase),
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: _PhaseView(controller: controller),
            ),
          ),
        ),
      ),
    );
  }

  void _showHelp(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => const _HelpSheet(),
    );
  }
}

class _PhaseView extends StatelessWidget {
  const _PhaseView({required this.controller});

  final TransferController controller;

  @override
  Widget build(BuildContext context) {
    return switch (controller.phase) {
      TransferPhase.awaitingFile => _AwaitingFileStep(controller: controller),
      TransferPhase.connecting => _BusyStep(
          label: controller.status.isEmpty ? 'Connecting…' : controller.status,
        ),
      TransferPhase.needsFolder => _NeedsFolderStep(controller: controller),
      TransferPhase.ready => _ReadyStep(controller: controller),
      TransferPhase.transferring => _BusyStep(
          label:
              controller.status.isEmpty ? 'Transferring…' : controller.status,
          showFile: true,
          controller: controller,
        ),
      TransferPhase.done => _DoneStep(controller: controller),
      TransferPhase.failed => _FailedStep(controller: controller),
    };
  }
}

// ---------------------------------------------------------------------------
// Step 1: choose / receive a file
// ---------------------------------------------------------------------------

class _AwaitingFileStep extends StatelessWidget {
  const _AwaitingFileStep({required this.controller});

  final TransferController controller;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 24),
        Center(
          child: Container(
            width: 96,
            height: 96,
            decoration: BoxDecoration(
              color: scheme.primaryContainer,
              shape: BoxShape.circle,
            ),
            child: Icon(Icons.upload_file,
                size: 44, color: scheme.onPrimaryContainer),
          ),
        ),
        const SizedBox(height: 24),
        Text(
          'Send a mission to your controller',
          textAlign: TextAlign.center,
          style: theme.textTheme.headlineSmall
              ?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        Text(
          'Pick the waypoint file (.kmz) you generated in DroneTM or QField, '
          'then we\'ll copy it straight onto the DJI controller over the cable.',
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyMedium
              ?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 28),
        FilledButton.icon(
          onPressed: controller.pickFile,
          icon: const Icon(Icons.folder_open),
          label: const Text('Choose a .kmz file'),
        ),
        const SizedBox(height: 16),
        _HintRow(
          icon: Icons.ios_share,
          text:
              'Tip: you can also Share a .kmz from QField or your browser to '
              '"DroneTM Transfer" and it will open here automatically.',
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Busy step (connecting / transferring)
// ---------------------------------------------------------------------------

class _BusyStep extends StatelessWidget {
  const _BusyStep({
    required this.label,
    this.showFile = false,
    this.controller,
  });

  final String label;
  final bool showFile;
  final TransferController? controller;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (showFile && controller?.file != null) ...[
          _FileCard(controller: controller!),
          const SizedBox(height: 24),
        ] else
          const SizedBox(height: 48),
        const Center(child: CircularProgressIndicator()),
        const SizedBox(height: 20),
        Text(
          label,
          textAlign: TextAlign.center,
          style: theme.textTheme.titleMedium,
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// SAF folder access step
// ---------------------------------------------------------------------------

class _NeedsFolderStep extends StatelessWidget {
  const _NeedsFolderStep({required this.controller});

  final TransferController controller;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _FileCard(controller: controller),
        const SizedBox(height: 16),
        _SectionCard(
          icon: Icons.folder_special,
          title: 'Grant folder access (one time)',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Android needs you to point to the controller\'s waypoint '
                'folder once. After that it\'s remembered.',
                style: theme.textTheme.bodyMedium,
              ),
              const SizedBox(height: 12),
              const _PathSteps(),
            ],
          ),
        ),
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: controller.chooseFolder,
          icon: const Icon(Icons.drive_folder_upload),
          label: const Text('Choose folder'),
        ),
        if (controller.method == TransferMethod.saf) ...[
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => controller.useMethod(TransferMethod.mtp),
            icon: const Icon(Icons.usb),
            label: const Text('Try direct USB instead'),
          ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Ready: pick a slot and send
// ---------------------------------------------------------------------------

class _ReadyStep extends StatelessWidget {
  const _ReadyStep({required this.controller});

  final TransferController controller;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasMissions = controller.missions.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _FileCard(controller: controller),
        const SizedBox(height: 16),
        _MethodToggle(controller: controller),
        const SizedBox(height: 20),
        if (!hasMissions)
          _SectionCard(
            icon: Icons.info_outline,
            title: 'No mission slots found',
            tone: _CardTone.warning,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'The controller has no waypoint missions yet. DJI only lets '
                  'us replace an existing mission, so create one first:',
                  style: theme.textTheme.bodyMedium,
                ),
                const SizedBox(height: 10),
                const _OrderedSteps(steps: [
                  'On the controller, open DJI Fly.',
                  'Create any waypoint mission (a single point is fine).',
                  'Come back here and tap Refresh.',
                ]),
              ],
            ),
          )
        else ...[
          Text(
            'Choose the slot to send into',
            style:
                theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 12),
          MissionSelector(
            missions: controller.missions,
            selected: controller.selectedMission,
            onSelected: controller.selectMission,
            highlightUuid: controller.file?.inferredUuid,
          ),
        ],
        const SizedBox(height: 20),
        if (hasMissions)
          FilledButton.icon(
            onPressed: controller.selectedMission == null
                ? null
                : controller.startTransfer,
            icon: const Icon(Icons.send),
            label: const Text('Send to controller'),
          )
        else
          FilledButton.icon(
            onPressed: controller.connectAndList,
            icon: const Icon(Icons.refresh),
            label: const Text('Refresh'),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

class _DoneStep extends StatelessWidget {
  const _DoneStep({required this.controller});

  final TransferController controller;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final uuid = controller.selectedMission?.uuid ?? '';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 28),
        Center(
          child: Container(
            width: 96,
            height: 96,
            decoration: BoxDecoration(
              color: scheme.tertiaryContainer,
              shape: BoxShape.circle,
            ),
            child: Icon(Icons.check_rounded,
                size: 52, color: scheme.onTertiaryContainer),
          ),
        ),
        const SizedBox(height: 24),
        Text(
          'Mission sent',
          textAlign: TextAlign.center,
          style: theme.textTheme.headlineSmall
              ?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        Text(
          'The waypoint file was copied onto the controller'
          '${uuid.isEmpty ? '' : ' (slot ${_short(uuid)})'}.',
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyMedium
              ?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: 16),
        _SectionCard(
          icon: Icons.flight_takeoff,
          title: 'On the controller',
          tone: _CardTone.success,
          child: Text(
            'Open DJI Fly and select that mission — your updated waypoints are '
            'ready to fly.',
            style: theme.textTheme.bodyMedium,
          ),
        ),
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: controller.reset,
          icon: const Icon(Icons.add),
          label: const Text('Send another'),
        ),
      ],
    );
  }

  String _short(String uuid) => uuid.length > 12
      ? '${uuid.substring(0, 8)}…'
      : uuid;
}

// ---------------------------------------------------------------------------
// Failed
// ---------------------------------------------------------------------------

class _FailedStep extends StatelessWidget {
  const _FailedStep({required this.controller});

  final TransferController controller;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final error = controller.error;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (controller.file != null) ...[
          _FileCard(controller: controller),
          const SizedBox(height: 16),
        ],
        _SectionCard(
          icon: error?.requiresDjiSetup == true
              ? Icons.flight
              : Icons.error_outline,
          title: error?.requiresDjiSetup == true
              ? 'One step on the controller'
              : 'Transfer didn\'t complete',
          tone: _CardTone.error,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                error?.message ?? 'Something went wrong. Please try again.',
                style: theme.textTheme.bodyMedium,
              ),
              if (error?.technical != null) ...[
                const SizedBox(height: 8),
                Theme(
                  data: theme.copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    childrenPadding: EdgeInsets.zero,
                    title: Text('Technical details',
                        style: theme.textTheme.bodySmall
                            ?.copyWith(color: scheme.onSurfaceVariant)),
                    children: [
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          '${error?.code}: ${error?.technical}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            fontFamily: 'monospace',
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: controller.retry,
          icon: const Icon(Icons.refresh),
          label: const Text('Try again'),
        ),
        if (error?.canFallbackToSaf == true &&
            controller.method == TransferMethod.mtp) ...[
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: controller.fallbackToSaf,
            icon: const Icon(Icons.folder),
            label: const Text('Use file access instead'),
          ),
        ],
        const SizedBox(height: 4),
        TextButton(
          onPressed: controller.reset,
          child: const Text('Start over'),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Shared widgets
// ---------------------------------------------------------------------------

class _FileCard extends StatelessWidget {
  const _FileCard({required this.controller});

  final TransferController controller;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final file = controller.file;
    if (file == null) return const SizedBox.shrink();

    final isKmz = file.looksLikeKmz;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: scheme.secondaryContainer,
              child: Icon(Icons.description, color: scheme.onSecondaryContainer),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    file.name,
                    style: theme.textTheme.titleSmall
                        ?.copyWith(fontWeight: FontWeight.w600),
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    isKmz
                        ? file.humanSize
                        : '${file.humanSize} • not a .kmz file',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: isKmz ? scheme.onSurfaceVariant : scheme.error,
                    ),
                  ),
                ],
              ),
            ),
            TextButton(
              onPressed: controller.pickFile,
              child: const Text('Change'),
            ),
          ],
        ),
      ),
    );
  }
}

class _MethodToggle extends StatelessWidget {
  const _MethodToggle({required this.controller});

  final TransferController controller;

  @override
  Widget build(BuildContext context) {
    return SegmentedButton<TransferMethod>(
      segments: const [
        ButtonSegment(
          value: TransferMethod.mtp,
          icon: Icon(Icons.usb),
          label: Text('Direct USB'),
        ),
        ButtonSegment(
          value: TransferMethod.saf,
          icon: Icon(Icons.folder),
          label: Text('File access'),
        ),
      ],
      selected: {controller.method},
      onSelectionChanged: (s) => controller.useMethod(s.first),
      showSelectedIcon: false,
    );
  }
}

enum _CardTone { neutral, success, warning, error }

class _SectionCard extends StatelessWidget {
  const _SectionCard({
    required this.icon,
    required this.title,
    required this.child,
    this.tone = _CardTone.neutral,
  });

  final IconData icon;
  final String title;
  final Widget child;
  final _CardTone tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (bg, fg) = switch (tone) {
      _CardTone.success => (scheme.tertiaryContainer, scheme.onTertiaryContainer),
      _CardTone.warning =>
        (scheme.secondaryContainer, scheme.onSecondaryContainer),
      _CardTone.error => (scheme.errorContainer, scheme.onErrorContainer),
      _CardTone.neutral =>
        (scheme.surfaceContainerHighest, scheme.onSurface),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: fg, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(color: fg, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          DefaultTextStyle.merge(
            style: TextStyle(color: fg),
            child: child,
          ),
        ],
      ),
    );
  }
}

class _HintRow extends StatelessWidget {
  const _HintRow({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: scheme.onSurfaceVariant),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            text,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ),
      ],
    );
  }
}

/// The DJI path rendered as discrete folder chips, so users know exactly what
/// to tap in the SAF picker.
class _PathSteps extends StatelessWidget {
  const _PathSteps();

  static const _segments = [
    'Android',
    'data',
    'dji.go.v5',
    'files',
    'waypoint',
  ];

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        for (var i = 0; i < _segments.length; i++) ...[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              color: scheme.surface,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: scheme.outlineVariant),
            ),
            child: Text(_segments[i],
                style: const TextStyle(
                    fontFamily: 'monospace', fontSize: 12.5)),
          ),
          if (i < _segments.length - 1)
            Icon(Icons.chevron_right, size: 16, color: scheme.onSurfaceVariant),
        ],
      ],
    );
  }
}

class _OrderedSteps extends StatelessWidget {
  const _OrderedSteps({required this.steps});

  final List<String> steps;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < steps.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${i + 1}.',
                    style: theme.textTheme.bodyMedium
                        ?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(width: 8),
                Expanded(
                    child: Text(steps[i], style: theme.textTheme.bodyMedium)),
              ],
            ),
          ),
      ],
    );
  }
}

class _HelpSheet extends StatelessWidget {
  const _HelpSheet();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('How it works',
              style: theme.textTheme.titleLarge
                  ?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 16),
          const _OrderedSteps(steps: [
            'Generate a waypoint mission (.kmz) in DroneTM or QField.',
            'Connect your phone to the DJI controller with a USB data cable.',
            'Open this app (or Share the .kmz to it) and pick the file.',
            'Choose the mission slot on the controller and send.',
          ]),
          const SizedBox(height: 16),
          Text('Why two methods?',
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Text(
            'Direct USB talks to the controller programmatically and needs no '
            'folder picking — it\'s the default. If your phone can\'t use it, '
            'switch to File access, which uses Android\'s folder picker once.',
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          Text('First time? Create a mission in DJI Fly',
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Text(
            'DJI only lets us replace an existing mission file. If no slots '
            'show up, make any waypoint mission in DJI Fly first, then refresh.',
            style: theme.textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }
}
