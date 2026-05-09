const $ = s => document.querySelector(s);
let state = { connected: false, connecting: false, config: null, methods: {}, dnsProfiles: {} };
let logVisible = false;

document.addEventListener("DOMContentLoaded", async () => {
  const data = await api.getStatus();
  state.connected = data.connected;
  state.config = data.config;
  state.methods = data.methods;
  state.dnsProfiles = data.dnsProfiles;

  if (!data.config || data.firstRun) {
    showSetup(data);
  } else {
    showPage("main");
    applyMainState(data);
  }

  api.onLog(entry => appendLog(entry));
  api.onStatus(d => { state.connected = d.connected; state.connecting = false; state.config = d.config || state.config; applyMainState(d); });
  initSpeedtestListener();
});

// ══ ISP Presets — her ISP için en iyi DNS + Bypass metodu ══
const ISP_PRESETS = {
  turktelekom: { dns: "cloudflare", method: "5" },  // Agresif + Cloudflare
  superonline: { dns: "cloudflare", method: "4" },  // Superonline+DNS
  turknet:     { dns: "google", method: "1" },       // Standart yeter
  vodafone:    { dns: "cloudflare", method: "5" },   // Agresif
  kablonet:    { dns: "cloudflare", method: "5" },   // Agresif
  diger:       { dns: "cloudflare", method: "5" },   // En güçlü default
};

function selectISP(el) {
  document.querySelectorAll(".isp-card").forEach(c => c.classList.remove("sel"));
  el.classList.add("sel");
}

function showSetup(data) {
  $("#setupView").style.display = "block";
  $("#mainView").style.display = "none";
  $("#settingsView").style.display = "none";
}

async function finishSetup() {
  const selected = document.querySelector(".isp-card.sel");
  const ispKey = selected?.dataset.isp || "diger";
  const preset = ISP_PRESETS[ispKey];
  const tray = $("#setupTray").checked;
  const startup = $("#setupStartup").checked;
  const cfg = { dns: preset.dns, method: preset.method, minimizeToTray: tray, autoStart: startup, autoRestore: true, isp: ispKey };
  await api.saveConfig(cfg);
  if (startup) await api.setAutoStart(true);
  state.config = cfg;
  showPage("main");
  const data = await api.getStatus();
  applyMainState(data);
}

// ══ Pages ══
function showPage(name) {
  $("#setupView").style.display = "none";
  $("#mainView").style.display = name === "main" ? "block" : "none";
  $("#settingsView").style.display = name === "settings" ? "block" : "none";
  if (name === "settings") renderSettings();
}

// ══ Main State ══
function applyMainState(data) {
  const btn = $("#powerBtn");
  const wrap = $("#ringWrap");
  const txt = $("#statusText");
  const sub = $("#statusSub");

  if (state.connecting) {
    btn.className = "power loading";
    wrap.className = "ring-wrap loading";
    txt.className = "status-text loading";
    txt.textContent = "BAĞLANIYOR";
    sub.textContent = "Lütfen bekleyin...";
  } else if (state.connected) {
    btn.className = "power on";
    wrap.className = "ring-wrap on";
    txt.className = "status-text on";
    txt.textContent = "AKTİF";
    sub.textContent = "DPI Bypass çalışıyor";
  } else {
    btn.className = "power off";
    wrap.className = "ring-wrap off";
    txt.className = "status-text off";
    txt.textContent = "KAPALI";
    sub.textContent = "Bağlanmak için butona basın";
  }

  if (data && !data.binariesOk) {
    $("#missingBanner").style.display = "flex";
  } else {
    $("#missingBanner").style.display = "none";
  }
}

// ══ Connection ══
async function toggleConnection() {
  if (state.connecting) return;
  if (state.connected) {
    state.connecting = true; applyMainState();
    await api.disconnect();
    state.connected = false; state.connecting = false; applyMainState();
  } else {
    state.connecting = true; applyMainState();
    const ok = await api.connect();
    // Status will come via IPC
    if (!ok) { state.connecting = false; applyMainState(); }
  }
}

// ══ Download ══
async function handleDownload() {
  $("#dlOverlay").style.display = "flex";
  await api.downloadBinaries();
  $("#dlOverlay").style.display = "none";
  const data = await api.getStatus();
  applyMainState(data);
}

// ══ Speed Test ══
let speedRunning = false;

async function runSpeedTest() {
  if (speedRunning) return;
  speedRunning = true;
  const btn = $("#speedBtn");
  const label = $("#speedLabel");
  const cards = $("#speedCards");

  btn.classList.add("running");
  label.textContent = "Test ediliyor...";
  cards.style.display = "grid";

  // Reset cards
  ["Ping", "Download", "Upload"].forEach(n => {
    $(`#val${n}`).textContent = "—";
    $(`#card${n}`).className = "speed-card";
    $(`#bar${n}`).className = $(`#bar${n}`).className.replace(/ loading| complete/g, "");
    $(`#bar${n}`).style.width = "0%";
  });

  await api.runSpeedtest();
  // Results come via onSpeedtest listener
}

