// ------------------------------
// ------- Beehive Environmental Monitor & Control - Client Script -----------
// ------------------------------

// ------------------------------
// ------- Global Constants & State -----------
// ------------------------------
const GAUGE_CIRCUMFERENCE = 293.21;

let activeTab = "dashboard";
let trendRangeMode = 30;
let currentViewedDate = "";
let isPollingActive = true;
let loadedLogsCache = [];
let lastTelemetryData = null;
let lastTargetIp = null;

let trendCharts = {
    temp: null,
    hum: null,
    co2: null
};

let isCameraActive = false;
let selectedCameraDeviceId = 0;

document.addEventListener("DOMContentLoaded", function () {
    const savedIp = localStorage.getItem("beehive_esp32_ip");
    if (savedIp) {
        const ipInput = document.getElementById("inputEspIp");
        if (ipInput) ipInput.value = savedIp;
        const connectionIp = document.getElementById("connectionIp");
        if (connectionIp) connectionIp.innerText = `Target: ${savedIp}`;
    }

    startLiveClock();

    const todayIso = new Date().toISOString().split("T")[0];
    const dateInput = document.getElementById("calendarDateInput");
    if (dateInput) {
        dateInput.value = todayIso;
        currentViewedDate = todayIso;
    }

    initTrendCharts();
    fetchRecentTrendReadings(trendRangeMode);

    fetchAvailableLogDates();
    loadDateLogs();

    fetchCameraDevices();
    checkCameraStatus();

    fetchLiveData();
    setInterval(fetchLiveData, 2500);

    let resizeTimer = null;
    window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (trendCharts.temp) trendCharts.temp.resize();
            if (trendCharts.hum) trendCharts.hum.resize();
            if (trendCharts.co2) trendCharts.co2.resize();
        }, 120);
    });
});

// ------------------------------
// ------- Live System Clock -----------
// ------------------------------
function startLiveClock() {
    function updateClock() {
        const now = new Date();
        const clockEl = document.getElementById("liveClock");
        if (clockEl) {
            clockEl.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
    }
    updateClock();
    setInterval(updateClock, 1000);
}

// ------------------------------
// ------- Tab Navigation Controller -----------
// ------------------------------
function switchTab(tabName) {
    activeTab = tabName;
    const buttons = document.querySelectorAll(".nav-tab-btn");
    const views = document.querySelectorAll(".tab-view");

    buttons.forEach(btn => btn.classList.remove("active"));
    views.forEach(view => view.classList.remove("active"));

    const activeBtn = document.querySelector(`[onclick="switchTab('${tabName}')"]`);
    const activePane = document.getElementById(`tab-${tabName}`);

    if (activeBtn) activeBtn.classList.add("active");
    if (activePane) activePane.classList.add("active");

    if (tabName === "dashboard") {
        setTimeout(() => {
            if (trendCharts.temp) trendCharts.temp.resize();
            if (trendCharts.hum) trendCharts.hum.resize();
            if (trendCharts.co2) trendCharts.co2.resize();
        }, 100);
    } else if (tabName === "calendar") {
        fetchAvailableLogDates();
        loadDateLogs();
    } else if (tabName === "config") {
        syncConfigFields(lastTelemetryData, lastTargetIp, false);
    }
}

// ------------------------------
// ------- Connect / Disconnect Toggle Controller -----------
// ------------------------------
function toggleEspConnection() {
    const targetAction = isPollingActive ? "disconnect" : "connect";

    fetch("/api/esp32/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: targetAction })
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === "success") {
                isPollingActive = data.polling_active;
                updateConnectButtonUI(isPollingActive);
                fetchLiveData();
            }
        })
        .catch(err => {
            console.error("Error toggling connection:", err);
        });
}

function updateConnectButtonUI(active) {
    const btn = document.getElementById("btnConnectToggle");
    const streamBadge = document.getElementById("liveStreamBadge");
    const pulseRing = document.getElementById("streamPulseRing");
    const streamText = document.getElementById("streamBadgeText");

    if (!btn) return;

    if (active) {
        btn.className = "btn btn-connect-toggle btn-disconnect";
        btn.innerHTML = '<i class="fa-solid fa-link-slash"></i> <span>Disconnect</span>';
        if (streamBadge) streamBadge.className = "live-pulse-badge";
        if (pulseRing) pulseRing.className = "pulse-ring";
        if (streamText) streamText.innerText = "Live Stream Active";
    } else {
        btn.className = "btn btn-connect-toggle btn-connect";
        btn.innerHTML = '<i class="fa-solid fa-plug"></i> <span>Connect</span>';
        if (streamBadge) streamBadge.className = "live-pulse-badge paused";
        if (pulseRing) pulseRing.className = "pulse-ring paused";
        if (streamText) streamText.innerText = "Polling Paused (Disconnected)";
    }
}

// ------------------------------
// ------- Python OpenCV Live Camera Controller -----------
// ------------------------------
function fetchCameraDevices() {
    const selectEl = document.getElementById("cameraSelectDropdown");
    if (!selectEl) return;

    fetch("/api/camera/devices")
        .then(res => res.json())
        .then(data => {
            if (data.status === "success" && data.devices) {
                selectEl.innerHTML = "";
                data.devices.forEach(dev => {
                    const opt = document.createElement("option");
                    opt.value = dev.id;
                    opt.innerText = `${dev.name} (${dev.resolution})`;
                    if (dev.id === data.current_device) {
                        opt.selected = true;
                        selectedCameraDeviceId = dev.id;
                    }
                    selectEl.appendChild(opt);
                });

                if (data.active) {
                    setCameraActiveUI(true, data.resolution);
                }
            }
        })
        .catch(err => {
            console.warn("Could not fetch camera devices from Flask OpenCV:", err);
        });
}

