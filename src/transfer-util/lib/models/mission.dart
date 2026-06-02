/// A waypoint mission "slot" that already exists on the DJI controller.
///
/// DJI Fly stores every mission in its sandboxed directory as
/// `Android/data/dji.go.v5/files/waypoint/<uuid>/<uuid>.kmz`. We can only ever
/// *replace* the `.kmz` inside a slot that DJI Fly has already created – we
/// cannot create new slots, because DJI also tracks them in an internal
/// database. That constraint is why the UI lists existing slots rather than
/// letting the user type a name.
class Mission {
  const Mission({
    required this.uuid,
    required this.dateModified,
    this.handle,
  });

  /// The directory name, which is the mission UUID used by DroneTM/DJI.
  final String uuid;

  /// Last-modified time of the slot directory (best-effort, used for sorting).
  final DateTime dateModified;

  /// MTP object handle, when discovered via the MTP strategy. Not needed for
  /// transfer (which addresses missions by [uuid]) but kept for debugging.
  final int? handle;

  /// Builds a [Mission] from the platform-channel map. Both the MTP and SAF
  /// Kotlin plugins return `{ uuid: String, dateModified: Long(ms), handle? }`.
  factory Mission.fromPlatform(Map<dynamic, dynamic> map) {
    final rawDate = map['dateModified'];
    final millis = rawDate is int ? rawDate : 0;
    return Mission(
      uuid: (map['uuid'] as String?)?.trim() ?? '',
      dateModified: DateTime.fromMillisecondsSinceEpoch(millis),
      handle: map['handle'] is int ? map['handle'] as int : null,
    );
  }

  bool get isValid => uuid.isNotEmpty;

  @override
  bool operator ==(Object other) =>
      other is Mission && other.uuid == uuid && other.handle == handle;

  @override
  int get hashCode => Object.hash(uuid, handle);

  @override
  String toString() => 'Mission($uuid, modified: $dateModified)';
}
