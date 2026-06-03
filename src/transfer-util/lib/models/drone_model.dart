/// Drone/controller families this app knows about.
enum DroneFamily { dji, potensic }

/// A selectable drone model and how (or whether) this app can transfer to its
/// controller.
///
/// The capability split mirrors the frontend's WebUSB transfer logic
/// (`src/frontend/src/utils/adb.ts`):
///
/// - **DJI** writes the mission KMZ to *external* app storage
///   (`Android/data/dji.go.v5/files/waypoint/<uuid>/<uuid>.kmz`), which is
///   reachable over MTP/SAF — so this app can do it directly.
/// - **Potensic** writes a SQLite database into the *private* app storage
///   (`run-as com.ipotensic.potensicpro … databases/test.db`), which is only
///   reachable via an ADB shell. MTP/SAF cannot touch private storage, so this
///   app cannot perform the Potensic transfer; the DroneTM web USB transfer
///   (which speaks ADB) must be used instead.
class DroneModel {
  const DroneModel({
    required this.id,
    required this.name,
    required this.family,
    required this.onDeviceTransfer,
  });

  /// Stable id, matching the frontend's drone model values.
  final String id;

  /// Display name.
  final String name;

  final DroneFamily family;

  /// Whether this app's MTP/SAF transport can deliver to this controller.
  /// `false` means the user must use the web/ADB method.
  final bool onDeviceTransfer;

  bool get isDji => family == DroneFamily.dji;
}

/// The models offered in the selector. Kept to exactly what's needed in the
/// field: the two DJI Minis and the Potensic Atom 2.
class DroneModels {
  DroneModels._();

  static const djiMini4Pro = DroneModel(
    id: 'DJI_MINI_4_PRO',
    name: 'DJI Mini 4 Pro',
    family: DroneFamily.dji,
    onDeviceTransfer: true,
  );

  static const djiMini5Pro = DroneModel(
    id: 'DJI_MINI_5_PRO',
    name: 'DJI Mini 5 Pro',
    family: DroneFamily.dji,
    onDeviceTransfer: true,
  );

  static const potensicAtom2 = DroneModel(
    id: 'POTENSIC_ATOM_2',
    name: 'Potensic Atom 2',
    family: DroneFamily.potensic,
    onDeviceTransfer: false,
  );

  static const all = <DroneModel>[djiMini4Pro, djiMini5Pro, potensicAtom2];

  /// Sensible default (matches the frontend's default drone model).
  static const fallback = djiMini4Pro;
}
