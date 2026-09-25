import time
import threading
import requests
import os
import re
import json
from flask import Flask, render_template, request, jsonify, send_file, Response
from database import BeehiveDatabase
from camera_manager import CameraManager
from insights import analyze as analyze_hive
from alerts import AlertWorker

app = Flask(__name__)

# The Keeper app (another port on the same computer or Wi-Fi) calls this API from the browser. Only origins on
# this machine or a private network are allowed, the same rule the Honey Chain API uses (config/network.js).
PRIVATE_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$")


@app.after_request
def allow_keeper_app(response):
    origin = request.headers.get("Origin", "")
    if origin and PRIVATE_ORIGIN.match(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    return response
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

db = BeehiveDatabase(
    logs_dir=os.path.join(BASE_DIR, "data_logs")
)

camera = CameraManager()

# ------------------------------
# ------- Global Configuration & State Persistence -----------
# ------------------------------
CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"esp32_ip": "192.168.43.150"}

def save_config(cfg):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        print(f"[Config] Error saving: {e}")

server_config = load_config()
esp32_ip = server_config.get("esp32_ip", "192.168.43.150")
is_connected = False
is_polling_active = True
latest_telemetry = {
    "temp1": 0.0,
    "hum1": 0.0,
    "temp2": 0.0,
    "hum2": 0.0,
    "avg_temp": 0.0,
    "avg_hum": 0.0,
    "gas_val": 0.0,
    "bulb_status": "OFF",
    "fan_status": "OFF",
    "bulb_on_temp": 25.0,
    "bulb_off_temp": 28.0,
    "fan_on_temp": 35.0,
    "fan_off_temp": 32.0,
    "ctrl_source": 0,
    "ctrl_source_name": "Average (DHT1 + DHT2)",
    "control_temp": 0.0,
    "ip_address": esp32_ip,
    "wifi_mode": "STA (Hotspot)"
}

telemetry_lock = threading.Lock()

# ------------------------------
# ------- ESP32 Background Polling Worker -----------
# ------------------------------
def poll_esp32_background():
    global is_connected, latest_telemetry, is_polling_active
    
    while True:
        if not is_polling_active:
            with telemetry_lock:
                is_connected = False
            time.sleep(1.0)
            continue

        target_ip = esp32_ip
        url = f"http://{target_ip}/api/data"
        
        try:
            response = requests.get(url, timeout=2.5)
            if response.status_code == 200:
                data = response.json()
                with telemetry_lock:
                    latest_telemetry = data
                    is_connected = True
                db.log_reading(data)
            else:
                with telemetry_lock:
                    is_connected = False
        except Exception:
            with telemetry_lock:
                is_connected = False
                
        time.sleep(2.5)

# ------------------------------
# ------- Main Dashboard Route -----------
# ------------------------------
@app.route("/")
def index():
    return render_template("index.html")

# ------------------------------
# ------- Live Telemetry API Endpoint -----------
# ------------------------------
@app.route("/api/live", methods=["GET"])
def get_live_data():
    with telemetry_lock:
        response_payload = {
            "connected": is_connected,
            "polling_active": is_polling_active,
            "target_ip": esp32_ip,
            "telemetry": latest_telemetry
        }
    return jsonify(response_payload)

# ------------------------------
# ------- AI Hive Health Insights (decision support) -----------
# ------------------------------
@app.route("/api/insights", methods=["GET"])
def get_hive_insights():
    limit = request.args.get("limit", default=200, type=int)
    readings = db.get_recent_readings(limit=max(10, min(limit, 500)))
    with telemetry_lock:
        connected = is_connected
    return jsonify(analyze_hive(readings, connected=connected))

# ------------------------------
# ------- ESP32 Connection Toggle API -----------
# ------------------------------
@app.route("/api/esp32/connection", methods=["POST"])
def toggle_connection():
    global is_polling_active, is_connected
    payload = request.get_json() or {}
    action = payload.get("action", "toggle")

    if action == "connect":
        is_polling_active = True
        return jsonify({"status": "success", "polling_active": True, "message": "Connecting to ESP32..."})
    elif action == "disconnect":
        is_polling_active = False
        with telemetry_lock:
            is_connected = False
        return jsonify({"status": "success", "polling_active": False, "message": "Disconnected from ESP32."})
    elif action == "toggle":
        is_polling_active = not is_polling_active
        if not is_polling_active:
            with telemetry_lock:
                is_connected = False
        return jsonify({
            "status": "success",
            "polling_active": is_polling_active,
            "message": "Connecting to ESP32..." if is_polling_active else "Disconnected from ESP32."
        })
    else:
        return jsonify({"status": "error", "message": "Invalid action parameter"}), 400

