/// A USB device reported by the native MTP plugin's `getConnectedDevices`.
class UsbDeviceInfo {
  const UsbDeviceInfo({
    required this.name,
    required this.vendorId,
    required this.productId,
    required this.hasPermission,
    required this.isDji,
  });

  final String name;
  final int vendorId;
  final int productId;
  final bool hasPermission;
  final bool isDji;

  factory UsbDeviceInfo.fromPlatform(Map<dynamic, dynamic> map) {
    return UsbDeviceInfo(
      name: (map['name'] as String?) ?? 'USB Device',
      vendorId: (map['vendorId'] as int?) ?? 0,
      productId: (map['productId'] as int?) ?? 0,
      hasPermission: (map['hasPermission'] as bool?) ?? false,
      isDji: (map['isDji'] as bool?) ?? false,
    );
  }

  @override
  String toString() =>
      'UsbDeviceInfo($name, vid: $vendorId, dji: $isDji, perm: $hasPermission)';
}
