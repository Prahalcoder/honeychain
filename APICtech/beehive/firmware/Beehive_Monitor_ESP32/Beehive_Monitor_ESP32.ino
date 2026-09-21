// ------------------------------
// ------- Beehive Wireless Monitoring & Environmental Control System (ESP32) -----------
// ------------------------------

#include <WiFi.h>
#include <WebServer.h>
#include <EEPROM.h>
#include <Wire.h>
#include <DHT.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ------------------------------
// ------- EEPROM Size & Address Allocation -----------
// ------------------------------
#define EEPROM_SIZE 512
#define EEPROM_MAGIC_BYTE 0x47   // change this number to make the board forget its saved Wi-Fi and limits and load the defaults below
#define ADDR_MAGIC_BYTE   0
#define ADDR_BULB_ON      4
#define ADDR_BULB_OFF     8
#define ADDR_FAN_ON       12
#define ADDR_FAN_OFF      16
#define ADDR_CTRL_SOURCE  20
#define ADDR_SSID         30
#define ADDR_PASS         70

// ------------------------------
// ------- Hardware Pin Definitions -----------
// ------------------------------
#define GAS_PIN          35
#define CO2_PIN          34
#define MQ811_PIN        GAS_PIN
#define DHT1_PIN         32
#define DHT2_PIN         33
#define BULB_RELAY_PIN   14
#define FAN_RELAY_PIN    23

#define OLED_SCREEN_WIDTH  128
#define OLED_SCREEN_HEIGHT 64
#define OLED_RESET         -1
#define OLED_I2C_ADDRESS   0x3C

#define DHTTYPE DHT11

// ------------------------------
// ------- Default Configuration Constants -----------
// ------------------------------
#define DEFAULT_HOTSPOT_SSID  "Beehive"
#define DEFAULT_HOTSPOT_PASS  "12345678"

#define DEFAULT_BULB_ON_TEMP  25.0f
#define DEFAULT_BULB_OFF_TEMP 28.0f
#define DEFAULT_FAN_ON_TEMP   35.0f
#define DEFAULT_FAN_OFF_TEMP  32.0f
#define DEFAULT_CTRL_SOURCE   0

// ------------------------------
// ------- Telemetry Data Structure -----------
// ------------------------------
struct TelemetryData {
    float temp1;
    float hum1;
    float temp2;
    float hum2;
    float avgTemp;
    float avgHum;
    float gasVal;
    float co2Ppm;
    bool bulbStatus;
    bool fanStatus;
    float bulbOnTemp;
    float bulbOffTemp;
    float fanOnTemp;
    float fanOffTemp;
    byte ctrlSource;
    float controlTemp;
    String ipAddress;
    String wifiStatus;
    String activeSsid;
};

// ------------------------------
// ------- Global System Objects & Handles -----------
// ------------------------------
DHT dht1(DHT1_PIN, DHTTYPE);
DHT dht2(DHT2_PIN, DHTTYPE);
Adafruit_SSD1306 display(OLED_SCREEN_WIDTH, OLED_SCREEN_HEIGHT, &Wire, OLED_RESET);
WebServer server(80);

TelemetryData systemData;
SemaphoreHandle_t dataMutex;

String targetSsid = DEFAULT_HOTSPOT_SSID;
String targetPass = DEFAULT_HOTSPOT_PASS;

// ------------------------------
// ------- Dynamic Flash Notification System -----------
// ------------------------------
String oledFlashMsg = "";
unsigned long oledFlashExpiry = 0;
unsigned long lastClientActivityTime = 0;

void triggerOledFlash(const String& msg, unsigned long durationMs = 4000) {
    if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        oledFlashMsg = msg;
        oledFlashExpiry = millis() + durationMs;
        xSemaphoreGive(dataMutex);
    }
}

// ------------------------------
// ------- Function Prototypes -----------
// ------------------------------
void initEEPROM();
void saveEEPROMConfig();
void readEEPROMConfig();
void connectToHotspot();
void readSensorsAndUpdateControl();
void updateOledDisplay();
void handleGetData();
void handleSetThresholds();
void handleSetWiFi();
void handleNotFound();
void vSensorControlTask(void *pvParameters);
void vDisplayTask(void *pvParameters);
void vWiFiMonitorTask(void *pvParameters);

