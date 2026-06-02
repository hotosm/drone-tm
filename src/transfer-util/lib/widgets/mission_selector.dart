import 'package:flutter/material.dart';

import '../models/mission.dart';

/// A selectable list of the mission slots found on the controller.
///
/// Each slot maps to a `<uuid>/` directory created by DJI Fly. Picking one and
/// transferring *replaces* the `.kmz` inside it, so the copy makes the
/// "overwrite" nature explicit.
class MissionSelector extends StatelessWidget {
  const MissionSelector({
    super.key,
    required this.missions,
    required this.selected,
    required this.onSelected,
    this.highlightUuid,
  });

  final List<Mission> missions;
  final Mission? selected;
  final ValueChanged<Mission> onSelected;

  /// UUID inferred from the file name; if a slot matches, it's badged as a
  /// suggested match.
  final String? highlightUuid;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final mission in missions)
          _MissionTile(
            mission: mission,
            isSelected: selected?.uuid == mission.uuid,
            isSuggested:
                highlightUuid != null && mission.uuid == highlightUuid,
            onTap: () => onSelected(mission),
          ),
        const SizedBox(height: 4),
        Text(
          'The selected slot\'s mission file will be replaced.',
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

class _MissionTile extends StatelessWidget {
  const _MissionTile({
    required this.mission,
    required this.isSelected,
    required this.isSuggested,
    required this.onTap,
  });

  final Mission mission;
  final bool isSelected;
  final bool isSuggested;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final shortId = mission.uuid.length > 12
        ? '${mission.uuid.substring(0, 8)}…${mission.uuid.substring(mission.uuid.length - 4)}'
        : mission.uuid;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: isSelected
            ? scheme.primaryContainer
            : scheme.surfaceContainerHighest,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(
            color: isSelected ? scheme.primary : scheme.outlineVariant,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Semantics(
            selected: isSelected,
            button: true,
            label: 'Mission slot $shortId'
                '${isSuggested ? ', suggested match' : ''}',
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(
                children: [
                  Icon(
                    isSelected
                        ? Icons.radio_button_checked
                        : Icons.radio_button_unchecked,
                    color: isSelected ? scheme.primary : scheme.outline,
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                shortId,
                                style: theme.textTheme.titleMedium?.copyWith(
                                  color: isSelected
                                      ? scheme.onPrimaryContainer
                                      : scheme.onSurface,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (isSuggested) ...[
                              const SizedBox(width: 8),
                              _Badge(label: 'Match', scheme: scheme),
                            ],
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(
                          _modified(mission.dateModified),
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: isSelected
                                ? scheme.onPrimaryContainer.withValues(alpha: 0.8)
                                : scheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  String _modified(DateTime t) {
    if (t.millisecondsSinceEpoch == 0) return 'Existing slot';
    final d = t.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return 'Updated ${d.year}-${two(d.month)}-${two(d.day)} ${two(d.hour)}:${two(d.minute)}';
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.label, required this.scheme});

  final String label;
  final ColorScheme scheme;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: scheme.tertiaryContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: scheme.onTertiaryContainer,
        ),
      ),
    );
  }
}
