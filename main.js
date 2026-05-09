const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, execSync, exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

// ── RAM Optimizasyonu (GPU aktif kalmalı — UI donmasını engeller) ──
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=128");
app.commandLine.appendSwitch("disable-dev-shm-usage");

// ── Yönetici kontrolü: admin değilse UAC ile yeniden başlat ──
function isAdmin() {
  try { execSync("net session", { stdio: "pipe", timeout: 3000 }); return true; } catch { return false; }
}

if (!isAdmin()) {
  // Kendini yönetici olarak yeniden başlat
  try {
    const args = process.argv.slice(1).map(a => `"${a}"`).join(" ");
    execSync(`powershell -Command "Start-Process '${process.execPath}' -ArgumentList '${args}' -Verb RunAs"`, { stdio: "pipe" });
  } catch {
    // Kullanıcı UAC'ı reddetti — normal devam et ama uyarı göster
  }
  app.exit(0);
  process.exit(0);
}

const APP_DIR = app.isPackaged ? path.dirname(app.getPath("exe")) : __dirname;
const BIN_DIR = app.isPackaged ? path.join(process.resourcesPath, "bin") : path.join(__dirname, "bin");
const CONFIG_PATH = path.join(app.isPackaged ? app.getPath("userData") : __dirname, "config.json");

let mainWindow = null;
let tray = null;
let gdpiProcess = null;
let isConnected = false;
let originalDNS = {};
let logs = [];
let currentConfig = loadConfig();

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {}
  return null; // null = first run
}

function saveConfig(cfg) {
  currentConfig = cfg;
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
}

const DNS_PROFILES = {
  yandex: { name: "Yandex DNS", primary: "77.88.8.8", secondary: "77.88.8.1", ipv6p: "2a02:6b8::feed:0ff", ipv6s: "2a02:6b8:0:1::feed:0ff" },
  cloudflare: { name: "Cloudflare", primary: "1.1.1.1", secondary: "1.0.0.1", ipv6p: "2606:4700:4700::1111", ipv6s: "2606:4700:4700::1001" },
  google: { name: "Google DNS", primary: "8.8.8.8", secondary: "8.8.4.4", ipv6p: "2001:4860:4860::8888", ipv6s: "2001:4860:4860::8844" },
  quad9: { name: "Quad9", primary: "9.9.9.9", secondary: "149.112.112.112", ipv6p: "2620:fe::fe", ipv6s: "2620:fe::9" },
  adguard: { name: "AdGuard", primary: "94.140.14.14", secondary: "94.140.15.15", ipv6p: "2a10:50c0::ad1:ff", ipv6s: "2a10:50c0::ad2:ff" },
  opendns: { name: "OpenDNS", primary: "208.67.222.222", secondary: "208.67.220.220", ipv6p: "2620:119:35::35", ipv6s: "2620:119:53::53" },
};

const METHODS = {
  "1": { name: "Standart", desc: "Çoğu ISP için — TTL 5 + DNS", args: ["-5", "--set-ttl", "5", "--dns-addr", "{DNS}", "--dns-port", "1253", "--dnsv6-addr", "2a02:6b8::feed:0ff", "--dnsv6-port", "1253"] },
  "2": { name: "Alternatif TTL", desc: "TTL 3 + DNS yönlendirme", args: ["--set-ttl", "3", "--dns-addr", "{DNS}", "--dns-port", "1253", "--dnsv6-addr", "2a02:6b8::feed:0ff", "--dnsv6-port", "1253"] },
  "3": { name: "Superonline", desc: "Fiber hatlar — sadece preset", args: ["-5"] },
  "4": { name: "Superonline+DNS", desc: "Preset + DNS yönlendirme", args: ["-5", "--dns-addr", "{DNS}", "--dns-port", "1253", "--dnsv6-addr", "2a02:6b8::feed:0ff", "--dnsv6-port", "1253"] },
  "5": { name: "Agresif", desc: "En güçlü — -9 + DNS", args: ["-9", "--dns-addr", "{DNS}", "--dns-port", "1253", "--dnsv6-addr", "2a02:6b8::feed:0ff", "--dnsv6-port", "1253"] },
  "6": { name: "Sadece TTL", desc: "Sadece TTL 3", args: ["--set-ttl", "3"] },
  "7": { name: "Sadece -9", desc: "Sadece -9 preset", args: ["-9"] },
};