// ------------------------------
// ------- Boot & Loading Screen -----------
// ------------------------------
void showBootScreen() {
    Wire.begin();
    Wire.setClock(400000);

    if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDRESS)) {
        Serial.println("WARNING: SSD1306 OLED initialization failed!");
        return;
    }

    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    
    display.fillRoundRect(6, 4, 116, 18, 3, SSD1306_WHITE);
    display.setTextColor(SSD1306_BLACK, SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(20, 9);
    display.println("BEEHIVE MONITOR");

    display.setTextColor(SSD1306_WHITE);
    display.setCursor(5, 28);
    display.println("Initializing System");

    display.drawRoundRect(14, 42, 100, 10, 3, SSD1306_WHITE);
    for (int i = 0; i <= 92; i += 18) {
        display.fillRoundRect(18, 45, i, 4, 1, SSD1306_WHITE);
        display.display();
        delay(80);
    }
    delay(150);
}

// ------------------------------
// ------- Main Setup Function -----------
// ------------------------------
void setup() {
    Serial.begin(115200);
    delay(500);

    Serial.println("\n==========================================");
    Serial.println("   Beehive Monitor - ESP32 Booting up...  ");
    Serial.println("==========================================");

    pinMode(BULB_RELAY_PIN, OUTPUT);
    pinMode(FAN_RELAY_PIN, OUTPUT);
    pinMode(GAS_PIN, INPUT);
    pinMode(CO2_PIN, INPUT);
    analogSetPinAttenuation(GAS_PIN, ADC_11db);
    analogSetPinAttenuation(CO2_PIN, ADC_11db);

    digitalWrite(BULB_RELAY_PIN, LOW);
    digitalWrite(FAN_RELAY_PIN, HIGH);

    dht1.begin();
    dht2.begin();

    showBootScreen();

    dataMutex = xSemaphoreCreateMutex();
    initEEPROM();

    systemData.bulbStatus = false;
    systemData.fanStatus = false;
    systemData.activeSsid = targetSsid;
    systemData.wifiStatus = "Connecting...";

    Serial.print("Target Hotspot SSID: ");
    Serial.println(targetSsid);
    Serial.print("Warmer ON Temp: ");  Serial.println(systemData.bulbOnTemp);
    Serial.print("Warmer OFF Temp: "); Serial.println(systemData.bulbOffTemp);
    Serial.print("Cooler ON Temp: ");  Serial.println(systemData.fanOnTemp);
    Serial.print("Cooler OFF Temp: "); Serial.println(systemData.fanOffTemp);
    Serial.print("Control Source: ");  Serial.println(systemData.ctrlSource == 1 ? "DHT1" : systemData.ctrlSource == 2 ? "DHT2" : "AVERAGE");

    connectToHotspot();

    server.on("/api/data", HTTP_GET, handleGetData);
    server.on("/api/config/thresholds", HTTP_POST, handleSetThresholds);
    server.on("/api/config/wifi", HTTP_POST, handleSetWiFi);
    server.onNotFound(handleNotFound);

    server.begin();
    Serial.println("HTTP REST Server started.");

    xTaskCreatePinnedToCore(
        vSensorControlTask,
        "SensorControlTask",
        4096,
        NULL,
        2,
        NULL,
        1
    );

    xTaskCreatePinnedToCore(
        vDisplayTask,
        "DisplayTask",
        3072,
        NULL,
        1,
        NULL,
        1
    );

    xTaskCreatePinnedToCore(
        vWiFiMonitorTask,
        "WiFiMonitorTask",
        3072,
        NULL,
        1,
        NULL,
        0
    );
}

// ------------------------------
// ------- Main Loop Function -----------
// ------------------------------
void loop() {
    server.handleClient();
    vTaskDelay(pdMS_TO_TICKS(5));
}

