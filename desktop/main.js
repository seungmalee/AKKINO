// AKKINO desktop: runs the bundled web app in its own window, fully offline.
// Pages are served from a private akkino:// origin so saved data (localStorage)
// stays put between launches and app updates.
const { app, BrowserWindow, net, protocol, screen, shell } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

const APP_DIR = path.join(__dirname, "app");
const START_URL = "akkino://app/index.html";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "akkino",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

function serveAppFile(request) {
  const { pathname } = new URL(request.url);
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
  const file = path.normalize(path.join(APP_DIR, relative));
  if (!file.startsWith(APP_DIR + path.sep)) {
    return new Response("Not found", { status: 404 });
  }
  return net.fetch(pathToFileURL(file).toString());
}

// Default window matches a phone screen (iPhone 14/15: 390x844 points),
// shrunk to fit shorter displays. Users can still resize it.
const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;

function createWindow() {
  const { height: workHeight } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: PHONE_WIDTH,
    height: Math.min(PHONE_HEIGHT, workHeight - 40),
    useContentSize: true,
    center: true,
    minWidth: 320,
    minHeight: 480,
    title: "AKKINO",
    icon: path.join(__dirname, "build", "icon.ico"),
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Never navigate away from the app; open outside links in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("akkino://app/")) event.preventDefault();
  });

  win.loadURL(START_URL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle("akkino", serveAppFile);
    createWindow();
  });

  app.on("window-all-closed", () => app.quit());
}