# ------------------------------
# ------- ESP32 Target IP Configuration -----------
# ------------------------------
@app.route("/api/esp32/ip", methods=["POST"])
def set_esp32_ip():
    global esp32_ip
    payload = request.get_json()
    
    if payload is not None:
        new_ip = payload.get("ip", "").strip()
        if len(new_ip) > 0:
            esp32_ip = new_ip
            server_config["esp32_ip"] = esp32_ip
            save_config(server_config)
            return jsonify({"status": "success", "message": f"Target ESP32 IP set to {esp32_ip}"})
        else:
            return jsonify({"status": "error", "message": "Invalid IP address provided"}), 400
    else:
        return jsonify({"status": "error", "message": "No JSON payload received"}), 400

# ------------------------------
# ------- ESP32 4-Temperature Thresholds Configuration -----------
# ------------------------------
@app.route("/api/esp32/thresholds", methods=["POST"])
def update_thresholds():
    payload = request.get_json()
    if payload is None:
        return jsonify({"status": "error", "message": "No JSON payload received"}), 400

    b_on = payload.get("bulb_on")
    b_off = payload.get("bulb_off")
    f_on = payload.get("fan_on")
    f_off = payload.get("fan_off")
    ctrl_source = payload.get("ctrl_source", 0)

    if b_on is None or b_off is None or f_on is None or f_off is None:
        return jsonify({"status": "error", "message": "Missing one of the 4 temperature thresholds"}), 400

    url = f"http://{esp32_ip}/api/config/thresholds"
    try:
        esp_payload = {
            "bulb_on": float(b_on),
            "bulb_off": float(b_off),
            "fan_on": float(f_on),
            "fan_off": float(f_off),
            "ctrl_source": int(ctrl_source)
        }
        esp_resp = requests.post(url, json=esp_payload, timeout=4.0)
        if esp_resp.status_code == 200:
            return jsonify({"status": "success", "message": "Settings & Sensor Control Source stored in ESP32 EEPROM!"})
        else:
            return jsonify({"status": "error", "message": "ESP32 returned status error"}), 500
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to connect to ESP32: {str(e)}"}), 500

# ------------------------------
# ------- ESP32 WiFi Configuration -----------
# ------------------------------
@app.route("/api/esp32/wifi", methods=["POST"])
def update_wifi():
    payload = request.get_json()
    if payload is None:
        return jsonify({"status": "error", "message": "No JSON payload received"}), 400

    ssid = payload.get("ssid", "").strip()
    password = payload.get("password", "").strip()

    if len(ssid) == 0:
        return jsonify({"status": "error", "message": "SSID cannot be empty"}), 400

    url = f"http://{esp32_ip}/api/config/wifi"
    try:
        esp_resp = requests.post(url, json={"ssid": ssid, "password": password}, timeout=4.0)
        if esp_resp.status_code == 200:
            return jsonify({"status": "success", "message": "WiFi credentials saved to ESP32 EEPROM. ESP32 is reconnecting..."})
        else:
            return jsonify({"status": "error", "message": "ESP32 returned error on WiFi configuration"}), 500
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to send WiFi credentials to ESP32: {str(e)}"}), 500

# ------------------------------
# ------- Python OpenCV Camera Endpoints -----------
# ------------------------------
@app.route("/api/camera/devices", methods=["GET"])
def get_camera_devices():
    devices = camera.detect_devices()
    status = camera.get_status()
    return jsonify({
        "status": "success",
        "devices": devices,
        "current_device": status["device_id"],
        "active": status["active"],
        "resolution": status["resolution"]
    })

@app.route("/api/camera/toggle", methods=["POST"])
def toggle_camera():
    payload = request.get_json() or {}
    action = payload.get("action", "toggle")
    device_id = int(payload.get("device_id", camera.current_device_id))

    if action == "start":
        success = camera.start(device_id)
    elif action == "stop":
        camera.stop()
        success = True
    elif action == "toggle":
        if camera.is_running:
            camera.stop()
            success = True
        else:
            success = camera.start(device_id)
    else:
        success = False

    status = camera.get_status()
    return jsonify({
        "status": "success" if success else "error",
        "active": status["active"],
        "device_id": status["device_id"],
        "resolution": status["resolution"]
    })

@app.route("/api/camera/select", methods=["POST"])
def select_camera_device():
    payload = request.get_json() or {}
    device_id = int(payload.get("device_id", 0))
    was_running = camera.is_running
    
    success = camera.start(device_id) if was_running else True
    camera.current_device_id = device_id
    
    status = camera.get_status()
    return jsonify({
        "status": "success" if success else "error",
        "active": status["active"],
        "device_id": status["device_id"],
        "resolution": status["resolution"]
    })

@app.route("/api/camera/status", methods=["GET"])
def get_camera_status():
    status = camera.get_status()
    return jsonify({"status": "success", **status})

