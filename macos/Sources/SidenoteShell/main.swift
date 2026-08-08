import AppKit
import WebKit

// Sidenote.app — native shell around the Sidenote server.
// Stages the bundled Next.js server into Application Support (the app bundle
// stays sealed/read-only), runs it on the Sidenote Engine (bundled node),
// and shows http://127.0.0.1:4747 in a WKWebView window.

let PORT = 4747
let BASE_URL = URL(string: "http://127.0.0.1:\(PORT)/")!

func log(_ msg: String) {
    let line = "[shell] \(msg)\n"
    FileHandle.standardError.write(line.data(using: .utf8)!)
    // O_APPEND, because the server holds its own handle on this file — a
    // handle with an independent offset would overwrite whatever it wrote.
    let fd = Darwin.open(AppDelegate.logURL.path, O_WRONLY | O_APPEND | O_CREAT, 0o644)
    guard fd >= 0 else { return }
    _ = line.withCString { write(fd, $0, strlen($0)) }
    close(fd)
}

/// Runs a shell command in its own session so it outlives this process.
/// LaunchServices tears our process group down the moment the app quits,
/// which kills an ordinary child mid-relaunch.
@discardableResult
func spawnDetached(_ command: String) -> Bool {
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)
    defer { posix_spawnattr_destroy(&attr) }
    posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETSID))
    var argv: [UnsafeMutablePointer<CChar>?] = ["/bin/sh", "-c", command].map {
        $0.withCString { strdup($0) }
    }
    argv.append(nil)
    defer { argv.forEach { free($0) } }
    var pid: pid_t = 0
    let rc = posix_spawn(&pid, "/bin/sh", nil, &attr, &argv, environ)
    log("detached spawn rc=\(rc) pid=\(pid)")
    return rc == 0
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate,
                          WKDownloadDelegate, WKScriptMessageHandler {
    static let logURL: URL = {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("Sidenote.log")
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        return url
    }()

    var window: NSWindow!
    var webView: WKWebView!
    var spinner: NSProgressIndicator!
    var statusLabel: NSTextField!

    var server: Process?
    var quitting = false
    var respawns: [Date] = []
    var loadedOnce = false

    // MARK: - Launch

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        // The app always comes up first. Asking about relocation with a bare
        // modal at launch proved unreliable — from a translocated copy it can
        // fail to present and either answer itself or hang with no window at
        // all. A sheet on a real window can only be answered by a real click,
        // and if it never appears the app is still running and the in-app
        // guide explains the situation.
        start()
        if needsRelocation {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.promptRelocate() }
        }
    }

    func start() {
        buildWindow()
        DispatchQueue.global(qos: .userInitiated).async { self.bootServer() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // Flag before anything else so the termination handler can't win the
        // race and respawn an orphaned server.
        quitting = true
        server?.terminationHandler = nil
        return .terminateNow
    }

    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        server?.terminationHandler = nil
        server?.terminate()
        // Give node a moment to exit cleanly.
        if let s = server, s.isRunning {
            let deadline = Date().addingTimeInterval(2)
            while s.isRunning && Date() < deadline { usleep(50_000) }
        }
    }

    // MARK: - Where the app lives

    // Opened straight from the download, macOS runs the app from a random,
    // read-only AppTranslocation path. Full Disk Access is granted per path,
    // so a grant made there is worthless the moment the app relaunches — the
    // permission simply never sticks. Getting into /Applications first is the
    // difference between the FDA flow working and quietly failing forever.
    typealias IsTranslocatedFn = @convention(c) (
        CFURL, UnsafeMutablePointer<DarwinBoolean>, UnsafeMutablePointer<Unmanaged<CFError>?>?
    ) -> Bool
    typealias OriginalPathFn = @convention(c) (
        CFURL, UnsafeMutablePointer<Unmanaged<CFError>?>?
    ) -> Unmanaged<CFURL>?

    static let securityHandle = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_LAZY)

    var isTranslocated: Bool {
        guard let sym = dlsym(Self.securityHandle, "SecTranslocateIsTranslocatedURL") else {
            return Bundle.main.bundleURL.path.contains("/AppTranslocation/")
        }
        let fn = unsafeBitCast(sym, to: IsTranslocatedFn.self)
        var flag: DarwinBoolean = false
        guard fn(Bundle.main.bundleURL as CFURL, &flag, nil) else {
            return Bundle.main.bundleURL.path.contains("/AppTranslocation/")
        }
        return flag.boolValue
    }

    // The real on-disk location, seeing through translocation.
    var trueBundleURL: URL {
        guard isTranslocated, let sym = dlsym(Self.securityHandle, "SecTranslocateCreateOriginalPathForURL") else {
            return Bundle.main.bundleURL
        }
        let fn = unsafeBitCast(sym, to: OriginalPathFn.self)
        guard let out = fn(Bundle.main.bundleURL as CFURL, nil) else { return Bundle.main.bundleURL }
        return out.takeRetainedValue() as URL
    }

    var applicationsDirs: [String] {
        ["/Applications", NSHomeDirectory() + "/Applications"]
    }

    var livesInApplications: Bool {
        let path = trueBundleURL.deletingLastPathComponent().path
        return applicationsDirs.contains(path)
    }

    var needsRelocation: Bool { isTranslocated || !livesInApplications }

    /// Asks whether to move into /Applications, then either relocates and
    /// relaunches from there, or carries on from where the app sits today.
    func promptRelocate() {
        let translocated = isTranslocated
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.icon = NSApp.applicationIconImage
        if translocated {
            alert.messageText = "Move Sidenote to your Applications folder"
            alert.informativeText = """
                macOS is running Sidenote from a temporary read-only copy because it was opened \
                straight from the download. Full Disk Access can't stick to a temporary copy, so \
                Sidenote wouldn't be able to read your Messages.

                Moving it to Applications takes a second and fixes this for good.
                """
        } else {
            alert.messageText = "Keep Sidenote in your Applications folder?"
            alert.informativeText = """
                Sidenote is running from \(trueBundleURL.deletingLastPathComponent().path). \
                Full Disk Access is granted per location, so if you move Sidenote later you'd \
                have to grant it again. Applications is the safe home.
                """
        }
        alert.addButton(withTitle: "Move to Applications")
        alert.addButton(withTitle: translocated ? "Open Anyway" : "Not Now")
        NSApp.activate(ignoringOtherApps: true)
        alert.beginSheetModal(for: window) { [weak self] answer in
            guard let self else { return }
            guard answer == .alertFirstButtonReturn else {
                log("user declined the move")
                return
            }
            self.performMove()
        }
    }

    func performMove() {
        do {
            let moved = try moveToApplications()
            // Hand the relaunch to a detached `open` that waits for us to go:
            // LaunchServices won't start a second instance of the same bundle
            // id while this one is alive, so launching from inside our own
            // process quietly does nothing.
            log("relaunching from \(moved.path)")
            // `open` resolves through LaunchServices, which has not seen the
            // bundle we just created — so register it, then keep trying until
            // a process is actually running from the new location.
            let lsregister = "/System/Library/Frameworks/CoreServices.framework"
                + "/Frameworks/LaunchServices.framework/Support/lsregister"
            let exe = moved.appendingPathComponent("Contents/MacOS/Sidenote").path
            // While translocated we can't trash the download we're executing
            // from — the read-only mirror is backed by it. Once this process is
            // gone the mirror is released, so the detached script does it, and
            // Downloads stops collecting "Sidenote 2.app", "Sidenote 3.app".
            let leftover = isTranslocated ? trueBundleURL.path : ""
            let stamp = Int(Date().timeIntervalSince1970)
            let relaunched = spawnDetached("""
                while /bin/kill -0 \(getpid()) 2>/dev/null; do /bin/sleep 0.1; done
                /bin/sleep 1
                if [ -n "\(leftover)" ] && [ -d "\(leftover)" ]; then
                  /bin/mv -f "\(leftover)" "$HOME/.Trash/Sidenote-\(stamp).app" 2>/dev/null
                fi
                "\(lsregister)" -f "\(moved.path)" 2>/dev/null
                for i in 1 2 3 4 5 6 7 8 9 10; do
                  /usr/bin/open "\(moved.path)" 2>/dev/null
                  /bin/sleep 1
                  if /usr/bin/pgrep -f "\(exe)" >/dev/null 2>&1; then exit 0; fi
                done
                /usr/bin/open -R "\(moved.path)"
                """)
            if !relaunched {
                // Leave the user somewhere useful rather than with a vanished app.
                NSWorkspace.shared.activateFileViewerSelecting([moved])
            }
            NSApp.terminate(nil)
        } catch {
            // The app is already running from where it sits, so this is a
            // note, not a dead end.
            log("move failed: \(error.localizedDescription)")
            let failed = NSAlert()
            failed.alertStyle = .warning
            failed.messageText = "Couldn't move Sidenote"
            failed.informativeText = """
                \(error.localizedDescription)

                Drag Sidenote into your Applications folder yourself, then open it from there.
                """
            failed.addButton(withTitle: "OK")
            failed.beginSheetModal(for: window)
        }
    }

    func moveToApplications() throws -> URL {
        let fm = FileManager.default
        let source = trueBundleURL
        let dir = fm.isWritableFile(atPath: "/Applications")
            ? "/Applications"
            : NSHomeDirectory() + "/Applications"
        try fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let dest = URL(fileURLWithPath: dir).appendingPathComponent("Sidenote.app")

        if fm.fileExists(atPath: dest.path) {
            // Replacing an older install: trash it rather than deleting outright.
            _ = try? fm.trashItem(at: dest, resultingItemURL: nil)
            try? fm.removeItem(at: dest)
        }
        try fm.copyItem(at: source, to: dest)

        // Quarantine is what triggers translocation; clearing it on the copy
        // keeps the Applications install at a stable path forever.
        _ = shell("/usr/bin/xattr", ["-dr", "com.apple.quarantine", dest.path])

        // Tidy up the copy the user opened — but never while translocated, as
        // the read-only mirror we're executing from is backed by that file.
        // In that case performMove()'s detached script trashes it after we exit.
        if !isTranslocated {
            _ = try? fm.trashItem(at: source, resultingItemURL: nil)
        }
        trashSiblingCopies(of: source)
        log("moved to \(dest.path)")
        return dest
    }

    /// Downloading Sidenote again doesn't overwrite the previous download —
    /// macOS renames it "Sidenote 2.app", "Sidenote 3.app", and they pile up in
    /// Downloads. Once we've installed into Applications, the copies sitting
    /// beside the one you opened are strictly garbage, so trash them. Only
    /// bundles that really are Sidenote are touched, and trashing is
    /// recoverable — nothing is deleted outright.
    func trashSiblingCopies(of source: URL) {
        let fm = FileManager.default
        let folder = source.deletingLastPathComponent()
        guard applicationsDirs.contains(folder.path) == false else { return }
        let entries = (try? fm.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: nil)) ?? []
        for entry in entries where entry.pathExtension == "app" {
            guard entry.path != source.path,
                  entry.lastPathComponent.hasPrefix("Sidenote"),
                  Bundle(url: entry)?.bundleIdentifier == Bundle.main.bundleIdentifier
            else { continue }
            if (try? fm.trashItem(at: entry, resultingItemURL: nil)) != nil {
                log("trashed leftover copy at \(entry.path)")
            }
        }
    }

    // MARK: - Window

    func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 840),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "Sidenote"
        window.minSize = NSSize(width: 760, height: 500)
        window.setFrameAutosaveName("SidenoteMain")
        window.center()

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.isElementFullscreenEnabled = true
        // WebKit won't hand a pasted screenshot to a plain text input through
        // clipboardData, so Cmd-V looked broken in the AI chat. The page asks
        // us for it instead and we read NSPasteboard directly.
        config.userContentController.add(self, name: "clipboardImage")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsMagnification = true
        webView.isHidden = true

        let content = NSView()
        webView.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(webView)

        spinner = NSProgressIndicator()
        spinner.style = .spinning
        spinner.controlSize = .regular
        spinner.startAnimation(nil)
        spinner.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(spinner)

        statusLabel = NSTextField(labelWithString: "Starting Sidenote…")
        statusLabel.font = .systemFont(ofSize: 13)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.alignment = .center
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: content.topAnchor),
            webView.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            spinner.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: content.centerYAnchor, constant: -20),
            statusLabel.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            statusLabel.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 14),
        ])

        window.contentView = content
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func setStatus(_ text: String) {
        DispatchQueue.main.async { self.statusLabel.stringValue = text }
    }

    // MARK: - Server lifecycle

    var resources: URL { Bundle.main.resourceURL! }
    var engineURL: URL {
        Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/Sidenote Engine")
    }
    var buildTag: String {
        (Bundle.main.infoDictionary?["SidenoteCommit"] as? String).map { String($0.prefix(12)) } ?? "dev"
    }
    var stagedServerURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Sidenote/server-\(buildTag)")
    }

    func bootServer() {
        retireLaunchAgent()
        if !serverIsUp() {
            do {
                try stageServer()
            } catch {
                fail("Couldn't set up the Sidenote server: \(error.localizedDescription)")
                return
            }
            clearPort()
            spawnServer()
        }
        setStatus("Waking up the engine…")
        let deadline = Date().addingTimeInterval(90)
        while Date() < deadline {
            if serverIsUp() {
                DispatchQueue.main.async { self.webView.load(URLRequest(url: BASE_URL)) }
                return
            }
            usleep(300_000)
        }
        fail("The Sidenote server didn't start. Details are in ~/Library/Logs/Sidenote.log")
    }

    // The pre-app installer ran Sidenote through launchd from ~/Sidenote.
    // The app owns the port now, so retire that agent once and for all.
    func retireLaunchAgent() {
        let plist = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/lol.sidenote.app.plist")
        guard FileManager.default.fileExists(atPath: plist.path) else { return }
        log("retiring old launch agent")
        _ = shell("/bin/launchctl", ["bootout", "gui/\(getuid())/lol.sidenote.app"])
        try? FileManager.default.removeItem(at: plist)
    }

    func clearPort() {
        let out = shell("/usr/sbin/lsof", ["-ti", ":\(PORT)"])
        for pid in out.split(separator: "\n").compactMap({ Int32($0.trimmingCharacters(in: .whitespaces)) }) {
            log("killing stale process \(pid) on port \(PORT)")
            kill(pid, SIGTERM)
        }
        if !out.isEmpty { usleep(500_000) }
    }

    // Copy the bundled server tree to Application Support so the signed app
    // bundle is never written to (Next needs a writable .next/cache).
    func stageServer() throws {
        let fm = FileManager.default
        let target = stagedServerURL
        let marker = target.appendingPathComponent(".staged")
        if fm.fileExists(atPath: marker.path) { return }
        setStatus("Setting up Sidenote…")
        let parent = target.deletingLastPathComponent()
        try fm.createDirectory(at: parent, withIntermediateDirectories: true)
        // Sweep older builds.
        for entry in (try? fm.contentsOfDirectory(at: parent, includingPropertiesForKeys: nil)) ?? []
        where entry.lastPathComponent.hasPrefix("server-") {
            try? fm.removeItem(at: entry)
        }
        let source = resources.appendingPathComponent("server")
        let tmp = parent.appendingPathComponent("server-staging")
        try? fm.removeItem(at: tmp)
        try fm.copyItem(at: source, to: tmp)
        try fm.moveItem(at: tmp, to: target)
        fm.createFile(atPath: marker.path, contents: Data())
        log("staged server \(buildTag)")
    }

    func spawnServer() {
        let p = Process()
        p.executableURL = engineURL
        p.arguments = [stagedServerURL.appendingPathComponent("server.js").path]
        p.currentDirectoryURL = stagedServerURL
        var env = ProcessInfo.processInfo.environment
        env["PORT"] = String(PORT)
        env["HOSTNAME"] = "127.0.0.1"
        env["NODE_ENV"] = "production"
        env["SIDENOTE_APP"] = "1"
        // Identifies this app to the AI relay on sidenote.lol. It ships inside a
        // downloadable binary, so it is a speed bump against casual abuse — the
        // relay's rate limit is what actually bounds the damage.
        env["SIDENOTE_CLIENT_SECRET"] = "sn_9b9e9cbecf3af566bc479abdc60259e7"
        // PostHog project key. Public by design — it only permits writing
        // events, which is why it can ship inside the app at all.
        env["POSTHOG_KEY"] = "phc_nHSTwtG8aoUuMsoSXbrFnB6xuCQCViuvddJStzdcgjZT"
        // The bundle is what macOS lists under Full Disk Access — the UI needs
        // its real path, not the node binary buried inside it.
        env["SIDENOTE_APP_PATH"] = trueBundleURL.path
        if isTranslocated { env["SIDENOTE_TRANSLOCATED"] = "1" }
        if let commit = Bundle.main.infoDictionary?["SidenoteCommit"] as? String {
            env["SIDENOTE_COMMIT"] = commit
        }
        if let date = Bundle.main.infoDictionary?["SidenoteCommitDate"] as? String {
            env["SIDENOTE_COMMIT_DATE"] = date
        }
        p.environment = env
        let fd = Darwin.open(Self.logURL.path, O_WRONLY | O_APPEND | O_CREAT, 0o644)
        if fd >= 0 {
            let h = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
            p.standardOutput = h
            p.standardError = h
        }
        p.terminationHandler = { [weak self] proc in
            guard let self, !self.quitting else { return }
            log("server exited (\(proc.terminationStatus)) — respawning")
            self.respawns = self.respawns.filter { $0.timeIntervalSinceNow > -30 }
            self.respawns.append(Date())
            if self.respawns.count > 5 {
                DispatchQueue.main.async {
                    self.fail("The Sidenote server keeps crashing. Details are in ~/Library/Logs/Sidenote.log")
                }
                return
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.4) {
                self.spawnServer()
                // The FDA flow restarts the server on purpose; reload once it's back.
                let deadline = Date().addingTimeInterval(30)
                while Date() < deadline {
                    if self.serverIsUp() {
                        DispatchQueue.main.async { self.webView.reload() }
                        return
                    }
                    usleep(300_000)
                }
            }
        }
        do {
            try p.run()
            server = p
            log("server spawned (pid \(p.processIdentifier))")
        } catch {
            fail("Couldn't start the Sidenote engine: \(error.localizedDescription)")
        }
    }

    func serverIsUp() -> Bool {
        var ok = false
        let sem = DispatchSemaphore(value: 0)
        var req = URLRequest(url: BASE_URL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2)
        req.httpMethod = "HEAD"
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            ok = (resp as? HTTPURLResponse) != nil
            sem.signal()
        }.resume()
        sem.wait()
        return ok
    }

    func fail(_ message: String) {
        DispatchQueue.main.async {
            self.spinner.stopAnimation(nil)
            self.statusLabel.stringValue = message
            let alert = NSAlert()
            alert.messageText = "Sidenote couldn't start"
            alert.informativeText = message
            alert.addButton(withTitle: "Show Log")
            alert.addButton(withTitle: "Quit")
            if alert.runModal() == .alertFirstButtonReturn {
                NSWorkspace.shared.activateFileViewerSelecting([Self.logURL])
            }
            NSApp.terminate(nil)
        }
    }

    @discardableResult
    func shell(_ cmd: String, _ args: [String]) -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: cmd)
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        try? p.run()
        p.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8) ?? ""
    }

    // MARK: - Navigation

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if !loadedOnce {
            loadedOnce = true
            spinner.stopAnimation(nil)
            spinner.isHidden = true
            statusLabel.isHidden = true
            webView.isHidden = false
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        if let url = navigationAction.request.url, let scheme = url.scheme?.lowercased(),
           ["http", "https"].contains(scheme),
           !["127.0.0.1", "localhost"].contains(url.host?.lowercased() ?? "") {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // Links with target=_blank open in the user's browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    // MARK: - Downloads (transcript export)

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let downloads = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads")
        var dest = downloads.appendingPathComponent(suggestedFilename)
        let base = dest.deletingPathExtension().lastPathComponent
        let ext = dest.pathExtension
        var n = 2
        while FileManager.default.fileExists(atPath: dest.path) {
            dest = downloads.appendingPathComponent("\(base) \(n)\(ext.isEmpty ? "" : ".\(ext)")")
            n += 1
        }
        lastDownload = dest
        completionHandler(dest)
    }

    var lastDownload: URL?

    func downloadDidFinish(_ download: WKDownload) {
        if let url = lastDownload {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        }
    }

    // MARK: - Menu

    // MARK: - Clipboard bridge

    /// The page calls this when a paste arrived without an image attached.
    /// Reads the screenshot straight off NSPasteboard and hands it back as a
    /// data URL, which is the only path that works reliably in WKWebView.
    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "clipboardImage" else { return }
        let board = NSPasteboard.general
        var png: Data?
        if let data = board.data(forType: .png) {
            png = data
        } else if let tiff = board.data(forType: .tiff),
                  let rep = NSBitmapImageRep(data: tiff) {
            png = rep.representation(using: .png, properties: [:])
        }
        guard let png else {
            webView.evaluateJavaScript("window.__sidenoteClipboardImage&&window.__sidenoteClipboardImage(null)")
            return
        }
        let url = "data:image/png;base64," + png.base64EncodedString()
        let escaped = url.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        webView.evaluateJavaScript(
            "window.__sidenoteClipboardImage&&window.__sidenoteClipboardImage(\"\(escaped)\")")
    }

    func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "About Sidenote",
                        action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Sidenote", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Sidenote", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        editItem.submenu = edit
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let view = NSMenu(title: "View")
        viewItem.submenu = view
        view.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")

        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let win = NSMenu(title: "Window")
        windowItem.submenu = win
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        NSApp.windowsMenu = win

        NSApp.mainMenu = main
    }

    @objc func reload() { webView.reload() }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