function checkCameraStatus() {
    fetch("/api/camera/status")
        .then(res => res.json())
        .then(data => {
            if (data.active) {
                setCameraActiveUI(true, data.resolution);
            }
        })
        .catch(() => {});
}

function onCameraDeviceChanged() {
    const selectEl = document.getElementById("cameraSelectDropdown");
    if (!selectEl) return;

    const newDeviceId = parseInt(selectEl.value || "0");
    selectedCameraDeviceId = newDeviceId;

    fetch("/api/camera/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: newDeviceId })
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === "success") {
                if (isCameraActive) {
                    const imgEl = document.getElementById("cameraStreamImg");
                    if (imgEl) {
                        imgEl.src = `/api/camera/stream?t=${Date.now()}`;
                    }
                    setCameraActiveUI(true, data.resolution);
                }
            }
        })
        .catch(err => console.error("Error changing camera device:", err));
}

function toggleCameraStream() {
    const targetAction = isCameraActive ? "stop" : "start";
    const selectEl = document.getElementById("cameraSelectDropdown");
    const deviceId = selectEl ? parseInt(selectEl.value || "0") : selectedCameraDeviceId;

    fetch("/api/camera/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: targetAction, device_id: deviceId })
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === "success") {
                setCameraActiveUI(data.active, data.resolution);
            } else {
                alert("Failed to start Python OpenCV camera. Please check if webcam is connected.");
                setCameraActiveUI(false);
            }
        })
        .catch(err => {
            console.error("Error toggling OpenCV camera:", err);
            alert("Error communicating with Python OpenCV server.");
        });
}

function setCameraActiveUI(active, resolution) {
    isCameraActive = active;

    const imgEl = document.getElementById("cameraStreamImg");
    const placeholderEl = document.getElementById("cameraPlaceholder");
    const btnToggle = document.getElementById("btnToggleCamera");
    const btnSnapshot = document.getElementById("btnSnapshot");
    const btnFullscreen = document.getElementById("btnFullscreen");
    const hudBadge = document.getElementById("cameraHudBadge");
    const hudResolution = document.getElementById("hudResolution");

    if (active) {
        if (imgEl) {
            imgEl.src = `/api/camera/stream?t=${Date.now()}`;
            imgEl.style.display = "block";
        }
        if (placeholderEl) placeholderEl.style.display = "none";
        if (hudBadge) hudBadge.style.display = "flex";
        if (hudResolution) hudResolution.innerText = resolution || "Active";

        if (btnToggle) {
            btnToggle.className = "btn btn-secondary btn-sm";
            btnToggle.innerHTML = '<i class="fa-solid fa-video-slash text-rose"></i> <span>Stop Camera</span>';
        }
        if (btnSnapshot) btnSnapshot.disabled = false;
        if (btnFullscreen) btnFullscreen.disabled = false;
    } else {
        if (imgEl) {
            imgEl.src = "";
            imgEl.style.display = "none";
        }
        if (placeholderEl) placeholderEl.style.display = "flex";
        if (hudBadge) hudBadge.style.display = "none";

        if (btnToggle) {
            btnToggle.className = "btn btn-primary btn-sm";
            btnToggle.innerHTML = '<i class="fa-solid fa-video"></i> <span>Enable Camera Preview</span>';
        }
        if (btnSnapshot) btnSnapshot.disabled = true;
        if (btnFullscreen) btnFullscreen.disabled = true;
    }
}

function takeCameraSnapshot() {
    const drawerEl = document.getElementById("snapshotDrawer");
    const imgEl = document.getElementById("snapshotImgPreview");
    const linkEl = document.getElementById("snapshotDownloadLink");

    const snapshotUrl = `/api/camera/snapshot?t=${Date.now()}`;
    if (imgEl) imgEl.src = snapshotUrl;
    if (linkEl) {
        const timestampStr = new Date().toISOString().replace(/[:.]/g, "-");
        linkEl.href = snapshotUrl;
        linkEl.download = `beehive_snap_${timestampStr}.jpg`;
    }

    if (drawerEl) drawerEl.style.display = "block";
}

function closeSnapshotDrawer() {
    const drawerEl = document.getElementById("snapshotDrawer");
    if (drawerEl) drawerEl.style.display = "none";
}

function toggleCameraFullscreen() {
    const box = document.getElementById("cameraViewportBox");
    if (!box) return;

    if (!document.fullscreenElement) {
        box.requestFullscreen().catch(err => console.warn(err));
    } else {
        document.exitFullscreen();
    }
}

// ------------------------------
// ------- Live Telemetry Fetching & Unified Gauge Renderers -----------
// ------------------------------
function fetchLiveData() {
    fetch("/api/live")
        .then(response => response.json())
        .then(data => {
            isPollingActive = data.polling_active !== undefined ? data.polling_active : true;
            updateConnectButtonUI(isPollingActive);
            updateDashboardGaugesAndActuators(data);

            if (activeTab === "dashboard" && isPollingActive) {
                if (trendRangeMode !== "today") {
                    fetchRecentTrendReadings(trendRangeMode);
                }
            }
        })
        .catch(err => {
            console.error("Live telemetry polling error:", err);
            updateConnectionUI(false, "Disconnected", "192.168.43.150");
        });
}