function addLog(msg, type = "info") {
  const entry = { time: new Date().toLocaleTimeString("tr-TR"), msg, type };
  logs.push(entry);
  if (logs.length > 500) logs.shift();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("log", entry);
}

function sendStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("status", { connected: isConnected, config: currentConfig, binariesOk: checkBinaries().length === 0, missingBinaries: checkBinaries() });
  }
}

async function getActiveAdapters() {
  try {
    const { stdout } = await execAsync('powershell -NoProfile -Command "Get-NetAdapter | Where-Object {$_.Status -eq \'Up\'} | Select-Object -ExpandProperty Name"', { timeout: 10000 });
    const adapters = stdout.trim().split("\n").map(s => s.trim()).filter(Boolean);
    return adapters.length > 0 ? adapters : ["Ethernet"];
  } catch { return ["Ethernet"]; }
}

async function backupDNS(adapters) {
  for (const adapter of adapters) {
    try {
      const { stdout } = await execAsync(`powershell -NoProfile -Command "Get-DnsClientServerAddress -InterfaceAlias '${adapter}' -AddressFamily IPv4 | Select-Object -ExpandProperty ServerAddresses"`, { timeout: 10000 });
      originalDNS[adapter] = stdout.trim().split("\n").map(s => s.trim()).filter(Boolean);
    } catch {}
  }
}

async function setDNS(adapters, dnsProfile) {
  const cmds = [];
  for (const adapter of adapters) {
    cmds.push(execAsync(`netsh interface ip set dns name="${adapter}" static ${dnsProfile.primary}`, { timeout: 10000 }).catch(() => {}));
    cmds.push(execAsync(`netsh interface ip add dns name="${adapter}" ${dnsProfile.secondary} index=2`, { timeout: 10000 }).catch(() => {}));
    if (dnsProfile.ipv6p) {
      cmds.push(execAsync(`netsh interface ipv6 set dns name="${adapter}" static ${dnsProfile.ipv6p}`, { timeout: 10000 }).catch(() => {}));
      cmds.push(execAsync(`netsh interface ipv6 add dns name="${adapter}" ${dnsProfile.ipv6s} index=2`, { timeout: 10000 }).catch(() => {}));
    }
  }
  await Promise.all(cmds);
  for (const adapter of adapters) addLog(`DNS [${adapter}]: ${dnsProfile.primary}`, "success");
}

async function restoreDNS(adapters) {
  const cmds = [];
  for (const adapter of adapters) {
    if (originalDNS[adapter]?.length > 0) {
      cmds.push(execAsync(`netsh interface ip set dns name="${adapter}" static ${originalDNS[adapter][0]}`, { timeout: 10000 }).catch(() => {}));
      if (originalDNS[adapter][1]) cmds.push(execAsync(`netsh interface ip add dns name="${adapter}" ${originalDNS[adapter][1]} index=2`, { timeout: 10000 }).catch(() => {}));
    } else {
      cmds.push(execAsync(`netsh interface ip set dns name="${adapter}" dhcp`, { timeout: 10000 }).catch(() => {}));
    }
    cmds.push(execAsync(`netsh interface ipv6 set dns name="${adapter}" dhcp`, { timeout: 10000 }).catch(() => {}));
  }
  await Promise.all(cmds);
  for (const adapter of adapters) addLog(`DNS [${adapter}] geri yüklendi`, "success");
}

