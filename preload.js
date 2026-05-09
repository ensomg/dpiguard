const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("api", {
  getStatus: () => ipcRenderer.invoke("get-status"),
  connect: () => ipcRenderer.invoke("connect"),
  disconnect: () => ipcRenderer.invoke("disconnect"),
  saveConfig: (cfg) => ipcRenderer.invoke("save-config", cfg),
  downloadBinaries: () => ipcRenderer.invoke("download-binaries"),
  checkAdmin: () => ipcRenderer.invoke("check-admin"),
  setAutoStart: (v) => ipcRenderer.invoke("set-autostart", v),
  openSpeedtest: () => ipcRenderer.invoke("open-speedtest"),
  runSpeedtest: () => ipcRenderer.invoke("run-speedtest"),
  onLog: (cb) => ipcRenderer.on("log", (_, d) => cb(d)),
  onStatus: (cb) => ipcRenderer.on("status", (_, d) => cb(d)),
  onSpeedtest: (cb) => ipcRenderer.on("speedtest-progress", (_, d) => cb(d)),
  windowMinimize: () => ipcRenderer.send("window-minimize"),
  windowClose: () => ipcRenderer.send("window-close"),
});