function initSpeedtestListener() {
  api.onSpeedtest(({ phase, value, server }) => {
    if (phase === "server" && server) {
      const el = $("#speedServer");
      if (el) { el.textContent = `📍 ${server}`; el.style.display = "block"; }
    }
    if (phase === "ping") {
      if (value === -1) {
        $("#cardPing").className = "speed-card testing";
        $("#barPing").classList.add("loading");
      } else {
        $("#cardPing").className = "speed-card done";
        $("#barPing").className = "speed-bar-fill complete";
        animateNum($("#valPing"), 0, value, 500, 0);
      }
    }
    if (phase === "download") {
      if (value === -1) {
        $("#cardDownload").className = "speed-card testing";
        $("#barDownload").classList.add("loading");
      } else {
        $("#cardDownload").className = "speed-card done";
        $("#barDownload").className = "speed-bar-fill bar-green complete";
        animateNum($("#valDownload"), 0, value, 700, 1);
      }
    }
    if (phase === "upload") {
      if (value === -1) {
        $("#cardUpload").className = "speed-card testing";
        $("#barUpload").classList.add("loading");
      } else {
        $("#cardUpload").className = "speed-card done";
        $("#barUpload").className = "speed-bar-fill bar-blue complete";
        animateNum($("#valUpload"), 0, value, 700, 1);
      }
    }
    if (phase === "done" || phase === "error") {
      speedRunning = false;
      $("#speedBtn").classList.remove("running");
      $("#speedLabel").textContent = "Tekrar Test Et";
    }
  });
}

function animateNum(el, from, to, dur, decimals) {
  const start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / dur, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = (from + (to - from) * ease).toFixed(decimals);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ══ Log ══
function toggleLog() {
  logVisible = !logVisible;
  $("#logPanel").style.display = logVisible ? "block" : "none";
}

let logScrollQueued = false;
function appendLog(entry) {
  const body = $("#logBody");
  const line = document.createElement("div");
  line.className = "log-line";
  const t = document.createElement("span"); t.className = "log-time"; t.textContent = entry.time;
  const m = document.createElement("span"); m.className = "log-msg " + entry.type; m.textContent = entry.msg;
  line.appendChild(t); line.appendChild(m); body.appendChild(line);
  while (body.children.length > 200) body.removeChild(body.firstChild);
  if (!logScrollQueued) {
    logScrollQueued = true;
    requestAnimationFrame(() => {
      body.scrollTop = body.scrollHeight;
      logScrollQueued = false;
    });
  }
}

function clearLogs() { $("#logBody").innerHTML = ""; }

// ══ Settings ══
function renderSettings() {
  const dns = $("#settingsDns");
  dns.innerHTML = "";
  for (const [k, v] of Object.entries(state.dnsProfiles)) {
    const d = document.createElement("div");
    d.className = "s-opt" + (state.config.dns === k ? " sel" : "") + (state.connected ? " disabled" : "");
    d.innerHTML = `<div class="s-dot"></div><div class="s-opt-info"><div class="s-opt-name">${v.name}</div><div class="s-opt-desc">${v.primary}</div></div>`;
    d.onclick = () => { if (state.connected) return; state.config.dns = k; saveSettings(); renderSettings(); };
    dns.appendChild(d);
  }
  const meth = $("#settingsMethod");
  meth.innerHTML = "";
  for (const [k, v] of Object.entries(state.methods)) {
    const d = document.createElement("div");
    d.className = "s-opt" + (state.config.method === k ? " sel" : "") + (state.connected ? " disabled" : "");
    d.innerHTML = `<div class="s-dot"></div><div class="s-opt-info"><div class="s-opt-name">${v.name}</div><div class="s-opt-desc">${v.desc}</div></div>`;
    d.onclick = () => { if (state.connected) return; state.config.method = k; saveSettings(); renderSettings(); };
    meth.appendChild(d);
  }
  $("#optTray").checked = state.config.minimizeToTray !== false;
  $("#optStartup").checked = state.config.autoStart === true;
  $("#optRestore").checked = state.config.autoRestore !== false;
}

async function saveSettings() {
  state.config.minimizeToTray = $("#optTray").checked;
  state.config.autoStart = $("#optStartup").checked;
  state.config.autoRestore = $("#optRestore").checked;
  await api.saveConfig(state.config);
  await api.setAutoStart(state.config.autoStart);
}