// Windows Secure DNS (DNS over HTTPS) — ISP DNS hijacking'ini tamamen engeller
async function enableSecureDNS(dnsProfile) {
  const DOH_TEMPLATES = {
    "1.1.1.1": "https://cloudflare-dns.com/dns-query",
    "1.0.0.1": "https://cloudflare-dns.com/dns-query",
    "8.8.8.8": "https://dns.google/dns-query",
    "8.8.4.4": "https://dns.google/dns-query",
    "9.9.9.9": "https://dns.quad9.net/dns-query",
    "149.112.112.112": "https://dns.quad9.net/dns-query",
    "94.140.14.14": "https://dns.adguard.com/dns-query",
    "94.140.15.15": "https://dns.adguard.com/dns-query",
  };
  const template = DOH_TEMPLATES[dnsProfile.primary];
  if (!template) return;
  try {
    await Promise.all([
      execAsync(`netsh dns add encryption server=${dnsProfile.primary} dohtemplate=${template} autoupgrade=yes udpfallback=no`, { timeout: 10000 }).catch(() => {}),
      execAsync(`netsh dns add encryption server=${dnsProfile.secondary} dohtemplate=${template} autoupgrade=yes udpfallback=no`, { timeout: 10000 }).catch(() => {}),
    ]);
    addLog("🔒 Secure DNS (DoH) aktif", "success");
  } catch {}
}

function checkBinaries() {
  return ["goodbyedpi.exe", "WinDivert.dll", "WinDivert64.sys"].filter(f => !fs.existsSync(path.join(BIN_DIR, f)));
}

function startEngine() {
  if (gdpiProcess) return false;
  const missing = checkBinaries();
  if (missing.length > 0) { addLog(`Eksik: ${missing.join(", ")}`, "error"); sendStatus(); return false; }

  const method = METHODS[currentConfig.method] || METHODS["1"];
  const dns = DNS_PROFILES[currentConfig.dns] || DNS_PROFILES["yandex"];
  const args = method.args.map(a => a === "{DNS}" ? dns.primary : a);

  const adapter = getActiveAdapters();
  backupDNS(adapter);

  // HER ZAMAN sistem DNS'ini değiştir — Roblox/Discord gibi uygulamalar
  // kendi DNS çözümlemesini yapar, GoodbyeDPI paket yönlendirmesi yetmez
  setDNS(adapter, dns);
  enableSecureDNS(dns);

  // DNS önbelleğini temizle + yeniden kayıt et
  try { execSync("ipconfig /flushdns", { timeout: 5000, stdio: "pipe" }); addLog("DNS önbelleği temizlendi", "info"); } catch {}
  try { execSync("ipconfig /registerdns", { timeout: 5000, stdio: "pipe" }); } catch {}

  addLog(`Motor: ${method.name}`, "info");

  try {
    gdpiProcess = spawn(path.join(BIN_DIR, "goodbyedpi.exe"), args, { cwd: BIN_DIR, windowsHide: true });
    gdpiProcess.stdout.on("data", d => d.toString().split("\n").filter(Boolean).forEach(l => addLog(l.trim(), "engine")));
    gdpiProcess.stderr.on("data", d => d.toString().split("\n").filter(Boolean).forEach(l => addLog(l.trim(), "engine")));
    gdpiProcess.on("error", err => { addLog(`Hata: ${err.message}`, "error"); gdpiProcess = null; isConnected = false; sendStatus(); });
    gdpiProcess.on("close", code => { addLog(`Motor kapandı (${code})`, code === 0 ? "info" : "error"); gdpiProcess = null; isConnected = false; sendStatus(); updateTray(); });

    setTimeout(() => {
      if (gdpiProcess && !gdpiProcess.killed) {
        isConnected = true;
        addLog("✅ DPI Bypass aktif!", "success");
        sendStatus();
        updateTray();
      }
    }, 1500);
    return true;
  } catch (e) { addLog(`Hata: ${e.message}`, "error"); return false; }
}

function stopEngine() {
  if (!gdpiProcess) return;
  try { execSync(`taskkill /PID ${gdpiProcess.pid} /T /F`, { timeout: 5000 }); } catch { try { gdpiProcess.kill(); } catch {} }
  // Yetim process'leri de öldür
  try { execSync("taskkill /F /IM goodbyedpi.exe", { timeout: 5000, stdio: "pipe" }); } catch {}
  if (currentConfig.autoRestore !== false) {
    restoreDNS(getActiveAdapters());
    try { execSync("ipconfig /flushdns", { timeout: 5000, stdio: "pipe" }); } catch {}
    try { execSync("ipconfig /registerdns", { timeout: 5000, stdio: "pipe" }); } catch {}
  }
  gdpiProcess = null;
  isConnected = false;
  addLog("Bypass kapatıldı", "info");
  sendStatus();
  updateTray();
}

