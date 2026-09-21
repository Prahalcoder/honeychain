import os
import json
import threading
from datetime import datetime

# ------------------------------
# ------- Beehive Database & File Storage Handler -----------
# ------------------------------
class BeehiveDatabase:
    def __init__(self, logs_dir="data_logs"):
        base_dir = os.path.dirname(os.path.abspath(__file__))
        if not os.path.isabs(logs_dir):
            self.logs_dir = os.path.join(base_dir, logs_dir)
        else:
            self.logs_dir = logs_dir
            
        self.lock = threading.Lock()
        self.recent_buffer = []
        self.max_buffer_size = 120
        
        self._ensure_logs_dir_exists()
        self._migrate_legacy_logs(base_dir)

    # ------------------------------
    # ------- Ensure Logs Directory Exists -----------
    # ------------------------------
    def _ensure_logs_dir_exists(self):
        if not os.path.exists(self.logs_dir):
            os.makedirs(self.logs_dir, exist_ok=True)

    # ------------------------------
    # ------- Date Log Filepath Resolver -----------
    # ------------------------------
    def _get_log_filepath_for_date(self, date_str_or_obj=None):
        if date_str_or_obj is None:
            date_key = datetime.now().strftime("%Y-%m-%d")
        elif isinstance(date_str_or_obj, datetime):
            date_key = date_str_or_obj.strftime("%Y-%m-%d")
        else:
            date_str = str(date_str_or_obj).strip()
            if "-" in date_str:
                parts = date_str.split("-")
                if len(parts) == 3:
                    if len(parts[0]) == 4:
                        date_key = f"{parts[0]}-{parts[1].zfill(2)}-{parts[2].zfill(2)}"
                    elif len(parts[2]) == 4:
                        date_key = f"{parts[2]}-{parts[1].zfill(2)}-{parts[0].zfill(2)}"
                    else:
                        date_key = date_str
                else:
                    date_key = date_str
            else:
                date_key = date_str
                
        return os.path.join(self.logs_dir, f"log_{date_key}.json"), date_key

    # ------------------------------
    # ------- Legacy Logs Migration -----------
    # ------------------------------
    def _migrate_legacy_logs(self, base_dir):
        candidates = [
            os.path.join(base_dir, "beehive_logs.json"),
            os.path.join(base_dir, "..", "beehive_logs.json"),
            "beehive_logs.json"
        ]
        
        for candidate in candidates:
            abs_path = os.path.abspath(candidate)
            if os.path.exists(abs_path) and os.path.isfile(abs_path):
                try:
                    with open(abs_path, "r", encoding="utf-8") as f:
                        legacy_records = json.load(f)
                    
                    if isinstance(legacy_records, list) and len(legacy_records) > 0:
                        by_date = {}
                        for item in legacy_records:
                            d_str = item.get("date", "")
                            if d_str and "-" in d_str:
                                p = d_str.split("-")
                                if len(p) == 3:
                                    if len(p[2]) == 4:
                                        d_key = f"{p[2]}-{p[1].zfill(2)}-{p[0].zfill(2)}"
                                    elif len(p[0]) == 4:
                                        d_key = f"{p[0]}-{p[1].zfill(2)}-{p[2].zfill(2)}"
                                    else:
                                        d_key = d_str
                                else:
                                    d_key = datetime.now().strftime("%Y-%m-%d")
                            else:
                                d_key = datetime.now().strftime("%Y-%m-%d")
                                
                            if d_key not in by_date:
                                by_date[d_key] = []
                            by_date[d_key].append(item)
                            
                        for d_key, records in by_date.items():
                            target_file = os.path.join(self.logs_dir, f"log_{d_key}.json")
                            if not os.path.exists(target_file):
                                with open(target_file, "w", encoding="utf-8") as tf:
                                    json.dump(records, tf, indent=2)
                except Exception as e:
                    print(f"[BeehiveDatabase] Legacy migration warning: {e}")

    # ------------------------------
    # ------- Log Telemetry Reading Record -----------
    # ------------------------------
    def log_reading(self, telemetry_data):
        now = datetime.now()
        date_iso = now.strftime("%Y-%m-%d")
        date_display = now.strftime("%d-%m-%Y")
        time_str = now.strftime("%I:%M:%S %p")
        timestamp_str = f"{date_display} {time_str}"
        raw_gas = float(telemetry_data.get("gas_val", 0.0))

        record = {
            "timestamp": timestamp_str,
            "date": date_display,
            "date_iso": date_iso,
            "time": time_str,
            "temp1": float(telemetry_data.get("temp1", 0.0)),
            "hum1": float(telemetry_data.get("hum1", 0.0)),
            "temp2": float(telemetry_data.get("temp2", 0.0)),
            "hum2": float(telemetry_data.get("hum2", 0.0)),
            "avg_temp": float(telemetry_data.get("avg_temp", 0.0)),
            "avg_hum": float(telemetry_data.get("avg_hum", 0.0)),
            "gas_val": raw_gas,
            "bulb_status": str(telemetry_data.get("bulb_status", "OFF")),
            "fan_status": str(telemetry_data.get("fan_status", "OFF")),
            "bulb_on_temp": float(telemetry_data.get("bulb_on_temp", 25.0)),
            "bulb_off_temp": float(telemetry_data.get("bulb_off_temp", 28.0)),
            "fan_on_temp": float(telemetry_data.get("fan_on_temp", 35.0)),
            "fan_off_temp": float(telemetry_data.get("fan_off_temp", 32.0))
        }

        # Optional channels: present only when the ESP32 firmware reports them.
        for optional in ("co2_ppm", "weight_kg"):
            if isinstance(telemetry_data.get(optional), (int, float)):
                record[optional] = float(telemetry_data[optional])

        with self.lock:
            self.recent_buffer.append(record)
            if len(self.recent_buffer) > self.max_buffer_size:
                self.recent_buffer.pop(0)

            filepath, _ = self._get_log_filepath_for_date(now)
            
            logs = []
            if os.path.exists(filepath):
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        logs = json.load(f)
                    if not isinstance(logs, list):
                        logs = []
                except Exception:
                    logs = []

            logs.append(record)

            try:
                with open(filepath, "w", encoding="utf-8") as f:
                    json.dump(logs, f, indent=2)
            except Exception as e:
                print(f"[BeehiveDatabase] Error writing log file: {e}")

        return record

    # ------------------------------
    # ------- Get Logs by Specific Date -----------
    # ------------------------------
    def get_logs_by_date(self, target_date_str):
        filepath, date_iso = self._get_log_filepath_for_date(target_date_str)
        
        records = []
        if os.path.exists(filepath):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    records = json.load(f)
                if not isinstance(records, list):
                    records = []
            except Exception:
                records = []

        total_count = len(records)
        if total_count > 0:
            temps = [r.get("avg_temp", 0.0) for r in records]
            hums = [r.get("avg_hum", 0.0) for r in records]
            gas_vals = [r.get("gas_ppm", r.get("co2_ppm", 0.0)) for r in records]
            bulb_on_count = sum(1 for r in records if r.get("bulb_status") == "ON")
            fan_on_count = sum(1 for r in records if r.get("fan_status") == "ON")

            summary = {
                "min_temp": round(min(temps), 2),
                "max_temp": round(max(temps), 2),
                "avg_temp": round(sum(temps) / total_count, 2),
                "min_hum": round(min(hums), 2),
                "max_hum": round(max(hums), 2),
                "avg_hum": round(sum(hums) / total_count, 2),
                "min_gas": round(min(gas_vals), 2),
                "max_gas": round(max(gas_vals), 2),
                "avg_gas": round(sum(gas_vals) / total_count, 2),
                "min_co2": round(min(gas_vals), 2),
                "max_co2": round(max(gas_vals), 2),
                "avg_co2": round(sum(gas_vals) / total_count, 2),
                "bulb_on_percentage": round((bulb_on_count / total_count) * 100, 1),
                "fan_on_percentage": round((fan_on_count / total_count) * 100, 1)
            }
        else:
            summary = {
                "min_temp": 0.0,
                "max_temp": 0.0,
                "avg_temp": 0.0,
                "min_hum": 0.0,
                "max_hum": 0.0,
                "avg_hum": 0.0,
                "min_gas": 0.0,
                "max_gas": 0.0,
                "avg_gas": 0.0,
                "min_co2": 0.0,
                "max_co2": 0.0,
                "avg_co2": 0.0,
                "bulb_on_percentage": 0.0,
                "fan_on_percentage": 0.0
            }

        return {
            "date": date_iso,
            "formatted_date": datetime.strptime(date_iso, "%Y-%m-%d").strftime("%d-%m-%Y") if "-" in date_iso and len(date_iso.split("-")[0]) == 4 else date_iso,
            "count": total_count,
            "summary": summary,
            "records": records
        }

    # ------------------------------
    # ------- Get Available Log Dates -----------
    # ------------------------------
    def get_available_dates(self):
        dates = []
        if os.path.exists(self.logs_dir):
            for fname in os.listdir(self.logs_dir):
                if fname.startswith("log_") and fname.endswith(".json"):
                    date_part = fname[4:-5]
                    filepath = os.path.join(self.logs_dir, fname)
                    try:
                        file_size = os.path.getsize(filepath)
                        dates.append({
                            "date_iso": date_part,
                            "formatted_date": datetime.strptime(date_part, "%Y-%m-%d").strftime("%d-%m-%Y") if len(date_part.split("-")[0]) == 4 else date_part,
                            "filename": fname,
                            "size_bytes": file_size
                        })
                    except Exception:
                        pass
        
        dates.sort(key=lambda x: x["date_iso"], reverse=True)
        return dates

    # ------------------------------
    # ------- Get Recent Readings for Trends -----------
    # ------------------------------
    def get_recent_readings(self, limit=30):
        with self.lock:
            if len(self.recent_buffer) >= limit:
                return self.recent_buffer[-limit:]
            elif len(self.recent_buffer) > 0:
                return list(self.recent_buffer)
                
        today_data = self.get_logs_by_date(datetime.now().strftime("%Y-%m-%d"))
        records = today_data.get("records", [])
        return records[-limit:] if len(records) > limit else records