function updateConnectionUI(connected, statusText, ip) {
    const statusDot = document.getElementById("statusDot");
    const connectionState = document.getElementById("connectionState");
    const connectionIp = document.getElementById("connectionIp");

    if (connected) {
        statusDot.className = "status-indicator-dot online";
        connectionState.innerText = statusText || "Online (Connected)";
        connectionState.style.color = "var(--accent-emerald)";
    } else {
        statusDot.className = "status-indicator-dot offline";
        connectionState.innerText = isPollingActive ? "Disconnected (Check OLED)" : "Paused (Disconnected)";
        connectionState.style.color = "var(--accent-rose)";
    }
    if (connectionIp) {
        connectionIp.innerText = `Target: ${ip || "192.168.43.150"}`;
    }
}

function convertRawGasToPpm(rawVal) {
    if (typeof rawVal !== "number" || isNaN(rawVal) || rawVal <= 0) {
        return 0;
    }
    const clampedRaw = Math.min(Math.max(rawVal, 0), 4095);
    const ppm = Math.round((clampedRaw / 4095.0) * 2000);
    return ppm;
}

function updateDashboardGaugesAndActuators(payload) {
    const isConnected = payload.connected;
    const targetIp = payload.target_ip;
    const tel = payload.telemetry;

    lastTelemetryData = tel;
    lastTargetIp = targetIp;

    const modeStr = tel && tel.wifi_mode ? tel.wifi_mode : "Online";
    updateConnectionUI(isConnected, `${modeStr} Connected`, targetIp);

    syncConfigFields(tel, targetIp, false);

    if (!tel) return;

    // ------------------------------
    // ------- Unified Gauge: Average Temperature -----------
    // ------------------------------
    const avgTemp = typeof tel.avg_temp === "number" ? tel.avg_temp : 0.0;
    const gaugeAvgTempEl = document.getElementById("gaugeAvgTempVal");
    if (gaugeAvgTempEl) gaugeAvgTempEl.innerText = avgTemp > 0 ? avgTemp.toFixed(1) : "--";

    const clampedTemp = Math.min(Math.max(avgTemp, 0), 60);
    const tempPct = clampedTemp / 60;
    const tempOffset = GAUGE_CIRCUMFERENCE * (1 - tempPct);
    const tempArcEl = document.getElementById("tempGaugeArc");
    const tempStatusBadge = document.getElementById("tempStatusBadge");

    if (tempArcEl) {
        tempArcEl.style.strokeDashoffset = tempOffset;
    }

    if (tempStatusBadge && tempArcEl) {
        if (avgTemp < 25) {
            tempArcEl.style.stroke = "#0284c7";
            tempStatusBadge.className = "gauge-status-pill pill-cyan";
            tempStatusBadge.innerHTML = '<i class="fa-solid fa-snowflake"></i> Low Temp (< 25°C)';
        } else if (avgTemp >= 28 && avgTemp <= 35) {
            tempArcEl.style.stroke = "#059669";
            tempStatusBadge.className = "gauge-status-pill pill-emerald";
            tempStatusBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Ideal Hive (28-35°C)';
        } else if (avgTemp > 35 && avgTemp <= 40) {
            tempArcEl.style.stroke = "#f59e0b";
            tempStatusBadge.className = "gauge-status-pill pill-amber";
            tempStatusBadge.innerHTML = '<i class="fa-solid fa-temperature-arrow-up"></i> Warm Hive (35-40°C)';
        } else if (avgTemp > 40) {
            tempArcEl.style.stroke = "#e11d48";
            tempStatusBadge.className = "gauge-status-pill pill-rose";
            tempStatusBadge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> High Temp Alert!';
        } else {
            tempArcEl.style.stroke = "#0d9488";
            tempStatusBadge.className = "gauge-status-pill pill-cyan";
            tempStatusBadge.innerHTML = '<i class="fa-solid fa-check"></i> Normal (25-28°C)';
        }
    }

    // ------------------------------
    // ------- Unified Gauge: Average Humidity -----------
    // ------------------------------
    const avgHum = typeof tel.avg_hum === "number" ? tel.avg_hum : 0.0;
    const gaugeAvgHumEl = document.getElementById("gaugeAvgHumVal");
    if (gaugeAvgHumEl) gaugeAvgHumEl.innerText = avgHum > 0 ? avgHum.toFixed(1) : "--";

    const clampedHum = Math.min(Math.max(avgHum, 0), 100);
    const humPct = clampedHum / 100;
    const humOffset = GAUGE_CIRCUMFERENCE * (1 - humPct);
    const humArcEl = document.getElementById("humRingCircle");
    const humStatusBadge = document.getElementById("humStatusBadge");

    if (humArcEl) {
        humArcEl.style.strokeDashoffset = humOffset;
    }

    if (humStatusBadge && humArcEl) {
        if (avgHum < 40) {
            humArcEl.style.stroke = "#f59e0b";
            humStatusBadge.className = "gauge-status-pill pill-amber";
            humStatusBadge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Dry Air (< 40%)';
        } else if (avgHum >= 55 && avgHum <= 65) {
            humArcEl.style.stroke = "#059669";
            humStatusBadge.className = "gauge-status-pill pill-emerald";
            humStatusBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Ideal Hive (55-65%)';
        } else if (avgHum <= 75) {
            humArcEl.style.stroke = "#0ea5e9";
            humStatusBadge.className = "gauge-status-pill pill-cyan";
            humStatusBadge.innerHTML = '<i class="fa-solid fa-water"></i> Comfort Zone (40-75%)';
        } else {
            humArcEl.style.stroke = "#e11d48";
            humStatusBadge.className = "gauge-status-pill pill-rose";
            humStatusBadge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> High Humidity (> 75%)';
        }
    }

    // ------------------------------
    // ------- Carbon Dioxide Sensor Card -----------
    // ------------------------------
    const rawGas = typeof tel.gas_val === "number" 
        ? tel.gas_val 
        : (typeof tel.co2_ppm === "number" ? tel.co2_ppm : 0);

    const mainCo2Val = convertRawGasToPpm(rawGas);

    const gaugeCo2El = document.getElementById("gaugeCo2Val");
    if (gaugeCo2El) gaugeCo2El.innerText = mainCo2Val;

    const co2QualityBadge = document.getElementById("co2QualityBadge");
    if (co2QualityBadge) {
        if (mainCo2Val < 800) {
            co2QualityBadge.className = "gauge-status-pill pill-emerald";
            co2QualityBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Good Air Quality';
        } else if (mainCo2Val <= 1500) {
            co2QualityBadge.className = "gauge-status-pill pill-amber";
            co2QualityBadge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Moderate CO2';
        } else {
            co2QualityBadge.className = "gauge-status-pill pill-rose";
            co2QualityBadge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> High CO2 Alert!';
        }
    }

    const co2BarPct = Math.min(Math.max((mainCo2Val / 2000) * 100, 0), 100);
    setBarWidth("barCo2", co2BarPct);

    const gasVal = typeof tel.gas_val === "number" ? Math.round(tel.gas_val) : 0;
    setText("cardGas1Val", typeof tel.gas_val === "number" ? `${gasVal} ADC` : "-- ADC");

    const t1 = typeof tel.temp1 === "number" ? tel.temp1 : 0.0;
    const h1 = typeof tel.hum1 === "number" ? tel.hum1 : 0.0;
    const t2 = typeof tel.temp2 === "number" ? tel.temp2 : 0.0;
    const h2 = typeof tel.hum2 === "number" ? tel.hum2 : 0.0;

    setText("cardTemp1Val", t1 > 0 ? `${t1.toFixed(1)} °C` : "-- °C");
    setText("cardTemp2Val", t2 > 0 ? `${t2.toFixed(1)} °C` : "-- °C");
    setText("cardHum1Val", h1 > 0 ? `${h1.toFixed(1)} %` : "-- %");
    setText("cardHum2Val", h2 > 0 ? `${h2.toFixed(1)} %` : "-- %");

    setText("valTemp1", t1 > 0 ? t1.toFixed(1) : "--");
    setText("valHum1", h1 > 0 ? h1.toFixed(1) : "--");
    setText("valTemp2", t2 > 0 ? t2.toFixed(1) : "--");
    setText("valHum2", h2 > 0 ? h2.toFixed(1) : "--");

    setBarWidth("barTemp1", Math.min(Math.max((t1 / 50) * 100, 0), 100));
    setBarWidth("barHum1", Math.min(Math.max(h1, 0), 100));
    setBarWidth("barTemp2", Math.min(Math.max((t2 / 50) * 100, 0), 100));
    setBarWidth("barHum2", Math.min(Math.max(h2, 0), 100));

    const bon = typeof tel.bulb_on_temp === "number" ? tel.bulb_on_temp.toFixed(1) : "--";
    const boff = typeof tel.bulb_off_temp === "number" ? tel.bulb_off_temp.toFixed(1) : "--";
    const fon = typeof tel.fan_on_temp === "number" ? tel.fan_on_temp.toFixed(1) : "--";
    const foff = typeof tel.fan_off_temp === "number" ? tel.fan_off_temp.toFixed(1) : "--";

    setText("lblBulbOn", bon);
    setText("lblBulbOff", boff);
    setText("lblFanOn", fon);
    setText("lblFanOff", foff);

    let srcLabel = "Average Temp";
    if (tel.ctrl_source === 1) {
        srcLabel = "DHT11 #1 (Pin 32)";
    } else if (tel.ctrl_source === 2) {
        srcLabel = "DHT11 #2 (Pin 33)";
    }
    setText("lblBulbSource", srcLabel);
    setText("lblFanSource", srcLabel);

    const bulbIconWrapper = document.getElementById("bulbIconWrapper");
    const bulbStateBadge = document.getElementById("bulbStateBadge");
    if (tel.bulb_status === "ON") {
        if (bulbIconWrapper) bulbIconWrapper.classList.add("active");
        if (bulbStateBadge) {
            bulbStateBadge.className = "relay-state-badge badge-on bulb";
            bulbStateBadge.innerHTML = '<i class="fa-solid fa-fire"></i> WARMER ON';
        }
    } else {
        if (bulbIconWrapper) bulbIconWrapper.classList.remove("active");
        if (bulbStateBadge) {
            bulbStateBadge.className = "relay-state-badge badge-off";
            bulbStateBadge.innerHTML = '<i class="fa-solid fa-power-off"></i> WARMER OFF';
        }
    }

    const fanIconWrapper = document.getElementById("fanIconWrapper");
    const fanStateBadge = document.getElementById("fanStateBadge");
    if (tel.fan_status === "ON") {
        if (fanIconWrapper) fanIconWrapper.classList.add("active");
        if (fanStateBadge) {
            fanStateBadge.className = "relay-state-badge badge-on fan";
            fanStateBadge.innerHTML = '<i class="fa-solid fa-wind"></i> COOLER ON';
        }
    } else {
        if (fanIconWrapper) fanIconWrapper.classList.remove("active");
        if (fanStateBadge) {
            fanStateBadge.className = "relay-state-badge badge-off";
            fanStateBadge.innerHTML = '<i class="fa-solid fa-power-off"></i> COOLER OFF';
        }
    }
}