// ------------------------------
// ------- EEPROM Read & Write Functions -----------
// ------------------------------
void initEEPROM() {
    if (!EEPROM.begin(EEPROM_SIZE)) {
        Serial.println("ERROR: EEPROM initialization failed!");
        return;
    }

    byte magic = EEPROM.read(ADDR_MAGIC_BYTE);
    if (magic != EEPROM_MAGIC_BYTE) {
        Serial.println("EEPROM Not Initialized. Writing Default Configuration...");
        
        systemData.bulbOnTemp = DEFAULT_BULB_ON_TEMP;
        systemData.bulbOffTemp = DEFAULT_BULB_OFF_TEMP;
        systemData.fanOnTemp = DEFAULT_FAN_ON_TEMP;
        systemData.fanOffTemp = DEFAULT_FAN_OFF_TEMP;
        systemData.ctrlSource = DEFAULT_CTRL_SOURCE;
        targetSsid = DEFAULT_HOTSPOT_SSID;
        targetPass = DEFAULT_HOTSPOT_PASS;

        saveEEPROMConfig();
    } else {
        Serial.println("EEPROM Config Found. Reading Saved Parameters...");
        readEEPROMConfig();
    }
}

void saveEEPROMConfig() {
    EEPROM.write(ADDR_MAGIC_BYTE, EEPROM_MAGIC_BYTE);

    EEPROM.put(ADDR_BULB_ON, systemData.bulbOnTemp);
    EEPROM.put(ADDR_BULB_OFF, systemData.bulbOffTemp);
    EEPROM.put(ADDR_FAN_ON, systemData.fanOnTemp);
    EEPROM.put(ADDR_FAN_OFF, systemData.fanOffTemp);
    EEPROM.write(ADDR_CTRL_SOURCE, systemData.ctrlSource);

    for (int i = 0; i < 32; i++) {
        if (i < targetSsid.length()) {
            EEPROM.write(ADDR_SSID + i, targetSsid[i]);
        } else {
            EEPROM.write(ADDR_SSID + i, 0);
        }
    }

    for (int i = 0; i < 64; i++) {
        if (i < targetPass.length()) {
            EEPROM.write(ADDR_PASS + i, targetPass[i]);
        } else {
            EEPROM.write(ADDR_PASS + i, 0);
        }
    }

    EEPROM.commit();
    Serial.println("EEPROM Commit Complete!");
}

// ------------------------------
// ------- JSON Parsing Helpers -----------
// ------------------------------
String extractJsonString(const String& json, const String& key) {
    int keyIdx = json.indexOf("\"" + key + "\"");
    if (keyIdx == -1) {
        return "";
    }
    int colonIdx = json.indexOf(":", keyIdx);
    if (colonIdx == -1) {
        return "";
    }
    int startQuote = json.indexOf("\"", colonIdx);
    if (startQuote == -1) {
        return "";
    }
    int endQuote = json.indexOf("\"", startQuote + 1);
    if (endQuote == -1) {
        return "";
    }
    return json.substring(startQuote + 1, endQuote);
}

float extractJsonFloat(const String& json, const String& key, float defaultVal) {
    int keyIdx = json.indexOf("\"" + key + "\"");
    if (keyIdx == -1) {
        return defaultVal;
    }
    int colonIdx = json.indexOf(":", keyIdx);
    if (colonIdx == -1) {
        return defaultVal;
    }
    int startIdx = colonIdx + 1;
    while (startIdx < (int)json.length() && (json[startIdx] == ' ' || json[startIdx] == '\t')) {
        startIdx++;
    }
    int endIdx = startIdx;
    while (endIdx < (int)json.length() && (isDigit(json[endIdx]) || json[endIdx] == '.' || json[endIdx] == '-')) {
        endIdx++;
    }
    if (endIdx > startIdx) {
        return json.substring(startIdx, endIdx).toFloat();
    }
    return defaultVal;
}

int extractJsonInt(const String& json, const String& key, int defaultVal) {
    int keyIdx = json.indexOf("\"" + key + "\"");
    if (keyIdx == -1) {
        return defaultVal;
    }
    int colonIdx = json.indexOf(":", keyIdx);
    if (colonIdx == -1) {
        return defaultVal;
    }
    int startIdx = colonIdx + 1;
    while (startIdx < (int)json.length() && (json[startIdx] == ' ' || json[startIdx] == '\t' || json[startIdx] == '\"')) {
        startIdx++;
    }
    int endIdx = startIdx;
    while (endIdx < (int)json.length() && (isDigit(json[endIdx]) || json[endIdx] == '-')) {
        endIdx++;
    }
    if (endIdx > startIdx) {
        return json.substring(startIdx, endIdx).toInt();
    }
    return defaultVal;
}

