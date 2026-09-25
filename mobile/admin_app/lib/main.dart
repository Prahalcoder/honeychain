import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

const appTitle = 'Honey Chain Admin';

// This computer's Wi-Fi address at build time — used until the officer changes it in-app (long-press the
// thin strip at the very top of the screen). Wi-Fi routers can hand out a different address later; if the
// address was never changed in-app either, update this and rebuild as a last resort.
const defaultServerUrl = 'http://172.16.127.61:5174';
const prefsKey = 'server_url';

const brandColor = Color(0xFF0D3532);

void main() {
  runApp(const HoneyChainApp());
}

class HoneyChainApp extends StatelessWidget {
  const HoneyChainApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: appTitle,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: brandColor, useMaterial3: true),
      home: const WebShell(),
    );
  }
}

class WebShell extends StatefulWidget {
  const WebShell({super.key});

  @override
  State<WebShell> createState() => _WebShellState();
}

class _WebShellState extends State<WebShell> {
  WebViewController? _controller;
  String _serverUrl = defaultServerUrl;
  bool _loading = true;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(prefsKey);
    _serverUrl = saved ?? defaultServerUrl;
    setState(() => _controller = _buildController(_serverUrl));
  }

  WebViewController _buildController(String url) {
    final controller = WebViewController.fromPlatformCreationParams(
      const PlatformWebViewControllerCreationParams(),
    );
    controller
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFF2F6F5))
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (_) => setState(() {
            _loading = true;
            _loadError = null;
          }),
          onPageFinished: (_) => setState(() => _loading = false),
          onWebResourceError: (error) {
            // Sub-frame/resource errors (ads blockers, favicons, etc.) shouldn't blank the whole app;
            // only treat a failure on the main document as "can't reach the server".
            if (error.isForMainFrame ?? true) {
              setState(() {
                _loading = false;
                _loadError = error.description;
              });
            }
          },
        ),
      )
      ..loadRequest(Uri.parse(url));

    final platform = controller.platform;
    if (platform is AndroidWebViewController) {
      AndroidWebViewController.enableDebugging(false);
      platform.setOnShowFileSelector(_onShowFileSelector);
    }
    return controller;
  }

  Future<List<String>> _onShowFileSelector(FileSelectorParams params) async {
    final files = await FilePicker.pickFiles(type: FileType.any);
    final picked = params.mode == FileSelectorMode.openMultiple ? files : files.take(1);
    return picked.map((f) => f.uri.toString()).toList();
  }

  Future<void> _openSettings() async {
    final controller = TextEditingController(text: _serverUrl);
    final newUrl = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Server address'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(
            hintText: 'http://192.168.1.8:5174',
            helperText: 'Shown at the bottom of "npm start" on your computer,\nunder "On your phone (same Wi-Fi)".',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Save & reload'),
          ),
        ],
      ),
    );
    if (newUrl == null || newUrl.isEmpty || newUrl == _serverUrl) return;

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(prefsKey, newUrl);
    setState(() {
      _serverUrl = newUrl;
      _loadError = null;
    });
    _controller?.loadRequest(Uri.parse(newUrl));
  }

  Future<bool> _handleBack() async {
    if (_controller != null && await _controller!.canGoBack()) {
      _controller!.goBack();
      return false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _handleBack()) {
          if (context.mounted) Navigator.of(context).maybePop();
        }
      },
      child: Scaffold(
        body: SafeArea(
          child: Column(
            children: [
              // Reserved strip, never part of the web page: long-press it to change the server address
              // without a rebuild. Kept plain (no icon/label) so it doesn't look like a button in daily use.
              GestureDetector(
                onLongPress: _openSettings,
                child: Container(height: 14, color: const Color(0xFFF2F6F5)),
              ),
              Expanded(
                child: Stack(
                  children: [
                    if (_loadError != null)
                      _ErrorView(url: _serverUrl, onRetry: () {
                        setState(() => _loadError = null);
                        _controller?.loadRequest(Uri.parse(_serverUrl));
                      })
                    else if (_controller != null)
                      WebViewWidget(controller: _controller!),
                    if (_loading && _loadError == null)
                      const Positioned(
                        top: 0,
                        left: 0,
                        right: 0,
                        child: LinearProgressIndicator(minHeight: 3, color: brandColor),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.url, required this.onRetry});

  final String url;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.wifi_off_rounded, size: 48, color: Colors.black38),
            const SizedBox(height: 16),
            Text(
              "Can't reach the server at $url.",
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            const Text(
              "Make sure your computer is running \"npm start\" and this phone is on the same Wi-Fi.\nLong-press the very top edge of the screen to change the server address.",
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.black54),
            ),
            const SizedBox(height: 20),
            FilledButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}