// ------------------------------
// ------- Sync Active Values into Configuration -----------
// ------------------------------
function syncConfigFields(tel, targetIp, force = false) {
    if (targetIp) {
        localStorage.setItem("beehive_esp32_ip", targetIp);
        const ipInput = document.getElementById("inputEspIp");
        if (ipInput && (force || !ipInput.value || ipInput.dataset.synced !== "true")) {
            if (force || document.activeElement !== ipInput) {
                ipInput.value = targetIp;
                ipInput.dataset.synced = "true";
            }
        }
    }

    if (!tel) return;

    const bon = typeof tel.bulb_on_temp === "number" ? tel.bulb_on_temp : null;
    const boff = typeof tel.bulb_off_temp === "number" ? tel.bulb_off_temp : null;
    const fon = typeof tel.fan_on_temp === "number" ? tel.fan_on_temp : null;
    const foff = typeof tel.fan_off_temp === "number" ? tel.fan_off_temp : null;

    let srcBadge = "Average (DHT1 + DHT2)";
    if (tel.ctrl_source === 1) {
        srcBadge = "DHT11 #1 (Pin 32)";
    } else if (tel.ctrl_source === 2) {
        srcBadge = "DHT11 #2 (Pin 33)";
    }
    setText("cfgActiveCtrlSource", srcBadge);

    setText("cfgActiveBulbOn", bon !== null ? `${bon.toFixed(1)}°C` : "--");
    setText("cfgActiveBulbOff", boff !== null ? `${boff.toFixed(1)}°C` : "--");
    setText("cfgActiveFanOn", fon !== null ? `${fon.toFixed(1)}°C` : "--");
    setText("cfgActiveFanOff", foff !== null ? `${foff.toFixed(1)}°C` : "--");

    const selectCtrlSource = document.getElementById("selectCtrlSource");
    if (selectCtrlSource && (force || selectCtrlSource.dataset.synced !== "true")) {
        if (tel.ctrl_source !== undefined && (force || document.activeElement !== selectCtrlSource)) {
            selectCtrlSource.value = String(tel.ctrl_source);
            selectCtrlSource.dataset.synced = "true";
        }
    }

    const inputBon = document.getElementById("inputBulbOn");
    const inputBoff = document.getElementById("inputBulbOff");
    const inputFon = document.getElementById("inputFanOn");
    const inputFoff = document.getElementById("inputFanOff");

    if (inputBon && (force || inputBon.dataset.synced !== "true")) {
        if (bon !== null && (force || document.activeElement !== inputBon)) {
            inputBon.value = bon.toFixed(1);
            inputBon.dataset.synced = "true";
        }
    }
    if (inputBoff && (force || inputBoff.dataset.synced !== "true")) {
        if (boff !== null && (force || document.activeElement !== inputBoff)) {
            inputBoff.value = boff.toFixed(1);
            inputBoff.dataset.synced = "true";
        }
    }
    if (inputFon && (force || inputFon.dataset.synced !== "true")) {
        if (fon !== null && (force || document.activeElement !== inputFon)) {
            inputFon.value = fon.toFixed(1);
            inputFon.dataset.synced = "true";
        }
    }
    if (inputFoff && (force || inputFoff.dataset.synced !== "true")) {
        if (foff !== null && (force || document.activeElement !== inputFoff)) {
            inputFoff.value = foff.toFixed(1);
            inputFoff.dataset.synced = "true";
        }
    }
}