void readEEPROMConfig() {
    EEPROM.get(ADDR_BULB_ON, systemData.bulbOnTemp);
    EEPROM.get(ADDR_BULB_OFF, systemData.bulbOffTemp);
    EEPROM.get(ADDR_FAN_ON, systemData.fanOnTemp);
    EEPROM.get(ADDR_FAN_OFF, systemData.fanOffTemp);
    systemData.ctrlSource = EEPROM.read(ADDR_CTRL_SOURCE);

    if (isnan(systemData.bulbOnTemp) || systemData.bulbOnTemp < -20.0f || systemData.bulbOnTemp > 90.0f) {
        systemData.bulbOnTemp = DEFAULT_BULB_ON_TEMP;
    }
    if (isnan(systemData.bulbOffTemp) || systemData.bulbOffTemp < -20.0f || systemData.bulbOffTemp > 90.0f) {
        systemData.bulbOffTemp = DEFAULT_BULB_OFF_TEMP;
    }
    if (isnan(systemData.fanOnTemp) || systemData.fanOnTemp < -20.0f || systemData.fanOnTemp > 90.0f) {
        systemData.fanOnTemp = DEFAULT_FAN_ON_TEMP;
    }
    if (isnan(systemData.fanOffTemp) || systemData.fanOffTemp < -20.0f || systemData.fanOffTemp > 90.0f) {
        systemData.fanOffTemp = DEFAULT_FAN_OFF_TEMP;
    }
    if (systemData.ctrlSource > 2) {
        systemData.ctrlSource = DEFAULT_CTRL_SOURCE;
    }

    char ssidBuf[33];
    for (int i = 0; i < 32; i++) {
        ssidBuf[i] = EEPROM.read(ADDR_SSID + i);
    }
    ssidBuf[32] = '\0';
    targetSsid = String(ssidBuf);

    char passBuf[65];
    for (int i = 0; i < 64; i++) {
        passBuf[i] = EEPROM.read(ADDR_PASS + i);
    }
    passBuf[64] = '\0';
    targetPass = String(passBuf);

    if (targetSsid.length() == 0) {
        targetSsid = DEFAULT_HOTSPOT_SSID;
        targetPass = DEFAULT_HOTSPOT_PASS;
    }
}

// ------------------------------
// ------- FreeRTOS Task 1: Sensor Reading & Climate Control Logic -----------
// ------------------------------
void vSensorControlTask(void *pvParameters) {
    for (;;) {
        readSensorsAndUpdateControl();
        vTaskDelay(pdMS_TO_TICKS(200));
    }
}

void readSensorsAndUpdateControl() {
    static unsigned long lastDhtReadTime = 0;
    static float cachedT1 = 25.0f;
    static float cachedH1 = 50.0f;
    static float cachedT2 = 25.0f;
    static float cachedH2 = 50.0f;

    if (millis() - lastDhtReadTime >= 1500 || lastDhtReadTime == 0) {
        lastDhtReadTime = millis();
        float t1 = dht1.readTemperature();
        float h1 = dht1.readHumidity();
        float t2 = dht2.readTemperature();
        float h2 = dht2.readHumidity();

        if (!isnan(t1)) cachedT1 = t1;
        if (!isnan(h1)) cachedH1 = h1;
        if (!isnan(t2)) cachedT2 = t2;
        if (!isnan(h2)) cachedH2 = h2;
    }

    float t1 = cachedT1;
    float h1 = cachedH1;
    float t2 = cachedT2;
    float h2 = cachedH2;

    float avgT = (t1 + t2) / 2.0f;
    float avgH = (h1 + h2) / 2.0f;

    int rawGas = analogRead(GAS_PIN);
    int rawCo2 = analogRead(CO2_PIN);
    float gasVal = (float)rawGas;
    float co2Ppm = (float)rawCo2;

    float bOn = DEFAULT_BULB_ON_TEMP;
    float bOff = DEFAULT_BULB_OFF_TEMP;
    float fOn = DEFAULT_FAN_ON_TEMP;
    float fOff = DEFAULT_FAN_OFF_TEMP;
    byte sourceMode = DEFAULT_CTRL_SOURCE;

    if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        bOn = systemData.bulbOnTemp;
        bOff = systemData.bulbOffTemp;
        fOn = systemData.fanOnTemp;
        fOff = systemData.fanOffTemp;
        sourceMode = systemData.ctrlSource;
        xSemaphoreGive(dataMutex);
    }

    float controlTemp = avgT;
    if (sourceMode == 1) {
        controlTemp = t1;
    } else if (sourceMode == 2) {
        controlTemp = t2;
    } else {
        controlTemp = avgT;
    }

    static unsigned long lastDebugPrint = 0;
    if (millis() - lastDebugPrint >= 1000) {
        lastDebugPrint = millis();
        Serial.printf("[SENSOR DEBUG] T1: %.1f C | T2: %.1f C | Avg: %.1f C | Ctrl Source: %s (%.1f C) | GAS(35): %d | CO2(33): %d\n", 
            t1, t2, avgT, sourceMode == 1 ? "DHT1" : sourceMode == 2 ? "DHT2" : "AVERAGE", controlTemp, rawGas, rawCo2);
    }

    static bool currentBulbState = false;
    static bool currentFanState = false;

    if (controlTemp < bOn) {
        digitalWrite(BULB_RELAY_PIN, HIGH);
        currentBulbState = true;
    } else if (controlTemp > bOff) {
        digitalWrite(BULB_RELAY_PIN, LOW);
        currentBulbState = false;
    }

    if (controlTemp > fOn) {
        digitalWrite(FAN_RELAY_PIN, LOW);
        currentFanState = true;
    } else if (controlTemp < fOff) {
        digitalWrite(FAN_RELAY_PIN, HIGH);
        currentFanState = false;
    }

    if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        systemData.temp1 = t1;
        systemData.hum1 = h1;
        systemData.temp2 = t2;
        systemData.hum2 = h2;
        systemData.avgTemp = avgT;
        systemData.avgHum = avgH;
        systemData.gasVal = gasVal;
        systemData.co2Ppm = co2Ppm;
        systemData.bulbStatus = currentBulbState;
        systemData.fanStatus = currentFanState;
        systemData.controlTemp = controlTemp;
        xSemaphoreGive(dataMutex);
    }
}

