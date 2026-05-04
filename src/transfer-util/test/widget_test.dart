import 'package:flutter_test/flutter_test.dart';

import 'package:dronetm_transfer/main.dart';

void main() {
  testWidgets('App launches', (WidgetTester tester) async {
    await tester.pumpWidget(const DroneTMTransferApp());
    expect(find.text('DroneTM Transfer'), findsOneWidget);
  });
}