function syncCurrentConfigFromEsp() {
    const feedback = document.getElementById("threshFeedback");
    if (lastTelemetryData) {
        syncConfigFields(lastTelemetryData, lastTargetIp, true);
        showFeedback(feedback, "Synchronized active 4-temperature setpoints from ESP32.", "success");
    } else {
        fetchLiveData();
        showFeedback(feedback, "Polling ESP32 for active temperature setpoints...", "");
    }
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

function setBarWidth(id, pct) {
    const el = document.getElementById(id);
    if (el) el.style.width = `${pct}%`;
}

// ------------------------------
// ------- Environmental Trends Charts Initialization & Updates -----------
// ------------------------------
function initTrendCharts() {
    const tempCtx = document.getElementById("tempTrendChart");
    const humCtx = document.getElementById("humTrendChart");
    const co2Ctx = document.getElementById("co2TrendChart");

    if (!tempCtx || !humCtx || !co2Ctx) return;

    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: "index", intersect: false },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: "#ffffff",
                titleColor: "#0f172a",
                bodyColor: "#334155",
                borderColor: "#e2e8f0",
                borderWidth: 1,
                padding: 9,
                boxPadding: 4,
                usePointStyle: true
            }
        },
        scales: {
            x: {
                grid: { color: "#f1f5f9" },
                ticks: { color: "#64748b", font: { family: "JetBrains Mono", size: 10 }, maxRotation: 0 }
            },
            y: {
                grid: { color: "#f1f5f9" },
                ticks: { color: "#64748b", font: { family: "JetBrains Mono", size: 10 } }
            }
        }
    };

    trendCharts.temp = new Chart(tempCtx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "Probe 1 Temp (°C)",
                    borderColor: "#f59e0b",
                    backgroundColor: "rgba(245, 158, 11, 0.08)",
                    borderWidth: 2,
                    tension: 0.35,
                    pointRadius: 2,
                    data: []
                },
                {
                    label: "Probe 2 Temp (°C)",
                    borderColor: "#ea580c",
                    backgroundColor: "transparent",
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    tension: 0.35,
                    pointRadius: 2,
                    data: []
                },
                {
                    label: "Avg Hive Temp (°C)",
                    borderColor: "#4f46e5",
                    backgroundColor: "rgba(79, 70, 229, 0.05)",
                    borderWidth: 2.5,
                    tension: 0.35,
                    pointRadius: 3,
                    fill: true,
                    data: []
                }
            ]
        },
        options: {
            ...commonOptions,
            scales: {
                ...commonOptions.scales,
                y: {
                    ...commonOptions.scales.y,
                    suggestedMin: 20,
                    suggestedMax: 42,
                    title: { display: true, text: "Temperature (°C)", color: "#64748b", font: { size: 10 } }
                }
            }
        }
    });

    trendCharts.hum = new Chart(humCtx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "Probe 1 Hum (%)",
                    borderColor: "#38bdf8",
                    backgroundColor: "transparent",
                    borderWidth: 1.5,
                    tension: 0.35,
                    pointRadius: 2,
                    data: []
                },
                {
                    label: "Probe 2 Hum (%)",
                    borderColor: "#2563eb",
                    backgroundColor: "transparent",
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    tension: 0.35,
                    pointRadius: 2,
                    data: []
                },
                {
                    label: "Avg Humidity (%)",
                    borderColor: "#0d9488",
                    backgroundColor: "rgba(13, 148, 136, 0.08)",
                    borderWidth: 2.5,
                    tension: 0.35,
                    pointRadius: 3,
                    fill: true,
                    data: []
                }
            ]
        },
        options: {
            ...commonOptions,
            scales: {
                ...commonOptions.scales,
                y: {
                    ...commonOptions.scales.y,
                    suggestedMin: 30,
                    suggestedMax: 90,
                    title: { display: true, text: "Humidity (%)", color: "#64748b", font: { size: 10 } }
                }
            }
        }
    });

    trendCharts.co2 = new Chart(co2Ctx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "Gas Sensor (PPM)",
                    borderColor: "#059669",
                    backgroundColor: "rgba(5, 150, 105, 0.1)",
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 3,
                    fill: true,
                    data: []
                }
            ]
        },
        options: {
            ...commonOptions,
            scales: {
                ...commonOptions.scales,
                y: {
                    ...commonOptions.scales.y,
                    suggestedMin: 300,
                    suggestedMax: 1200,
                    title: { display: true, text: "Gas Concentration (PPM)", color: "#64748b", font: { size: 10 } }
                }
            }
        }
    });
}