// ------------------------------
// ------- FreeRTOS Task 2: OLED Display Update Loop -----------
// ------------------------------
void vDisplayTask(void *pvParameters) {
    for (;;) {
        TelemetryData snap;
        String curFlashMsg = "";
        unsigned long curFlashExp = 0;

        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            snap = systemData;
            curFlashMsg = oledFlashMsg;
            curFlashExp = oledFlashExpiry;
            xSemaphoreGive(dataMutex);
        }

        display.clearDisplay();

        display.fillRect(0, 0, 128, 11, SSD1306_WHITE);
        display.setTextColor(SSD1306_BLACK, SSD1306_WHITE);
        display.setTextSize(1);
        display.setCursor(6, 2);
        display.print("BEEHIVE MONITOR");

        const int circleX = 121;
        const int circleY = 5;
        bool isClientConnected = (lastClientActivityTime > 0 && (millis() - lastClientActivityTime < 6000));
        
        unsigned long blinkPeriod = isClientConnected ? 1600 : 300;
        bool blinkState = ((millis() % blinkPeriod) < (blinkPeriod / 2));

        if (blinkState) {
            display.fillCircle(circleX, circleY, 3, SSD1306_BLACK);
        } else {
            display.drawCircle(circleX, circleY, 3, SSD1306_BLACK);
        }

        display.setTextColor(SSD1306_WHITE);

        display.setCursor(2, 14);
        display.print("T1:");
        display.print(snap.temp1, 1);
        display.print("C");

        display.setCursor(53, 14);
        display.print("|");

        display.setCursor(60, 14);
        display.print("H1:");
        display.print((int)snap.hum1);
        display.println("%");

        display.setCursor(2, 25);
        display.print("T2:");
        display.print(snap.temp2, 1);
        display.print("C");

        display.setCursor(53, 25);
        display.print("|");

        display.setCursor(60, 25);
        display.print("H2:");
        display.print((int)snap.hum2);
        display.println("%");

        display.setCursor(2, 36);
        display.print("Co2:");
        display.print((int)snap.gasVal);

        display.setCursor(53, 36);
        display.print("|");

        display.setCursor(60, 36);
        display.print("Status :");

        display.setCursor(96, 36);
        if (snap.bulbStatus == true) {
            display.print(" Warm");
        } else if (snap.fanStatus == true) {
            display.print(" Cool");
        } else {
            display.print(" Good");
        }

        display.drawFastHLine(0, 48, 128, SSD1306_WHITE);

        if (millis() < curFlashExp && curFlashMsg.length() > 0) {
            display.fillRect(0, 50, 128, 14, SSD1306_WHITE);
            display.setTextColor(SSD1306_BLACK, SSD1306_WHITE);
            display.setCursor(2, 53);
            display.println(curFlashMsg);
        } else {
            display.setTextColor(SSD1306_WHITE);
            display.setCursor(2, 53);
            if (snap.wifiStatus == "Connected" && snap.ipAddress != "No IP" && !snap.ipAddress.startsWith("Connect")) {
                display.print(snap.ipAddress);
            } else {
                display.print("Conn: ");
                display.print(snap.activeSsid);
            }

            String srcVal = "AVG";
            if (snap.ctrlSource == 1) {
                srcVal = "DHT1";
            } else if (snap.ctrlSource == 2) {
                srcVal = "DHT2";
            }
            int srcX = 128 - (srcVal.length() * 6) - 1;
            display.setCursor(srcX, 53);
            display.print(srcVal);
        }

        display.display();
        vTaskDelay(pdMS_TO_TICKS(80));
    }
}

