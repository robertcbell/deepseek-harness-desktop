import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow?
    var webView: WKWebView?
    var loadingSpinner: NSProgressIndicator?
    var retryTimer: Timer?
    var serverProcess: Process?

    let serverURL = URL(string: "http://127.0.0.1:3080/")!
    let healthURL = URL(string: "http://127.0.0.1:3080/api/health")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMainMenu()
        setupWindow()
        ensureServerAndLoad()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    // MARK: - Window & UI Setup

    func setupWindow() {
        let windowRect = NSRect(x: 100, y: 100, width: 1280, height: 860)
        let win = NSWindow(
            contentRect: windowRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        win.title = "DeepSeek Harness"
        win.titleVisibility = .hidden
        win.titlebarAppearsTransparent = true
        win.isMovableByWindowBackground = true
        win.backgroundColor = NSColor(calibratedRed: 0.08, green: 0.08, blue: 0.09, alpha: 1.0)
        win.minSize = NSSize(width: 900, height: 600)
        win.setFrameAutosaveName("DeepSeekHarnessMainWindow")

        // Setup WebView
        let contentController = WKUserContentController()
        contentController.add(self, name: "dshBridge")

        // Inject script bundle if present (check ~/.dsh first, then bundled app resource)
        let userBundlePath = (("~/.dsh/scripts/injected_bundle.js" as NSString).expandingTildeInPath)
        let resourceBundlePath = Bundle.main.path(forResource: "injected_bundle", ofType: "js")
        let scriptPathToUse = FileManager.default.fileExists(atPath: userBundlePath) ? userBundlePath : resourceBundlePath

        if let path = scriptPathToUse,
           let scriptSource = try? String(contentsOfFile: path, encoding: .utf8) {
            let userScript = WKUserScript(source: scriptSource, injectionTime: .atDocumentEnd, forMainFrameOnly: false)
            contentController.addUserScript(userScript)
        }

        let config = WKWebViewConfiguration()
        config.userContentController = contentController

        let web = WKWebView(frame: win.contentView!.bounds, configuration: config)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.setValue(false, forKey: "drawsBackground")

        // Setup Loading Spinner
        let spinner = NSProgressIndicator(frame: NSRect(x: (win.contentView!.bounds.width - 40) / 2,
                                                       y: (win.contentView!.bounds.height - 40) / 2,
                                                       width: 40,
                                                       height: 40))
        spinner.style = .spinning
        spinner.controlSize = .regular
        spinner.autoresizingMask = [.minXMargin, .maxXMargin, .minYMargin, .maxYMargin]
        spinner.startAnimation(nil)

        win.contentView?.addSubview(web)
        win.contentView?.addSubview(spinner)

        self.webView = web
        self.loadingSpinner = spinner
        self.window = win

        win.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - Server & Loading

    func ensureServerAndLoad() {
        checkPort3080 { [weak self] isRunning in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if isRunning {
                    self.loadPage()
                } else {
                    self.startServer()
                    self.pollServerUntilReady()
                }
            }
        }
    }

    func checkPort3080(completion: @escaping (Bool) -> Void) {
        var request = URLRequest(url: healthURL)
        request.timeoutInterval = 2.0
        let task = URLSession.shared.dataTask(with: request) { _, response, error in
            if let httpResponse = response as? HTTPURLResponse {
                // Any status 200..499 indicates the server is listening
                completion(httpResponse.statusCode >= 200 && httpResponse.statusCode <= 499)
            } else {
                completion(false)
            }
        }
        task.resume()
    }

    func startServer() {
        // Try kickstarting LaunchAgent first
        let kickstartTask = Process()
        kickstartTask.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        kickstartTask.arguments = ["kickstart", "-k", "gui/\(getuid())/com.deepseek.dsh"]
        try? kickstartTask.run()
        kickstartTask.waitUntilExit()

        if kickstartTask.terminationStatus != 0 {
            // Fallback: spawn daemon script directly
            let daemonCandidates = [
                ("~/.dsh/scripts/dsh_daemon.sh" as NSString).expandingTildeInPath,
                ("~/.dsh/scripts/masterone_daemon.sh" as NSString).expandingTildeInPath
            ]
            if let activeScript = daemonCandidates.first(where: { FileManager.default.fileExists(atPath: $0) }) {
                let proc = Process()
                proc.executableURL = URL(fileURLWithPath: "/bin/bash")
                proc.arguments = [activeScript]
                var env = ProcessInfo.processInfo.environment
                let home = NSHomeDirectory()
                env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:\(home)/.bun/bin:\(home)/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + (env["PATH"] ?? "")
                proc.environment = env
                try? proc.run()
                self.serverProcess = proc
            }
        }
    }

    func pollServerUntilReady() {
        var attempts = 0
        self.retryTimer?.invalidate()
        self.retryTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] timer in
            guard let self = self else {
                timer.invalidate()
                return
            }
            attempts += 1
            self.checkPort3080 { isReady in
                if isReady {
                    DispatchQueue.main.async {
                        timer.invalidate()
                        self.loadPage()
                    }
                } else if attempts > 40 {
                    DispatchQueue.main.async {
                        timer.invalidate()
                        self.loadingSpinner?.stopAnimation(nil)
                        self.loadingSpinner?.isHidden = true
                        self.showErrorAlert(message: "Failed to connect to DeepSeek Harness daemon on port 3080.")
                    }
                }
            }
        }
    }

    func loadPage() {
        guard let webView = self.webView else { return }
        webView.load(URLRequest(url: serverURL))
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadingSpinner?.stopAnimation(nil)
        loadingSpinner?.isHidden = true
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        pollServerUntilReady()
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    // MARK: - Script Message Handler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "dshBridge", let body = message.body as? [String: Any] {
            if let action = body["action"] as? String {
                switch action {
                case "notify":
                    let title = body["title"] as? String ?? "DeepSeek Harness"
                    let msg = body["message"] as? String ?? ""
                    let note = NSUserNotification()
                    note.title = title
                    note.informativeText = msg
                    note.soundName = NSUserNotificationDefaultSoundName
                    NSUserNotificationCenter.default.deliver(note)
                case "openInBrowser":
                    openInBrowser()
                default:
                    break
                }
            }
        }
    }

    // MARK: - Menu Actions

    @objc func newSession() {
        webView?.evaluateJavaScript("document.querySelector('button:has-text(\"New Session\"), button[aria-label*=\"New\"], .new-session')?.click() || (window.location.href = 'http://127.0.0.1:3080/')", completionHandler: nil)
    }

    @objc func reloadPage() {
        webView?.reload()
    }

    @objc func forceReloadPage() {
        webView?.reloadFromOrigin()
    }

    @objc func zoomIn() {
        guard let web = webView else { return }
        web.magnification += 0.1
    }

    @objc func zoomOut() {
        guard let web = webView else { return }
        web.magnification = max(0.5, web.magnification - 0.1)
    }

    @objc func resetZoom() {
        webView?.magnification = 1.0
    }

    @objc func openInBrowser() {
        NSWorkspace.shared.open(serverURL)
    }

    @objc func showAbout() {
        let alert = NSAlert()
        alert.messageText = "DeepSeek Harness Desktop"
        alert.informativeText = "Native macOS client for DeepSeek Harness (DSH).\nVersion 0.1.0\n\nBuilt for high-performance agentic engineering."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    @objc func showPreferences() {
        webView?.evaluateJavaScript("window.location.hash = '#settings'", completionHandler: nil)
    }

    @objc func takeUiScreenshot() {
        guard let window = self.window else { return }
        let cgImage = CGWindowListCreateImage(window.frame, .optionIncludingWindow, CGWindowID(window.windowNumber), [.nominalResolution])
        if let cgImage = cgImage {
            let bitmapRep = NSBitmapImageRep(cgImage: cgImage)
            if let pngData = bitmapRep.representation(using: .png, properties: [:]) {
                let outPath = "/tmp/dsh_ui_audit.png"
                try? pngData.write(to: URL(fileURLWithPath: outPath))
                let alert = NSAlert()
                alert.messageText = "Screenshot Captured"
                alert.informativeText = "UI screenshot saved to \(outPath)"
                alert.runModal()
            }
        }
    }

    func showErrorAlert(message: String) {
        let alert = NSAlert()
        alert.messageText = "Connection Error"
        alert.informativeText = message
        alert.alertStyle = .critical
        alert.addButton(withTitle: "Retry")
        alert.addButton(withTitle: "Quit")
        if alert.runModal() == .alertFirstButtonReturn {
            ensureServerAndLoad()
        } else {
            NSApp.terminate(nil)
        }
    }

    // MARK: - Main Menu Builder

    func setupMainMenu() {
        let mainMenu = NSMenu()

        // Application Menu
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About DeepSeek Harness", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Preferences...", action: #selector(showPreferences), keyEquivalent: ",")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Hide DeepSeek Harness", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit DeepSeek Harness", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // File Menu
        let fileMenuItem = NSMenuItem()
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "New Session", action: #selector(newSession), keyEquivalent: "n")
        fileMenu.addItem(NSMenuItem.separator())
        fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileMenuItem.submenu = fileMenu
        mainMenu.addItem(fileMenuItem)

        // Edit Menu
        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: #selector(UndoManager.undo), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: #selector(UndoManager.redo), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        // View Menu
        let viewMenuItem = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Reload", action: #selector(reloadPage), keyEquivalent: "r")
        let forceReload = NSMenuItem(title: "Force Reload", action: #selector(forceReloadPage), keyEquivalent: "r")
        forceReload.keyEquivalentModifierMask = [.command, .shift]
        viewMenu.addItem(forceReload)
        viewMenu.addItem(NSMenuItem.separator())
        viewMenu.addItem(withTitle: "Zoom In", action: #selector(zoomIn), keyEquivalent: "=")
        viewMenu.addItem(withTitle: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-")
        viewMenu.addItem(withTitle: "Actual Size", action: #selector(resetZoom), keyEquivalent: "0")
        viewMenu.addItem(NSMenuItem.separator())
        viewMenu.addItem(withTitle: "Toggle Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        viewMenuItem.submenu = viewMenu
        mainMenu.addItem(viewMenuItem)

        // Tools Menu
        let toolsMenuItem = NSMenuItem()
        let toolsMenu = NSMenu(title: "Tools")
        let openBrowserItem = NSMenuItem(title: "Open in Browser", action: #selector(openInBrowser), keyEquivalent: "b")
        openBrowserItem.keyEquivalentModifierMask = [.command, .shift]
        toolsMenu.addItem(openBrowserItem)
        toolsMenu.addItem(NSMenuItem.separator())
        toolsMenu.addItem(withTitle: "Take UI Screenshot (Audit)", action: #selector(takeUiScreenshot), keyEquivalent: "")
        toolsMenuItem.submenu = toolsMenu
        mainMenu.addItem(toolsMenuItem)

        // Window Menu
        let windowMenuItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(NSMenuItem.separator())
        windowMenu.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        windowMenuItem.submenu = windowMenu
        mainMenu.addItem(windowMenuItem)

        NSApp.mainMenu = mainMenu
    }
}