async function downloadBinaries() {
  const fetch = require("node-fetch");
  const extractZip = require("extract-zip");
  const url = "https://github.com/cagritaskn/GoodbyeDPI-Turkey/releases/download/release-0.2.3rc3-turkey/goodbyedpi-0.2.3rc3-turkey.zip";
  const tempDir = app.getPath("temp");
  const zipPath = path.join(tempDir, "gdpi-temp.zip");
  const extractDir = path.join(tempDir, "gdpi-temp");
  addLog("İndiriliyor...", "info");
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(zipPath, await res.buffer());
    if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });
    await extractZip(zipPath, { dir: extractDir });
    const x64 = path.join(extractDir, "x86_64");
    const src = fs.existsSync(x64) ? x64 : path.join(extractDir, "x86");
    if (fs.existsSync(src)) fs.readdirSync(src).forEach(f => { fs.copyFileSync(path.join(src, f), path.join(BIN_DIR, f)); addLog(`OK: ${f}`, "success"); });
    try { fs.unlinkSync(zipPath); } catch {} try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
    addLog("✅ Kurulum tamamlandı!", "success");
    sendStatus();
    return true;
  } catch (e) {
    addLog(`İndirme hatası: ${e.message}`, "error");
    try { fs.unlinkSync(zipPath); } catch {} try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
    return false;
  }
}

function setAutoStart(enable) {
  const exePath = process.execPath;
  const appPath = `"${exePath}" "${APP_DIR}"`;
  try {
    if (enable) {
      execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "DPIGuard" /t REG_SZ /d "${appPath}" /f`, { stdio: "pipe" });
    } else {
      execSync(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "DPIGuard" /f`, { stdio: "pipe" });
    }
  } catch {}
}

// IPC
ipcMain.handle("get-status", () => ({ connected: isConnected, config: currentConfig, dnsProfiles: DNS_PROFILES, methods: METHODS, binariesOk: checkBinaries().length === 0, missingBinaries: checkBinaries(), logs: logs.slice(-100), firstRun: currentConfig === null }));
ipcMain.handle("connect", () => startEngine());
ipcMain.handle("disconnect", async () => { await stopEngine(); return true; });
ipcMain.handle("save-config", (_, cfg) => { saveConfig(cfg); return currentConfig; });
ipcMain.handle("download-binaries", () => downloadBinaries());
ipcMain.handle("check-admin", () => { try { execSync("net session", { timeout: 3000, stdio: "pipe" }); return true; } catch { return false; } });
ipcMain.handle("set-autostart", (_, enable) => { setAutoStart(enable); return true; });
ipcMain.handle("open-speedtest", () => { shell.openExternal("https://fast.com"); return true; });
ipcMain.handle("run-speedtest", async () => {
  const fetch = require("node-fetch");
  const send = (phase, value, extra) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("speedtest-progress", { phase, value, ...extra }); };

  try {
    // Sunucu tespiti — Cloudflare İstanbul PoP doğrulama
    let serverLoc = "İstanbul, TR";
    try {
      const probe = await fetch("https://speed.cloudflare.com/__down?bytes=1", { method: "HEAD" });
      const ray = probe.headers.get("cf-ray") || "";
      const pop = ray.split("-").pop(); // IST, AMS, FRA vs.
      if (pop) serverLoc = `${pop} (Cloudflare)`;
    } catch {}
    send("server", 0, { server: serverLoc });
    addLog(`Sunucu: ${serverLoc}`, "info");

    // PING — Türk sunucularına ölç
    send("ping", -1);
    addLog("Ping testi...", "info");
    const pingTargets = [
      "https://www.turktelekom.com.tr",
      "https://www.turkcell.com.tr",
      "https://speed.cloudflare.com/__down?bytes=1"
    ];
    const pings = [];
    for (const target of pingTargets) {
      try {
        const t = Date.now();
        await fetch(target, { method: "HEAD", timeout: 5000 });
        pings.push(Date.now() - t);
      } catch {}
    }
    const ping = pings.length > 0 ? Math.min(...pings) : 0;
    send("ping", ping);
    addLog(`Ping: ${ping} ms`, "success");

    // DOWNLOAD — Cloudflare İstanbul PoP (otomatik Türkiye edge)
    send("download", -1);
    addLog("İndirme testi...", "info");
    const dlStart = Date.now();
    const dlRes = await fetch("https://speed.cloudflare.com/__down?bytes=10000000");
    await dlRes.buffer();
    const dlTime = (Date.now() - dlStart) / 1000;
    const dlMbps = parseFloat(((10000000 * 8) / dlTime / 1000000).toFixed(1));
    send("download", dlMbps);
    addLog(`İndirme: ${dlMbps} Mbps`, "success");

    // UPLOAD — Cloudflare İstanbul PoP
    send("upload", -1);
    addLog("Yükleme testi...", "info");
    const upData = Buffer.alloc(2000000, 0x41);
    const upStart = Date.now();
    await fetch("https://speed.cloudflare.com/__up", { method: "POST", body: upData, headers: { "Content-Type": "application/octet-stream" } });
    const upTime = (Date.now() - upStart) / 1000;
    const upMbps = parseFloat(((2000000 * 8) / upTime / 1000000).toFixed(1));
    send("upload", upMbps);
    addLog(`Yükleme: ${upMbps} Mbps`, "success");

    send("done", 0);
    return { ping, download: dlMbps, upload: upMbps, server: serverLoc };
  } catch (e) {
    addLog(`Hız testi hatası: ${e.message}`, "error");
    send("error", 0);
    return { error: e.message };
  }
});