// ------------------------------
// ------- FreeRTOS Task 3: WiFi Monitor Task -----------
// ------------------------------
void vWiFiMonitorTask(void *pvParameters) {
    for (;;) {
        if (WiFi.status() != WL_CONNECTED) {
            Serial.println("WiFi connection lost! Reconnecting to Hotspot...");
            if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                systemData.wifiStatus = "Reconnecting...";
                systemData.ipAddress = "No IP";
                xSemaphoreGive(dataMutex);
            }
            connectToHotspot();
        }
        vTaskDelay(pdMS_TO_TICKS(10000));
    }
}

// ------------------------------
// ------- WiFi Connection Function -----------
// ------------------------------
void connectToHotspot() {
    Serial.print("ESP32 Connecting in STA Mode to Hotspot: ");
    Serial.println(targetSsid);

    WiFi.mode(WIFI_STA);
    WiFi.begin(targetSsid.c_str(), targetPass.c_str());

    int attemptCount = 0;
    while (WiFi.status() != WL_CONNECTED && attemptCount < 20) {
        delay(500);
        Serial.print(".");
        attemptCount++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWiFi Connected Successfully to Hotspot!");
        Serial.print("ESP32 Obtained IP Address: ");
        Serial.println(WiFi.localIP());

        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            systemData.ipAddress = WiFi.localIP().toString();
            systemData.wifiStatus = "Connected";
            systemData.activeSsid = targetSsid;
            xSemaphoreGive(dataMutex);
        }

        triggerOledFlash("> WIFI CONNECTED <", 3500);
    } else {
        Serial.println("\nFailed to connect to Hotspot. Will retry...");
        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            systemData.ipAddress = "Connecting...";
            systemData.wifiStatus = "Disconnected";
            systemData.activeSsid = targetSsid;
            xSemaphoreGive(dataMutex);
        }
    }
}

// ------------------------------
// ------- HTTP REST API Handlers -----------
// ------------------------------
void handleGetData() {
    lastClientActivityTime = millis();

    TelemetryData snap;
    if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        snap = systemData;
        xSemaphoreGive(dataMutex);
    }

    String json = "{";
    json += "\"temp1\":" + String(snap.temp1, 2) + ",";
    json += "\"hum1\":" + String(snap.hum1, 2) + ",";
    json += "\"temp2\":" + String(snap.temp2, 2) + ",";
    json += "\"hum2\":" + String(snap.hum2, 2) + ",";
    json += "\"avg_temp\":" + String(snap.avgTemp, 2) + ",";
    json += "\"avg_hum\":" + String(snap.avgHum, 2) + ",";
    json += "\"gas_val\":" + String(snap.gasVal, 1) + ",";
    json += "\"co2_ppm\":" + String(snap.co2Ppm, 1) + ",";
    
    if (snap.bulbStatus == true) {
        json += "\"bulb_status\":\"ON\",";
    } else {
        json += "\"bulb_status\":\"OFF\",";
    }

    if (snap.fanStatus == true) {
        json += "\"fan_status\":\"ON\",";
    } else {
        json += "\"fan_status\":\"OFF\",";
    }

    json += "\"bulb_on_temp\":" + String(snap.bulbOnTemp, 2) + ",";
    json += "\"bulb_off_temp\":" + String(snap.bulbOffTemp, 2) + ",";
    json += "\"fan_on_temp\":" + String(snap.fanOnTemp, 2) + ",";
    json += "\"fan_off_temp\":" + String(snap.fanOffTemp, 2) + ",";
    json += "\"ctrl_source\":" + String((int)snap.ctrlSource) + ",";
    
    String sourceName = "Average (DHT1 + DHT2)";
    if (snap.ctrlSource == 1) sourceName = "DHT11 Probe #1 (Pin 32)";
    else if (snap.ctrlSource == 2) sourceName = "DHT11 Probe #2 (Pin 33)";
    json += "\"ctrl_source_name\":\"" + sourceName + "\",";
    json += "\"control_temp\":" + String(snap.controlTemp, 2) + ",";

    json += "\"ip_address\":\"" + snap.ipAddress + "\",";
    json += "\"wifi_mode\":\"STA\",";
    json += "\"active_ssid\":\"" + snap.activeSsid + "\"";
    json += "}";

    server.send(200, "application/json", json);
}