function setTrendRange(mode) {
    trendRangeMode = mode;

    const btnIds = ["btnRange5", "btnRange10", "btnRange30", "btnRange50", "btnRangeToday"];
    btnIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove("active");
    });

    if (mode === 5) document.getElementById("btnRange5")?.classList.add("active");
    else if (mode === 10) document.getElementById("btnRange10")?.classList.add("active");
    else if (mode === 30) document.getElementById("btnRange30")?.classList.add("active");
    else if (mode === 50) document.getElementById("btnRange50")?.classList.add("active");
    else if (mode === "today") document.getElementById("btnRangeToday")?.classList.add("active");

    refreshTrendData();
}

function refreshTrendData() {
    if (trendRangeMode === "today") {
        fetchTodayTrendReadings();
    } else {
        fetchRecentTrendReadings(trendRangeMode);
    }
}

function fetchRecentTrendReadings(limit) {
    const numLimit = typeof limit === "number" ? limit : 30;
    fetch(`/api/logs/recent?limit=${numLimit}`)
        .then(res => res.json())
        .then(data => {
            if (data.status === "success") {
                populateTrendCharts(data.readings);
            }
        })
        .catch(err => console.error("Error fetching recent trend readings:", err));
}

function fetchTodayTrendReadings() {
    const todayStr = new Date().toISOString().split("T")[0];
    fetch(`/api/logs?date=${todayStr}`)
        .then(res => res.json())
        .then(data => {
            populateTrendCharts(data.records || []);
        })
        .catch(err => console.error("Error fetching today trend readings:", err));
}

function populateTrendCharts(records) {
    if (!trendCharts.temp || !trendCharts.hum || !trendCharts.co2) return;

    const labels = [];
    const temp1Data = [];
    const temp2Data = [];
    const avgTempData = [];
    const hum1Data = [];
    const hum2Data = [];
    const avgHumData = [];
    const co2Data = [];

    const step = records.length > 100 ? Math.ceil(records.length / 80) : 1;

    for (let i = 0; i < records.length; i += step) {
        const r = records[i];
        labels.push(r.time || r.timestamp || `Pt ${i + 1}`);
        temp1Data.push(r.temp1);
        temp2Data.push(r.temp2);
        avgTempData.push(r.avg_temp);
        hum1Data.push(r.hum1);
        hum2Data.push(r.hum2);
        avgHumData.push(r.avg_hum);
        const rCo2 = typeof r.co2_ppm === "number" && r.co2_ppm > 0 
            ? (r.co2_ppm > 2500 ? convertRawGasToPpm(r.co2_ppm) : r.co2_ppm) 
            : convertRawGasToPpm(r.gas_val);
        co2Data.push(rCo2);
    }

    trendCharts.temp.data.labels = labels;
    trendCharts.temp.data.datasets[0].data = temp1Data;
    trendCharts.temp.data.datasets[1].data = temp2Data;
    trendCharts.temp.data.datasets[2].data = avgTempData;
    trendCharts.temp.update("none");

    trendCharts.hum.data.labels = labels;
    trendCharts.hum.data.datasets[0].data = hum1Data;
    trendCharts.hum.data.datasets[1].data = hum2Data;
    trendCharts.hum.data.datasets[2].data = avgHumData;
    trendCharts.hum.update("none");

    trendCharts.co2.data.labels = labels;
    trendCharts.co2.data.datasets[0].data = co2Data;
    trendCharts.co2.update("none");
}

