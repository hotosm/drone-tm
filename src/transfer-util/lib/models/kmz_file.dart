import 'dart:typed_data';

/// A KMZ waypoint file that the user wants to push onto the controller.
///
/// The bytes are held in memory because every transfer strategy ultimately
/// hands a `Uint8List` to the native side. KMZ mission files are small (a few
/// KB to low MB), so this is cheap and avoids juggling file paths/URIs across
/// the platform boundary.
class KmzFile {
  const KmzFile({
    required this.name,
    required this.bytes,
  });

  /// Original file name, e.g. `7f3c....kmz`.
  final String name;

  /// Raw file contents.
  final Uint8List bytes;

  int get sizeBytes => bytes.length;

  /// DroneTM names exported missions `<uuid>.kmz`, so the file name (minus the
  /// extension) is usually the mission UUID. We use this to auto-select the
  /// matching slot on the controller when one exists.
  String? get inferredUuid {
    final dot = name.toLowerCase().lastIndexOf('.kmz');
    if (dot <= 0) return null;
    final base = name.substring(0, dot).trim();
    return base.isEmpty ? null : base;
  }

  bool get looksLikeKmz => name.toLowerCase().endsWith('.kmz');

  String get humanSize {
    if (sizeBytes < 1024) return '$sizeBytes B';
    if (sizeBytes < 1024 * 1024) {
      return '${(sizeBytes / 1024).toStringAsFixed(1)} KB';
    }
    return '${(sizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}
