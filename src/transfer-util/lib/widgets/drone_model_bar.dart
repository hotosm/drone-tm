import 'package:flutter/material.dart';

import '../models/drone_model.dart';

/// Persistent bar at the top of the app showing the selected drone model and
/// letting the user change it. Tapping opens a bottom sheet of the supported
/// models.
class DroneModelBar extends StatelessWidget {
  const DroneModelBar({
    super.key,
    required this.selected,
    required this.onSelected,
  });

  final DroneModel selected;
  final ValueChanged<DroneModel> onSelected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Material(
      color: scheme.surfaceContainerHighest,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => _openPicker(context),
        child: Semantics(
          button: true,
          label: 'Drone model: ${selected.name}. Tap to change.',
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            child: Row(
              children: [
                Icon(Icons.flight, color: scheme.onSurfaceVariant, size: 20),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Drone model',
                        style: theme.textTheme.labelSmall
                            ?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                      Text(
                        selected.name,
                        style: theme.textTheme.titleSmall
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                ),
                if (!selected.onDeviceTransfer)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: _WebBadge(scheme: scheme),
                  ),
                Icon(Icons.expand_more, color: scheme.onSurfaceVariant),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _openPicker(BuildContext context) {
    final theme = Theme.of(context);
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetCtx) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
                child: Text(
                  'Select drone model',
                  style: theme.textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
              for (final m in DroneModels.all)
                ListTile(
                  leading: Icon(
                    m.isDji ? Icons.flight : Icons.flight_takeoff,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  title: Text(m.name),
                  subtitle: Text(
                    m.onDeviceTransfer
                        ? 'Direct USB transfer'
                        : 'Use the DroneTM web USB transfer',
                  ),
                  trailing: m.id == selected.id
                      ? Icon(Icons.check, color: theme.colorScheme.primary)
                      : null,
                  onTap: () {
                    Navigator.pop(sheetCtx);
                    if (m.id != selected.id) onSelected(m);
                  },
                ),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }
}

class _WebBadge extends StatelessWidget {
  const _WebBadge({required this.scheme});

  final ColorScheme scheme;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: scheme.secondaryContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        'WEB ONLY',
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.4,
          color: scheme.onSecondaryContainer,
        ),
      ),
    );
  }
}