ipcMain.on("window-minimize", () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on("window-close", () => {
  if (mainWindow) {
    if (currentConfig?.minimizeToTray) mainWindow.hide();
    else forceQuit();
  }
});

function updateTray() {
  if (!tray) return;
  const label = isConnected ? "DPIGuard — Aktif" : "DPIGuard — Kapalı";
  tray.setToolTip(label);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420, height: 700, minWidth: 400, minHeight: 600,
    resizable: true, frame: false, transparent: false,
    title: "DPIGuard",
    backgroundColor: "#000000",
    icon: path.join(__dirname, "public", "icon.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
    show: false,
  });
  mainWindow.loadFile(path.join(__dirname, "public", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", e => { if (currentConfig?.minimizeToTray) { e.preventDefault(); mainWindow.hide(); } });
  mainWindow.on("closed", () => { mainWindow = null; });
}

function createTray() {
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4, 0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - 8, dy = y - 8;
    if (dx*dx + dy*dy <= 49) { const i = (y*size+x)*4; canvas[i]=0; canvas[i+1]=229; canvas[i+2]=160; canvas[i+3]=255; }
  }
  tray = new Tray(nativeImage.createFromBuffer(canvas, { width: size, height: size }));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "DPIGuard Turkey", enabled: false },
    { type: "separator" },
    { label: "Göster", click: () => { if (mainWindow) mainWindow.show(); } },
    { label: "Bağlan", click: () => { if (!isConnected) startEngine(); } },
    { label: "Bağlantıyı Kes", click: () => { if (isConnected) stopEngine(); } },
    { type: "separator" },
    { label: "Çıkış", click: () => forceQuit() },
  ]));
  tray.setToolTip("DPIGuard Turkey");
  tray.on("double-click", () => { if (mainWindow) mainWindow.show(); });
}

async function forceQuit() {
  if (isConnected) await stopEngine();
  if (tray) tray.destroy();
  app.exit(0);
}

let isQuitting = false;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); } else {
  app.on("second-instance", () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  app.whenReady().then(() => { createWindow(); try { createTray(); } catch {} });
  app.on("window-all-closed", () => { if (!isConnected) forceQuit(); });
  app.on("before-quit", async (e) => {
    if (isConnected && !isQuitting) {
      e.preventDefault();
      isQuitting = true;
      await stopEngine();
      app.quit();
    }
  });
}
