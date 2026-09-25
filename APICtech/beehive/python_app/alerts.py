"""Hive-health SMS alerts without a GSM module.

The ESP32 only measures. This worker runs the hive-health analysis (insights.analyze) on the recent readings
every minute and, when it finds a problem worth a text (a HIGH risk, or MEDIUM risks while the hive is AT_RISK),
reports it to the Honey Chain API (POST /api/iot/alerts). The API texts the keeper through an SMS API and keeps a
record. The monitor is linked to one keeper's hive from the Keeper app, which gives it a token; the link lives in
config.json under "alert_link".
"""
import threading
import time

import requests

CHECK_EVERY_SECONDS = 60
# The API already avoids repeat texts (cooldown per problem); this only stops the monitor re-sending an unchanged
# report every minute.
RESEND_UNCHANGED_AFTER_SECONDS = 15 * 60


class AlertWorker:
    def __init__(self, get_link, get_readings, is_connected, analyze):
        self.get_link = get_link
        self.get_readings = get_readings
        self.is_connected = is_connected
        self.analyze = analyze
        self.last_signature = None
        self.last_sent_at = 0.0
        self.last_result = {"state": "idle", "message": "Not linked to a hive yet."}
        self.lock = threading.Lock()

    def status(self):
        with self.lock:
            return dict(self.last_result)

    def linked_changed(self, linked):
        """Called when the Keeper app links or unlinks the monitor, so the status shown is current at once."""
        self.last_signature = None
        self._set("waiting" if linked else "idle", "Linked. The first check runs within a minute." if linked else "Not linked to a hive yet.")

    def _set(self, state, message, **extra):
        with self.lock:
            self.last_result = {"state": state, "message": message, "at": time.strftime("%Y-%m-%dT%H:%M:%S"), **extra}

    def check_once(self):
        link = self.get_link()
        if not link or not link.get("token") or not link.get("api_url"):
            self._set("idle", "Not linked to a hive yet.")
            return
        # Readings from a monitor that is not receiving data are stale: never alert on them.
        if not self.is_connected():
            self._set("waiting", "ESP32 not connected: no fresh readings to analyse.")
            return

        report = self.analyze(self.get_readings(), connected=True)
        worth = [r for r in report.get("risks", []) if r.get("level") == "HIGH" or (report.get("status") == "AT_RISK" and r.get("level") == "MEDIUM")]
        if not worth:
            self.last_signature = None
            self._set("ok", f"Hive {report.get('status', 'OK')}, nothing to text.", score=report.get("score"))
            return

        signature = (report.get("status"), tuple(sorted(r["name"] for r in worth)))
        if signature == self.last_signature and time.time() - self.last_sent_at < RESEND_UNCHANGED_AFTER_SECONDS:
            return

        try:
            response = requests.post(
                f"{link['api_url'].rstrip('/')}/iot/alerts",
                json={"status": report.get("status"), "score": report.get("score"), "risks": report.get("risks", [])},
                headers={"Authorization": f"Bearer {link['token']}"},
                timeout=10,
            )
            body = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
            if response.ok:
                self.last_signature = signature
                self.last_sent_at = time.time()
                self._set("reported", f"Reported {len(worth)} problem(s); SMS: {body.get('sms')}.", sms=body.get("sms"))
            else:
                self._set("error", body.get("message") or f"API answered {response.status_code}")
        except Exception as error:  # the API being down must never stop the monitor
            self._set("error", f"Could not reach the Honey Chain API: {error}")

    def run_forever(self):
        while True:
            try:
                self.check_once()
            except Exception as error:
                self._set("error", f"Alert check failed: {error}")
            time.sleep(CHECK_EVERY_SECONDS)

    def start(self):
        threading.Thread(target=self.run_forever, daemon=True).start()