// ------------------------------
// ------- Date-Partitioned Data Logs Controller -----------
// ------------------------------
function fetchAvailableLogDates() {
    fetch("/api/logs/dates")
        .then(res => res.json())
        .then(data => {
            if (data.status === "success") {
                const select = document.getElementById("availableDatesSelect");
                if (!select) return;

                select.innerHTML = "";
                if (data.dates.length === 0) {
                    select.innerHTML = '<option value="">No stored logs found</option>';
                    return;
                }

                data.dates.forEach(d => {
                    const opt = document.createElement("option");
                    opt.value = d.date_iso;
                    opt.innerText = `${d.formatted_date} (${d.filename})`;
                    if (d.date_iso === currentViewedDate) {
                        opt.selected = true;
                    }
                    select.appendChild(opt);
                });
            }
        })
        .catch(err => console.error("Error fetching stored log dates:", err));
}

function selectDateFromDropdown() {
    const select = document.getElementById("availableDatesSelect");
    if (!select || !select.value) return;

    const dateInput = document.getElementById("calendarDateInput");
    if (dateInput) {
        dateInput.value = select.value;
    }
    loadDateLogs();
}

function loadTodayLogs() {
    const todayIso = new Date().toISOString().split("T")[0];
    const dateInput = document.getElementById("calendarDateInput");
    if (dateInput) {
        dateInput.value = todayIso;
    }
    loadDateLogs();
}

function loadDateLogs() {
    const dateInput = document.getElementById("calendarDateInput");
    const selectedDate = dateInput ? dateInput.value : new Date().toISOString().split("T")[0];
    if (!selectedDate) return;

    currentViewedDate = selectedDate;
    const viewHeader = document.getElementById("currentViewedDate");
    if (viewHeader) viewHeader.innerText = selectedDate;

    const tbody = document.getElementById("logTableBody");
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center empty-state"><i class="fa-solid fa-spinner fa-spin"></i> Reading log file from data_logs/ folder...</td></tr>';
    }

    fetch(`/api/logs?date=${selectedDate}`)
        .then(res => res.json())
        .then(data => {
            loadedLogsCache = data.records || [];
            renderDailySummary(data.summary, data.count);
            renderLogTable(loadedLogsCache);
        })
        .catch(err => {
            console.error("Error loading date logs:", err);
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center empty-state text-rose"><i class="fa-solid fa-circle-exclamation"></i> Error loading log records.</td></tr>';
            }
        });
}

function renderDailySummary(summary, count) {
    setText("logRecordCount", count || 0);

    if (count > 0 && summary) {
        setText("sumMinTemp", `${summary.min_temp.toFixed(1)} °C`);
        setText("sumMaxTemp", `${summary.max_temp.toFixed(1)} °C`);
        setText("sumAvgTemp", `${summary.avg_temp.toFixed(1)} °C`);
        setText("sumAvgHum", `${summary.avg_hum.toFixed(1)} %`);
        const avgGas = summary.avg_gas !== undefined ? summary.avg_gas : (summary.avg_co2 !== undefined ? summary.avg_co2 : 0);
        setText("sumAvgCo2", `${Math.round(avgGas)} ADC`);
    } else {
        setText("sumMinTemp", "-- °C");
        setText("sumMaxTemp", "-- °C");
        setText("sumAvgTemp", "-- °C");
        setText("sumAvgHum", "-- %");
        setText("sumAvgCo2", "-- ADC");
    }
}

