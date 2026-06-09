import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'screens/home_screen.dart';
import 'services/diagnostics_service.dart';
import 'state/transfer_controller.dart';
import 'theme.dart';

void main() {
  runApp(const DroneTMTransferApp());
}

/// Root widget. Owns the [TransferController] and the [DiagnosticsService] for
/// the whole app.
class DroneTMTransferApp extends StatelessWidget {
  const DroneTMTransferApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      // Both are built and started after the first frame, so a missing plugin
      // (e.g. in tests) can never block startup.
      providers: [
        ChangeNotifierProvider<TransferController>(
          create: (_) => TransferController()..init(),
        ),
        ChangeNotifierProvider<DiagnosticsService>(
          // init() loads any saved upload endpoint and flushes queued reports.
          create: (_) => DiagnosticsService()..init(),
        ),
      ],
      child: MaterialApp(
        title: 'DroneTM Transfer',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light(),
        darkTheme: AppTheme.dark(),
        home: const HomeScreen(),
      ),
    );
  }
}