@app.route("/api/camera/stream")
def get_camera_stream():
    if not camera.is_running:
        camera.start(camera.current_device_id)
    return Response(
        camera.generate_stream(),
        mimetype="multipart/x-mixed-replace; boundary=frame"
    )

@app.route("/api/camera/snapshot", methods=["GET"])
def get_camera_snapshot():
    if not camera.is_running:
        camera.start(camera.current_device_id)
        time.sleep(0.3)
        
    jpeg_bytes = camera.get_jpeg_frame(quality=95)
    if jpeg_bytes is not None:
        return Response(jpeg_bytes, mimetype="image/jpeg")
    else:
        return jsonify({"status": "error", "message": "Could not capture camera frame"}), 500

# ------------------------------
# ------- Date-Partitioned Data Logs Endpoints -----------
# ------------------------------
@app.route("/api/logs", methods=["GET"])
def get_logs_by_date():
    date_param = request.args.get("date")
    if date_param is None or len(date_param.strip()) == 0:
        date_param = time.strftime("%Y-%m-%d")
    else:
        date_param = date_param.strip()

    log_data = db.get_logs_by_date(date_param)
    return jsonify(log_data)

@app.route("/api/logs/dates", methods=["GET"])
def get_available_log_dates():
    dates = db.get_available_dates()
    return jsonify({"status": "success", "dates": dates})

@app.route("/api/logs/recent", methods=["GET"])
def get_recent_trend_data():
    limit = request.args.get("limit", default=30, type=int)
    readings = db.get_recent_readings(limit=limit)
    return jsonify({"status": "success", "count": len(readings), "readings": readings})

@app.route("/api/logs/download", methods=["GET"])
def download_log_file():
    date_param = request.args.get("date", default=time.strftime("%Y-%m-%d")).strip()
    filepath, _ = db._get_log_filepath_for_date(date_param)
    if os.path.exists(filepath):
        return send_file(filepath, as_attachment=True, download_name=f"beehive_log_{date_param}.json")
    else:
        return jsonify({"status": "error", "message": "Log file not found for specified date"}), 404

# ------------------------------
# ------- Hive-health SMS alerts (no GSM module: the Honey Chain API sends the SMS) -----------
# ------------------------------
def _connected():
    with telemetry_lock:
        return is_connected

alert_worker = AlertWorker(
    get_link=lambda: server_config.get("alert_link"),
    get_readings=lambda: db.get_recent_readings(limit=200),
    is_connected=_connected,
    analyze=analyze_hive,
)


@app.route("/api/alerts/link", methods=["GET", "POST", "DELETE", "OPTIONS"])
def alert_link():
    if request.method == "OPTIONS":
        return ("", 204)
    if request.method == "GET":
        link = server_config.get("alert_link") or {}
        return jsonify({"linked": bool(link.get("token")), "hive_code": link.get("hive_code"), "api_url": link.get("api_url"), "worker": alert_worker.status()})
    if request.method == "DELETE":
        server_config.pop("alert_link", None)
        save_config(server_config)
        alert_worker.linked_changed(False)
        return jsonify({"linked": False})

    body = request.get_json(silent=True) or {}
    token = str(body.get("token", ""))
    api_url = str(body.get("api_url", "")).strip()
    hive_code = str(body.get("hive_code", "")).strip().upper()[:20]
    if not re.match(r"^hcm_[A-Za-z0-9_-]{20,100}$", token):
        return jsonify({"message": "Invalid monitor token"}), 400
    if not re.match(r"^https?://[^\s/]+(/[^\s]*)?$", api_url):
        return jsonify({"message": "Invalid API address"}), 400
    server_config["alert_link"] = {"token": token, "api_url": api_url, "hive_code": hive_code}
    save_config(server_config)
    alert_worker.linked_changed(True)
    return jsonify({"linked": True, "hive_code": hive_code})


# ------------------------------
# ------- Start Background Polling Worker Thread -----------
# ------------------------------
poll_thread = threading.Thread(target=poll_esp32_background, daemon=True)
poll_thread.start()
alert_worker.start()

if __name__ == "__main__":
    print("==================================================")
    print(" Beehive Monitoring Flask Server Starting...     ")
    print(" Access Web Dashboard at: http://127.0.0.1:5001   ")
    print(" OpenCV Python Camera Server Active              ")
    print(" Data Logs stored at: python_app/data_logs/      ")
    print("==================================================")
    # The ESP32 posts its readings over Wi-Fi, so the server listens on the network. The interactive debugger would let
    # anyone on that network run code, so it stays off unless IOT_DEBUG=1 is set for development.
    app.run(host=os.environ.get("IOT_HOST", "0.0.0.0"), port=5001, debug=os.environ.get("IOT_DEBUG") == "1")
