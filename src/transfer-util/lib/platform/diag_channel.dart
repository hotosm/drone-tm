import 'package:flutter/services.dart';

/// Thin wrapper over the native `org.hotosm.drone_tm/diag` channel for the
/// report-export paths that need platform APIs: a stable files dir for the POST
/// queue, saving into Downloads (MediaStore), and the system share sheet
/// (FileProvider). Clipboard and the HTTP POST itself are done in Dart.
class DiagChannel {
  DiagChannel() : _method = const MethodChannel('org.hotosm.drone_tm/diag');

  final MethodChannel _method;

  /// Absolute path to the app's private files dir (for the offline POST queue).
  Future<String?> getAppFilesDir() =>
      _method.invokeMethod<String>('getAppFilesDir');

  /// Saves [content] to `Downloads/DroneTM/[fileName]`; returns the saved
  /// path/URI on success.
  Future<String?> saveReportToDownloads(String fileName, String content) =>
      _method.invokeMethod<String>('saveReportToDownloads', {
        'fileName': fileName,
        'content': content,
      });

  /// Writes [content] to a shareable cache file and opens the system share
  /// sheet. Returns `true` once the chooser is launched.
  Future<bool> shareReport(String fileName, String content) async {
    final ok = await _method.invokeMethod<bool>('shareReport', {
      'fileName': fileName,
      'content': content,
    });
    return ok ?? false;
  }
}