function renderLogTable(records) {
    const tbody = document.getElementById("logTableBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!records || records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center empty-state"><i class="fa-regular fa-folder-open"></i> No telemetry log entries found for ${currentViewedDate} in data_logs/</td></tr>`;
        return;
    }

    const reversed = records.slice().reverse();
    const fragment = document.createDocumentFragment();

    reversed.forEach(rec => {
        const tr = document.createElement("tr");

        const bulbBadgeHtml = rec.bulb_status === "ON"
            ? '<span class="status-cell-badge on-bulb"><i class="fa-solid fa-fire"></i> ON</span>'
            : '<span class="status-cell-badge off">OFF</span>';

        const fanBadgeHtml = rec.fan_status === "ON"
            ? '<span class="status-cell-badge on-fan"><i class="fa-solid fa-wind"></i> ON</span>'
            : '<span class="status-cell-badge off">OFF</span>';

        const gasDisplay = rec.gas_val !== undefined 
            ? Math.round(rec.gas_val) 
            : (rec.gas_ppm !== undefined ? Math.round(rec.gas_ppm) : (rec.co2_ppm !== undefined ? Math.round(rec.co2_ppm) : "--"));

        tr.innerHTML = `
            <td><strong>${rec.time || rec.timestamp}</strong></td>
            <td>${rec.temp1 !== undefined ? rec.temp1.toFixed(1) : "--"}</td>
            <td>${rec.temp2 !== undefined ? rec.temp2.toFixed(1) : "--"}</td>
            <td><strong>${rec.avg_temp !== undefined ? rec.avg_temp.toFixed(1) : "--"}</strong></td>
            <td>${rec.avg_hum !== undefined ? rec.avg_hum.toFixed(1) : "--"}</td>
            <td>${gasDisplay}</td>
            <td>${bulbBadgeHtml}</td>
            <td>${fanBadgeHtml}</td>
        `;
        fragment.appendChild(tr);
    });

    tbody.appendChild(fragment);
}

function filterLogTable() {
    const query = document.getElementById("logSearchInput").value.toLowerCase().trim();
    if (!query) {
        renderLogTable(loadedLogsCache);
        return;
    }

    const filtered = loadedLogsCache.filter(r => {
        const gasValStr = r.gas_val !== undefined ? r.gas_val : (r.gas_ppm !== undefined ? r.gas_ppm : (r.co2_ppm !== undefined ? r.co2_ppm : ""));
        const fullStr = `${r.time} ${r.timestamp} ${r.temp1} ${r.temp2} ${r.avg_temp} ${r.avg_hum} ${gasValStr} ${r.bulb_status} ${r.fan_status}`.toLowerCase();
        return fullStr.includes(query);
    });

    renderLogTable(filtered);
}

function downloadCurrentLog() {
    const dateInput = document.getElementById("calendarDateInput");
    const dateVal = dateInput ? dateInput.value : currentViewedDate;
    if (!dateVal) return;

    window.location.href = `/api/logs/download?date=${dateVal}`;
}

// ------------------------------
// ------- Configuration Submissions: IP, Thresholds, WiFi -----------
// ------------------------------
function setEspIp() {
    const ipVal = document.getElementById("inputEspIp").value.trim();
    const feedback = document.getElementById("ipFeedback");

    if (ipVal.length === 0) {
        showFeedback(feedback, "Please enter a valid IP address.", "error");
        return;
    }

    showFeedback(feedback, "Updating target ESP32 IP...", "");

    fetch("/api/esp32/ip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: ipVal })
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === "success") {
                showFeedback(feedback, data.message, "success");
                lastTargetIp = ipVal;
                localStorage.setItem("beehive_esp32_ip", ipVal);
                fetchLiveData();
            } else {
                showFeedback(feedback, data.message, "error");
            }
        })
        .catch(err => {
            showFeedback(feedback, "Failed to connect to Flask server.", "error");
        });
}

function updateThresholds() {
    const bonVal = parseFloat(document.getElementById("inputBulbOn").value);
    const boffVal = parseFloat(document.getElementById("inputBulbOff").value);
    const fonVal = parseFloat(document.getElementById("inputFanOn").value);
    const foffVal = parseFloat(document.getElementById("inputFanOff").value);
    const feedback = document.getElementById("threshFeedback");

    if (isNaN(bonVal) || isNaN(boffVal) || isNaN(fonVal) || isNaN(foffVal)) {
        showFeedback(feedback, "Please enter valid numbers for all 4 temperature thresholds.", "error");
        return;
    }

    if (bonVal >= boffVal) {
        showFeedback(feedback, "Bulb ON temperature must be lower than Bulb OFF temperature.", "error");
        return;
    }

    if (foffVal >= fonVal) {
        showFeedback(feedback, "Fan OFF temperature must be lower than Fan ON temperature.", "error");
        return;
    }

    const ctrlSrcVal = parseInt(document.getElementById("selectCtrlSource")?.value || "0");

    showFeedback(feedback, "Writing settings & control sensor source to ESP32 EEPROM...", "");

    const payload = {
        bulb_on: bonVal,
        bulb_off: boffVal,
        fan_on: fonVal,
        fan_off: foffVal,
        ctrl_source: isNaN(ctrlSrcVal) ? 0 : ctrlSrcVal
    };

    fetch("/api/esp32/thresholds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === "success") {
                showFeedback(feedback, data.message, "success");
                fetchLiveData();
            } else {
                showFeedback(feedback, data.message, "error");
            }
        })
        .catch(err => {
            showFeedback(feedback, "Failed to send thresholds to ESP32.", "error");
        });
}

function updateWiFi() {
    const ssidVal = document.getElementById("inputSsid").value.trim();
    const passVal = document.getElementById("inputPass").value.trim();
    const feedback = document.getElementById("wifiFeedback");

    if (ssidVal.length === 0) {
        showFeedback(feedback, "Hotspot SSID cannot be empty.", "error");
        return;
    }

    showFeedback(feedback, "Saving WiFi credentials to ESP32 EEPROM & triggering reconnect...", "");

    fetch("/api/esp32/wifi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid: ssidVal, password: passVal })
    })
        .then(res => res.json())
        .then(data => {
            if (data.status === "success") {
                showFeedback(feedback, data.message, "success");
            } else {
                showFeedback(feedback, data.message, "error");
            }
        })
        .catch(err => {
            showFeedback(feedback, "Error communicating with ESP32.", "error");
        });
}

function showFeedback(el, message, type) {
    if (!el) return;
    el.innerText = message;
    el.className = `form-notification ${type}`;
}
