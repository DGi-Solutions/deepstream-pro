import QtQuick
import Konvergo 1.0
import QtWebEngine
import QtWebChannel
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Dialogs as Dialogs
import Qt.labs.platform as Labs

Window
{
  id: mainWindow
  title: Qt.application.name === "DeepStream Pro" ? "DeepStream Pro" : "Jellyfin Desktop"
  objectName: "mainWindow"
  width: 1280
  height: 720
  minimumWidth: 213
  minimumHeight: 120
  visible: true
  color: "#000000"

  // Properties previously from KonvergoWindow
  property bool webDesktopMode: true
  property bool showDebugLayer: false
  property string debugInfo: ""
  property string videoInfo: ""
  property string webUrl: ""

  property bool showSystemTrayIcon: webDesktopMode && components.system.isWindows &&
                                    components.settings.windowsTrayIcon

  signal reloadWebClient()

  // Local-file flow. This uses the existing player rather
  // than starting a second decoder beside a Jellyfin session.
  // Local-file playback remains under development for the next release.
  readonly property bool localMediaEnabled: false
  property bool localMediaActive: false
  property bool localMediaPaused: false
  property string localMediaError: ""
  property string localTrackFingerprint: ""
  property string localSubtitleDialogToken: ""
  property string localDropToken: ""

  LocalMediaController {
    id: localMediaController
    onInvalidated: {
      mainWindow.localMediaActive = false
      components.player.setVideoOnlyMode(false)
    }
    onStartupFailed: cancelled => mainWindow.handleLocalStartupFailure(cancelled)
  }
  ListModel { id: localAudioTracks }
  ListModel { id: localSubtitleTracks }

  function closeLocalMedia() {
    if (!localMediaActive) return
    if (!localMediaController.close()) {
      localMediaError = qsTr("Die Wiedergabe konnte noch nicht sicher beendet werden.")
      return
    }
    localMediaActive = false
    components.player.setVideoOnlyMode(false)
  }

  function handleLocalStartupFailure(cancelled) {
    localMediaError = qsTr("Die Datei konnte nicht wiedergegeben werden.")
    if (!cancelled) return
    localMediaActive = false
    components.player.setVideoOnlyMode(false)
  }

  function openLocalMedia(fileUrl) {
    if (!localMediaEnabled) return false
    const localUrl = String(fileUrl)
    if (!localUrl.toLowerCase().startsWith("file://")) {
      localMediaError = qsTr("Die Datei konnte nicht geöffnet werden.")
      return false
    }
    const accepted = localMediaController.open(fileUrl)
    if (!accepted) {
      localMediaError = qsTr("Die Datei konnte nicht geöffnet werden.")
      return false
    }
    localMediaError = ""
    localMediaPaused = false
    localMediaActive = true
    localTrackFingerprint = ""
    localAudioTracks.clear()
    localSubtitleTracks.clear()
    components.player.setVideoOnlyMode(true)
    return true
  }

  function openLocalSubtitleDialog() {
    if (!localMediaEnabled) return false
    const token = localMediaController.subtitleDialogToken()
    if (token === "") return false
    localSubtitleDialogToken = token
    localSubtitleDialog.open()
    return true
  }

  function acceptLocalSubtitle(fileUrl) {
    if (!localMediaEnabled) return false
    const token = localSubtitleDialogToken
    localSubtitleDialogToken = ""
    if (!localMediaController.addSubtitleFile(fileUrl, token)) {
      localMediaError = qsTr("Die Untertiteldatei konnte nicht geöffnet werden.")
      return false
    }
    return true
  }

  function revealLocalControl(control) {
    const left = control.mapToItem(localMediaScroll.contentItem, 0, 0).x
    const right = left + control.width
    const viewLeft = localMediaScroll.contentX
    const viewRight = viewLeft + localMediaScroll.width
    let target = viewLeft
    if (left < viewLeft || control.width > localMediaScroll.width) target = left
    else if (right > viewRight) target = right - localMediaScroll.width
    localMediaScroll.contentX = Math.max(0, Math.min(target,
      Math.max(0, localMediaScroll.contentWidth - localMediaScroll.width)))
  }

  function localDropFile(event) {
    if (!localMediaEnabled) return null
    if (!event || !event.hasUrls || event.urls.length !== 1 ||
        !(event.supportedActions & Qt.CopyAction)) return null
    const url = event.urls[0]
    return localMediaController.canDropFile(url) ? url : null
  }

  function beginLocalDrop(event) {
    event.accepted = false
    localDropToken = ""
    if (localDropFile(event) === null) return false
    const token = localMediaController.dropInteractionToken()
    if (token === "") return false
    localDropToken = token
    event.accept(Qt.CopyAction)
    return true
  }

  function finishLocalDrop(event) {
    event.accepted = false
    const token = localDropToken
    localDropToken = ""
    if (token === "" || token !== localMediaController.dropInteractionToken()) return false
    const url = localDropFile(event)
    if (url === null || !openLocalMedia(url)) return false
    event.accept(Qt.CopyAction)
    return true
  }

  DropArea {
    id: localMediaDropArea
    enabled: mainWindow.localMediaEnabled
    anchors.fill: parent
    z: 150
    onEntered: drag => mainWindow.beginLocalDrop(drag)
    onExited: mainWindow.localDropToken = ""
    onDropped: drop => mainWindow.finishLocalDrop(drop)
  }

  Dialogs.FileDialog {
    id: localMediaDialog
    title: qsTr("Mediendatei öffnen")
    fileMode: Dialogs.FileDialog.OpenFile
    onAccepted: mainWindow.openLocalMedia(selectedFile)
  }

  Dialogs.FileDialog {
    id: localSubtitleDialog
    title: qsTr("Untertiteldatei öffnen")
    fileMode: Dialogs.FileDialog.OpenFile
    nameFilters: [qsTr("Untertiteldateien (*.srt *.vtt *.ass *.ssa *.sub *.sup)"),
                  qsTr("Alle Dateien (*)")]
    onAccepted: mainWindow.acceptLocalSubtitle(selectedFile)
    onRejected: mainWindow.localSubtitleDialogToken = ""
  }

  Labs.MenuBar {
    window: mainWindow
    Labs.Menu {
      visible: mainWindow.localMediaEnabled
      enabled: mainWindow.localMediaEnabled
      title: qsTr("Datei")
      Labs.MenuItem {
        text: qsTr("Datei öffnen …")
        enabled: mainWindow.localMediaEnabled
        shortcut: StandardKey.Open
        onTriggered: localMediaDialog.open()
      }
    }
  }

  Rectangle {
    id: localMediaControls
    z: 200
    visible: mainWindow.localMediaEnabled && mainWindow.localMediaActive
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    height: Math.max(72, localControlsRow.implicitHeight + 28)
    color: "#dd181818"
    Flickable {
      id: localMediaScroll
      anchors.fill: parent
      contentWidth: localControlsRow.implicitWidth + 20
      contentHeight: height
      flickableDirection: Flickable.HorizontalFlick
      boundsBehavior: Flickable.StopAtBounds
      clip: true
      ScrollBar.horizontal: ScrollBar {
        policy: ScrollBar.AlwaysOn
        interactive: true
        Accessible.name: qsTr("Wiedergabesteuerung verschieben")
      }
      Row {
        id: localControlsRow
        x: 10
        y: 8
        spacing: 10
        Button {
        id: localMediaPause
        text: mainWindow.localMediaPaused ? qsTr("Fortsetzen") : qsTr("Pause")
        onActiveFocusChanged: if (activeFocus) mainWindow.revealLocalControl(localMediaPause)
        onClicked: {
          if (mainWindow.localMediaPaused) localMediaController.play()
          else localMediaController.pause()
        }
      }
      Slider {
        id: localMediaSeek
        width: Math.max(100, localMediaControls.width - 800)
        from: 0
        to: 1
        Accessible.name: qsTr("Wiedergabeposition")
        onActiveFocusChanged: if (activeFocus) mainWindow.revealLocalControl(localMediaSeek)
        onMoved: localMediaController.seek(Math.round(value))
      }
      Slider {
        id: localMediaVolume
        width: 100
        from: 0
        to: 100
        value: 100
        Accessible.name: qsTr("Lautstärke")
        onActiveFocusChanged: if (activeFocus) mainWindow.revealLocalControl(localMediaVolume)
        onMoved: localMediaController.volume(Math.round(value))
      }
      ComboBox {
        id: localAudioSelect
        width: 120
        model: localAudioTracks
        textRole: "label"
        enabled: count > 0
        onActivated: index => localMediaController.selectTrack("audio", localAudioTracks.get(index).trackId)
        Accessible.name: qsTr("Tonspur")
        onActiveFocusChanged: if (activeFocus) mainWindow.revealLocalControl(localAudioSelect)
      }
      ComboBox {
        id: localSubtitleSelect
        width: 120
        model: localSubtitleTracks
        textRole: "label"
        enabled: count > 0
        onActivated: index => localMediaController.selectTrack("sub", localSubtitleTracks.get(index).trackId)
        Accessible.name: qsTr("Untertitel")
        onActiveFocusChanged: if (activeFocus) mainWindow.revealLocalControl(localSubtitleSelect)
      }
      Button {
        id: localSubtitleOpen
        text: qsTr("Untertitel öffnen")
        onActiveFocusChanged: if (activeFocus) mainWindow.revealLocalControl(localSubtitleOpen)
        onClicked: mainWindow.openLocalSubtitleDialog()
      }
      Button {
        id: localFileOpen
        text: qsTr("Datei öffnen")
        onActiveFocusChanged: if (activeFocus) mainWindow.revealLocalControl(localFileOpen)
        onClicked: localMediaDialog.open()
      }
      Button {
        id: localMediaClose
        text: qsTr("Schließen")
        onActiveFocusChanged: if (activeFocus) mainWindow.revealLocalControl(localMediaClose)
        onClicked: mainWindow.closeLocalMedia()
      }
      }
    }
    Timer {
      interval: 500
      repeat: true
      running: mainWindow.localMediaActive
      onTriggered: {
        const current = localMediaController.state()
        if (!current.active || !current.ready) return
        localMediaSeek.to = Math.max(1, current.duration)
        if (!localMediaSeek.pressed) localMediaSeek.value = current.position
        if (!localMediaVolume.pressed) localMediaVolume.value = current.volume
        mainWindow.localMediaPaused = current.paused
        const fingerprint = JSON.stringify(current.tracks)
        if (fingerprint !== mainWindow.localTrackFingerprint) {
          mainWindow.localTrackFingerprint = fingerprint
          localAudioTracks.clear()
          localSubtitleTracks.clear()
          localSubtitleTracks.append({label: qsTr("Aus"), trackId: -1})
          let selectedAudio = -1
          let selectedSubtitle = 0
          for (const track of current.tracks) {
            const label = (track.language || qsTr("Unbekannt")) + " · " + (track.codec || qsTr("Spur")) + " #" + track.id
            if (track.type === "audio") {
              localAudioTracks.append({label: label, trackId: track.id})
              if (track.selected) selectedAudio = localAudioTracks.count - 1
            } else if (track.type === "sub") {
              localSubtitleTracks.append({label: label, trackId: track.id})
              if (track.selected) selectedSubtitle = localSubtitleTracks.count - 1
            }
          }
          localAudioSelect.currentIndex = selectedAudio
          localSubtitleSelect.currentIndex = selectedSubtitle
        }
      }
    }
  }

  Rectangle {
    z: 201
    visible: mainWindow.localMediaError !== ""
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.top: parent.top
    anchors.topMargin: 20
    width: localErrorText.implicitWidth + 80
    height: localErrorText.implicitHeight + 24
    radius: 7
    color: "#dd242424"
    Text { id: localErrorText; anchors.centerIn: parent; color: "white"; text: mainWindow.localMediaError }
    MouseArea { anchors.fill: parent; onClicked: mainWindow.localMediaError = "" }
  }

  Component.onCompleted: {
    if (components && components.settings) {
      webUrl = components.settings.getWebClientUrl(webDesktopMode)
    }
  }

  onClosing: function(close) {
    if (showSystemTrayIcon) {
      // Minimize to tray on close.
      close.accepted = false
      mainWindow.hide()
    }
  }

  function toggleFullscreen() {
    visibility = (visibility === Window.FullScreen) ? Window.Windowed : Window.FullScreen
  }

  function toggleDebug() {
    showDebugLayer = !showDebugLayer
  }

  function setFullScreen(enable) {
    visibility = enable ? Window.FullScreen : Window.Windowed
  }

  function minimizeWindow() {
    if (visibility !== Window.FullScreen)
      visibility = Window.Minimized
  }

  function restoreWindow() {
    mainWindow.show()
    mainWindow.raise()
    mainWindow.requestActivate()
  }

  function runWebAction(action)
  {
    if (mainWindow.webDesktopMode)
      web.triggerWebAction(action)
  }

  Action
  {
    enabled: mainWindow.webDesktopMode
    shortcut:
    {
      if (components.system.isMacos) return "Ctrl+Meta+F"
      return "F11"
    }
    onTriggered: mainWindow.toggleFullscreen()
  }

  Action
  {
    shortcut: "Alt+Return"
    enabled:
    {
      if (mainWindow.webDesktopMode && components.system.isWindows)
        return true;
      return false;
    }
    onTriggered: mainWindow.toggleFullscreen()
  }

  Action
  {
    enabled:
    {
      if (mainWindow.webDesktopMode
          && mainWindow.visibility === Window.FullScreen
          && components.player.isVideoWindowVisible())
        return true;
      return false;
    }
    shortcut: "Escape"
    onTriggered: components.window.setFullScreen(false)
  }

  Action
  {
    enabled: mainWindow.webDesktopMode
    shortcut: StandardKey.Close
    onTriggered: mainWindow.close()
  }

  Action
  {
    enabled: mainWindow.webDesktopMode
    shortcut: {
      if (components.system.isMacos) return "Ctrl+M";
      return "Meta+Down";
    }
    onTriggered: mainWindow.minimizeWindow()
  }

  Action
  {
    enabled: mainWindow.webDesktopMode
    shortcut: components.system.isWindows ? "Ctrl+Q" : StandardKey.Quit
    onTriggered: Qt.quit()
  }

  Action
  {
    shortcut: "Ctrl+Shift+D"
    enabled: mainWindow.webDesktopMode
    onTriggered: mainWindow.toggleDebug()
  }

  Action
  {
    shortcut: StandardKey.Copy
    onTriggered: runWebAction(WebEngineView.Copy)
    id: action_copy
  }

  Action
  {
    shortcut: StandardKey.Cut
    onTriggered: runWebAction(WebEngineView.Cut)
    id: action_cut
  }

  Action
  {
    shortcut: StandardKey.Paste
    onTriggered: runWebAction(WebEngineView.Paste)
    id: action_paste
  }

  Action
  {
    shortcut: StandardKey.SelectAll
    onTriggered: runWebAction(WebEngineView.SelectAll)
    id: action_selectall
  }

  Action
  {
    shortcut: StandardKey.Undo
    onTriggered: runWebAction(WebEngineView.Undo)
    id: action_undo
  }

  Action
  {
    shortcut: StandardKey.Redo
    onTriggered: runWebAction(WebEngineView.Redo)
    id: action_redo
  }

  Action
  {
    shortcut: StandardKey.Back
    onTriggered: runWebAction(WebEngineView.Back)
    id: action_back
  }

  Action
  {
    shortcut: StandardKey.Forward
    onTriggered: runWebAction(WebEngineView.Forward)
    id: action_forward
  }

  Action
  {
    enabled: mainWindow.webDesktopMode
    shortcut: "Ctrl+0"
    onTriggered: web.zoomFactor = 1.0
  }

  WebChannel
  {
    id: webChannelObject
  }

  Binding
  {
    target: web
    property: "zoomFactor"
    value: 1.0
    when: !components.settings.allowBrowserZoom()
  }

  MpvVideoItem
  {
    id: video
    objectName: "video"
    enabled: true

    width: mainWindow.contentItem.width
    height: mainWindow.contentItem.height
    anchors.left: mainWindow.contentItem.left
    anchors.right: mainWindow.contentItem.right
    anchors.top: mainWindow.contentItem.top

    Component.onCompleted: {
      console.log("MpvVideoItem size:", width, "x", height, "visible:", visible)
    }
    onWidthChanged: console.log("MpvVideoItem width changed:", width)
    onHeightChanged: console.log("MpvVideoItem height changed:", height)
  }

  WebEngineView
  {
    id: web
    objectName: "web"
    property bool nativeHlsMainFrameReady: false
    width: mainWindow.width
    height: mainWindow.height
    z: 100
    backgroundColor: "transparent"

    // this is needed to prevent intermittent(?) black screens when unminizing
    // or resumsing from suspend (linux/{x11/wayland}, possibly others).
    layer.enabled: !components.player.avFixtureVideoActive

    webChannel: webChannelObject
    settings.errorPageEnabled: false
    settings.localContentCanAccessRemoteUrls: true
    settings.localContentCanAccessFileUrls: true
    settings.allowRunningInsecureContent: true
    settings.playbackRequiresUserGesture: false
    profile.httpUserAgent: components.system.getUserAgent()
    profile.httpCacheType: WebEngineProfile.DiskHttpCache
    url: mainWindow.webUrl
    focus: true
    property string currentHoveredUrl: ""
    onLinkHovered: function(hoveredUrl)
    {
      web.currentHoveredUrl = hoveredUrl;
    }
    profile.persistentCookiesPolicy: WebEngineProfile.AllowPersistentCookies
    profile.offTheRecord: false
    profile.storageName: "JellyfinDesktopStorage"

    Component.onCompleted:
    {
      console.log("WebEngineView size:", width, "x", height, "backgroundColor:", backgroundColor)
      forceActiveFocus()
      mainWindow.reloadWebClient.connect(reload)

      // Handle CSP workaround from C++
      components.system.pageContentReady.connect(function(html, finalUrl, hadCSP) {
        if (hadCSP) {
          console.log("CSP workaround: navigating");
          web.url = finalUrl;
        }
      })

      var nativeshell =
      {
        sourceCode: components.system.getNativeShellScript(),
        injectionPoint: WebEngineScript.DocumentCreation,
        worldId: WebEngineScript.MainWorld
      }

      web.profile.userScripts.collection = [ nativeshell ];
    }

    // The cross-origin navigation from the bundled find-webclient page to the server web
    // client moves the view to a new renderer process. Like the user script above, the
    // view's transparent background is not always applied to it (e.g. after connecting
    // manually on first launch): the page is then painted opaque white over the mpv video.
    // Changing the color forces Qt WebEngine to send it to the current renderer again.
    // Chromium only accepts fully opaque or fully transparent background colors (anything
    // else hits a CHECK), so go through opaque black, which is the window color anyway.
    function reapplyTransparentBackground()
    {
      web.backgroundColor = "#000000";
      web.backgroundColor = "transparent";
    }

    onRenderProcessPidChanged: function(pid)
    {
      console.log("Render process changed to", pid, "- re-applying transparent background");
      Qt.callLater(reapplyTransparentBackground);
    }

    onLoadingChanged: function(loadingInfo)
    {
      // we use a timer here to switch to the webview since
      // it take a few moments for the webview to render
      // after it has loaded.
      //
      if (loadingInfo.status == WebEngineView.LoadStartedStatus)
      {
        web.nativeHlsMainFrameReady = false
        if (components.player && components.player.clearNativeAudioSession) components.player.clearNativeAudioSession()
        console.log("WebEngineLoadRequest starting");
      }
      else if (loadingInfo.status == WebEngineView.LoadSucceededStatus)
      {
        web.nativeHlsMainFrameReady = true
        console.log("WebEngineLoadRequest success");
        Qt.callLater(reapplyTransparentBackground);
      }
      else if (loadingInfo.status == WebEngineView.LoadFailedStatus)
      {
        web.nativeHlsMainFrameReady = false
        if (components.player && components.player.clearNativeAudioSession) components.player.clearNativeAudioSession()
        console.log("WebEngineLoadRequest failure, error code: " + loadingInfo.errorCode);
        errorLabel.visible = true
        errorLabel.text = "Error loading client, this is bad and should not happen<br>" +
                          "You can try to <a href='reload'>reload</a> or head to our <a href='http://jellyfin.org'>support page</a><br><br>Actual Error: <pre>" +
                          loadingInfo.errorString + " [" + loadingInfo.errorCode + "]</pre><br><br>" +
                          "Provide the <a target='_blank' href='file://"+ components.system.logFilePath + "'>logfile</a> as well."
      }
    }

    onNewWindowRequested:
    {
      if (request.userInitiated)
      {
        console.log("Opening external URL")
        components.system.openExternalUrl(web.currentHoveredUrl)
      }
    }

    onFullScreenRequested:
    {
      console.log("Request fullscreen: " + request.toggleOn)
      mainWindow.setFullScreen(request.toggleOn)
      request.accept()
    }

    onJavaScriptConsoleMessage: function(level, message, lineNumber, sourceID)
    {
      components.system.jsLog(level, "WebEngine JavaScript console event, line " + lineNumber);
    }

    onCertificateError: function(error)
    {
      console.log("Certificate error code: " + error.error)
      if (components.settings.ignoreSSLErrors()) {
        error.acceptCertificate()
      }
    }
  }

  Text
  {
    id: errorLabel
    z: 5
    anchors.centerIn: parent
    color: "#999999"
    linkColor: "#a85dc3"
    text: "Generic error"
    font.pixelSize: 32
    font.bold: true
    visible: false
    verticalAlignment: Text.AlignVCenter
    textFormat: Text.StyledText
    onLinkActivated:
    {
      if (url == "reload")
      {
        errorLabel.visible = false
        web.reload()
      }
      else
      {
        Qt.openUrlExternally(url)
      }
    }
  }


  Rectangle
  {
    id: debug
    color: "black"
    z: 10
    anchors.centerIn: parent
    width: parent.width
    height: parent.height
    opacity: 0.7
    visible: mainWindow.showDebugLayer

    Text
    {
      id: debugLabel
      width: (parent.width - 50) / 2
      height: parent.height - 25
      anchors.left: parent.left
      anchors.leftMargin: 64
      anchors.top: parent.top
      anchors.topMargin: 54
      anchors.bottomMargin: 54
      color: "white"
      font.pixelSize: Math.round(height / 65)
      wrapMode: Text.WrapAnywhere

      function windowDebug()
      {
        var dbg = mainWindow.debugInfo + "Window and web\n";
        dbg += "  Window size: " + parent.width + "x" + parent.height + " - " + web.width + "x" + web.height + "\n";
        dbg += "  DevicePixel ratio: " + Screen.devicePixelRatio + "\n";

        return dbg;
      }

      text: windowDebug()
    }

    Text
    {
      id: videoLabel
      width: (parent.width - 50) / 2
      height: parent.height - 25
      anchors.right: parent.right
      anchors.left: debugLabel.right
      anchors.rightMargin: 64
      anchors.top: parent.top
      anchors.topMargin: 54
      anchors.bottomMargin: 54
      color: "white"
      font.pixelSize: Math.round(height / 65)
      wrapMode: Text.WrapAnywhere

      text: mainWindow.videoInfo
    }
  }

  property QtObject webChannel: web.webChannel

  Labs.SystemTrayIcon {
    visible: showSystemTrayIcon
    icon.source: "qrc:/images/deepstream-pro.png"
    tooltip: mainWindow.title

    onActivated: function(reason) {
      if (reason === Labs.SystemTrayIcon.Context) {
        // Right click: open context menu
        contextMenu.open()
        components.window.setCursorVisibility(true)
      } else {
        // All other clicks: restore window
        restoreWindow()
      }
    }

    menu: Labs.Menu {
      id: contextMenu
      Labs.MenuItem {
        text: qsTr("Restore")
        onTriggered: restoreWindow()
      }
      Labs.MenuSeparator {}
      Labs.MenuItem {
        text: qsTr("Quit")
        onTriggered: Qt.quit()
      }
    }
  }
}
