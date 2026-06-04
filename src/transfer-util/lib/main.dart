import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'screens/home_screen.dart';
import 'state/transfer_controller.dart';
import 'theme.dart';

void main() {
  runApp(const DroneTMTransferApp());
}

/// Root widget. Owns the single [TransferController] for the whole app.
class DroneTMTransferApp extends StatelessWidget {
  const DroneTMTransferApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<TransferController>(
      // Build the controller and start listening for launch intents / events
      // after the first frame, so a missing plugin can never block startup.
      create: (_) => TransferController()..init(),
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
