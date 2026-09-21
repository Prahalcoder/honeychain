# ------------------------------
# ------- OpenCV Camera Manager & Streaming Engine -----------
# ------------------------------

import cv2
import threading
import time

class CameraManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.cap = None
        self.is_running = False
        self.current_device_id = 0
        self.current_frame = None
        self.worker_thread = None
        self.frame_width = 1280
        self.frame_height = 720
        self.actual_width = 0
        self.actual_height = 0
        self.last_frame_time = 0

    # ------------------------------
    # ------- Detect Connected Camera Devices -----------
    # ------------------------------
    def detect_devices(self, max_check=4):
        available = []
        for idx in range(max_check):
            if self.is_running and self.current_device_id == idx:
                name = f"Camera {idx} (Active / OpenCV)"
                available.append({
                    "id": idx,
                    "name": name,
                    "resolution": f"{self.actual_width}x{self.actual_height}"
                })
                continue

            cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
            if not cap.isOpened():
                cap = cv2.VideoCapture(idx)

            if cap.isOpened():
                ret, frame = cap.read()
                if ret and frame is not None:
                    h, w = frame.shape[:2]
                    available.append({
                        "id": idx,
                        "name": f"Camera {idx} (USB / Built-in)",
                        "resolution": f"{w}x{h}"
                    })
                cap.release()

        if len(available) == 0:
            available.append({
                "id": 0,
                "name": "Default Camera (Device 0)",
                "resolution": "Standard"
            })
        return available

    # ------------------------------
    # ------- Start Camera Capture Thread -----------
    # ------------------------------
    def start(self, device_id=0):
        with self.lock:
            if self.is_running and self.current_device_id == device_id and self.cap and self.cap.isOpened():
                return True

            self.stop_locked()

            self.current_device_id = device_id
            
            self.cap = cv2.VideoCapture(device_id, cv2.CAP_DSHOW)
            if not self.cap.isOpened():
                self.cap = cv2.VideoCapture(device_id)

            if not self.cap.isOpened():
                print(f"[CameraManager] Error: Could not open camera {device_id}")
                return False

            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.frame_width)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.frame_height)
            self.cap.set(cv2.CAP_PROP_FPS, 30)

            ret, frame = self.cap.read()
            if ret and frame is not None:
                self.actual_height, self.actual_width = frame.shape[:2]
                self.current_frame = frame
            else:
                self.actual_width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640)
                self.actual_height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 480)

            self.is_running = True
            self.worker_thread = threading.Thread(target=self._capture_loop, daemon=True)
            self.worker_thread.start()
            print(f"[CameraManager] Camera {device_id} started at {self.actual_width}x{self.actual_height}")
            return True

    # ------------------------------
    # ------- Background Frame Capture Loop -----------
    # ------------------------------
    def _capture_loop(self):
        while self.is_running:
            if self.cap and self.cap.isOpened():
                ret, frame = self.cap.read()
                if ret and frame is not None:
                    with self.lock:
                        self.current_frame = frame
                        self.last_frame_time = time.time()
                else:
                    time.sleep(0.02)
            else:
                break
            time.sleep(0.015)

    # ------------------------------
    # ------- Stop Camera Capture -----------
    # ------------------------------
    def stop(self):
        with self.lock:
            self.stop_locked()

    def stop_locked(self):
        self.is_running = False
        if self.cap:
            try:
                self.cap.release()
            except Exception:
                pass
            self.cap = None
        self.current_frame = None

    # ------------------------------
    # ------- Get Current JPEG Frame -----------
    # ------------------------------
    def get_jpeg_frame(self, quality=85):
        with self.lock:
            if not self.is_running or self.current_frame is None:
                return None
            frame = self.current_frame.copy()

        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), quality]
        ret, buffer = cv2.imencode('.jpg', frame, encode_param)
        if not ret:
            return None
        return buffer.tobytes()

    # ------------------------------
    # ------- MJPEG Video Stream Generator -----------
    # ------------------------------
    def generate_stream(self):
        while True:
            if not self.is_running:
                time.sleep(0.1)
                continue

            frame_bytes = self.get_jpeg_frame(quality=80)
            if frame_bytes is not None:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            time.sleep(0.033)  # ~30 FPS

    # ------------------------------
    # ------- Camera Status Information -----------
    # ------------------------------
    def get_status(self):
        with self.lock:
            return {
                "active": self.is_running,
                "device_id": self.current_device_id,
                "width": self.actual_width,
                "height": self.actual_height,
                "resolution": f"{self.actual_width}x{self.actual_height}" if self.is_running else "Inactive"
            }