void handleSetThresholds() {
    lastClientActivityTime = millis();

    if (server.hasArg("plain") == false) {
        server.send(400, "application/json", "{\"error\":\"No body received\"}");
        return;
    }

    String body = server.arg("plain");
    Serial.print("Received 4-Threshold & Source Payload: ");
    Serial.println(body);

    float currentBOn = DEFAULT_BULB_ON_TEMP;
    float currentBOff = DEFAULT_BULB_OFF_TEMP;
    float currentFOn = DEFAULT_FAN_ON_TEMP;
    float currentFOff = DEFAULT_FAN_OFF_TEMP;
    byte currentSrc = DEFAULT_CTRL_SOURCE;

    if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        currentBOn = systemData.bulbOnTemp;
        currentBOff = systemData.bulbOffTemp;
        currentFOn = systemData.fanOnTemp;
        currentFOff = systemData.fanOffTemp;
        currentSrc = systemData.ctrlSource;
        xSemaphoreGive(dataMutex);
    }

    float bOn = extractJsonFloat(body, "bulb_on", currentBOn);
    float bOff = extractJsonFloat(body, "bulb_off", currentBOff);
    float fOn = extractJsonFloat(body, "fan_on", currentFOn);
    float fOff = extractJsonFloat(body, "fan_off", currentFOff);
    int newSrc = extractJsonInt(body, "ctrl_source", (int)currentSrc);

    if (newSrc < 0 || newSrc > 2) {
        newSrc = (int)currentSrc;
    }

    if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        systemData.bulbOnTemp = bOn;
        systemData.bulbOffTemp = bOff;
        systemData.fanOnTemp = fOn;
        systemData.fanOffTemp = fOff;
        systemData.ctrlSource = (byte)newSrc;
        xSemaphoreGive(dataMutex);
    }

    saveEEPROMConfig();
    triggerOledFlash("> CONFIG UPDATED! <", 4500);

    Serial.println("Saved 4 temperature settings & Control Source to EEPROM!");
    server.send(200, "application/json", "{\"status\":\"success\",\"message\":\"Temperature thresholds and control source stored in EEPROM\"}");
}

void handleSetWiFi() {
    lastClientActivityTime = millis();
    if (server.hasArg("plain") == false) {
        server.send(400, "application/json", "{\"error\":\"No body received\"}");
        return;
    }

    String body = server.arg("plain");
    Serial.print("Received WiFi Payload: ");
    Serial.println(body);

    String newSsid = extractJsonString(body, "ssid");
    String newPass = extractJsonString(body, "password");

    if (newSsid.length() > 0) {
        targetSsid = newSsid;
        targetPass = newPass;
        
        saveEEPROMConfig();
        triggerOledFlash("> WIFI RESTARTING <", 4500);
        
        Serial.println("WiFi credentials saved to EEPROM!");

        server.send(200, "application/json", "{\"status\":\"success\",\"message\":\"WiFi credentials saved to EEPROM. ESP32 is restarting...\"}");
        delay(1000);
        ESP.restart();
    } else {
        server.send(400, "application/json", "{\"error\":\"Invalid SSID\"}");
    }
}

void handleNotFound() {
    server.send(404, "application/json", "{\"error\":\"Endpoint not found\"}");
}
