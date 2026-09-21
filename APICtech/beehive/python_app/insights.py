# ------------------------------
# ------- Hive Health Insights (decision support) -----------
# ------------------------------
# Rule-based analysis over recent sensor readings. It highlights conditions that
# deserve an inspection. It is NOT a diagnosis: disease risks are indicators
# derived from temperature, humidity, gas/CO2 and (optionally) hive weight.

from datetime import datetime

IDEAL_TEMP = (28.0, 35.0)      # deg C, same range the dashboard shows
IDEAL_HUMIDITY = (50.0, 75.0)  # percent
GAS_WATCH = 800
GAS_HIGH = 1400
POLL_SECONDS = 2.5


def _valid(value, low=-10.0, high=90.0):
    # The ESP32 reports 0.0 when a probe fails, so 0 is treated as "no reading".
    return isinstance(value, (int, float)) and value != 0 and low <= value <= high


def _mean(values):
    return sum(values) / len(values) if values else None


def _slope_per_hour(values, times):
    """Least-squares slope of values against time, in units per hour."""
    n = len(values)
    if n < 3:
        return 0.0
    xs = times if times and len(times) == n else [i * POLL_SECONDS for i in range(n)]
    mean_x = sum(xs) / n
    mean_y = sum(values) / n
    denominator = sum((x - mean_x) ** 2 for x in xs)
    if denominator == 0:
        return 0.0
    numerator = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, values))
    return (numerator / denominator) * 3600.0


def _seconds(record, origin):
    try:
        stamp = datetime.strptime(f"{record['date_iso']} {record['time']}", "%Y-%m-%d %I:%M:%S %p")
        return (stamp - origin).total_seconds()
    except Exception:
        return None


def _risk(name, level, reason, action):
    return {"name": name, "level": level, "reason": reason, "action": action}


def analyze(readings, connected=True):
    readings = [r for r in readings if isinstance(r, dict)]

    if not readings:
        return {
            "engine": "rule-based-v1",
            "status": "NO_DATA",
            "score": None,
            "message": "No sensor readings yet. Connect the ESP32 to start hive health analysis.",
            "risks": [],
            "recommendations": ["Connect an ESP32 monitor to this hive."],
            "disclaimer": "Decision support only.",
        }

    temps = [r["avg_temp"] for r in readings if _valid(r.get("avg_temp"), 0, 60)]
    hums = [r["avg_hum"] for r in readings if _valid(r.get("avg_hum"), 0, 100)]
    gas = [r.get("co2_ppm", r.get("gas_ppm", r.get("gas_val"))) for r in readings]
    gas = [g for g in gas if isinstance(g, (int, float)) and g > 0]
    weights = [r["weight_kg"] for r in readings if isinstance(r.get("weight_kg"), (int, float)) and r["weight_kg"] > 0]

    origin = None
    try:
        origin = datetime.strptime(f"{readings[0]['date_iso']} {readings[0]['time']}", "%Y-%m-%d %I:%M:%S %p")
    except Exception:
        pass

    seconds = [_seconds(r, origin) for r in readings] if origin else []
    seconds = seconds if seconds and None not in seconds else []

    total = len(readings)
    cool = sum(1 for t in temps if t < IDEAL_TEMP[0]) / max(len(temps), 1)
    hot = sum(1 for t in temps if t > IDEAL_TEMP[1]) / max(len(temps), 1)
    damp = sum(1 for h in hums if h > IDEAL_HUMIDITY[1]) / max(len(hums), 1)
    in_range = 1 - cool - hot if temps else None
    warmer_duty = sum(1 for r in readings if str(r.get("bulb_status", "")).upper() == "ON") / total
    cooler_duty = sum(1 for r in readings if str(r.get("fan_status", "")).upper() == "ON") / total

    probe_gaps = [abs(r["temp1"] - r["temp2"]) for r in readings if _valid(r.get("temp1")) and _valid(r.get("temp2"))]
    probe_gap = _mean(probe_gaps)

    gas_mean = _mean(gas)
    gas_high_share = sum(1 for g in gas if g >= GAS_HIGH) / max(len(gas), 1)

    temp_slope = _slope_per_hour(temps, seconds if len(seconds) == len(temps) else [])
    weight_slope_per_day = None
    if len(weights) >= 5:
        weight_slope_per_day = _slope_per_hour(weights, []) * 24  # readings are evenly spaced

    risks = []

    if cool > 0.2:
        risks.append(_risk(
            "Chilled brood risk", "HIGH" if cool > 0.5 else "MEDIUM",
            f"Temperature was below {IDEAL_TEMP[0]:.0f} °C for {cool * 100:.0f}% of the readings.",
            "Check the brood nest, cluster size and insulation; confirm the warmer works."))

    if hot > 0.2:
        risks.append(_risk(
            "Overheating stress", "HIGH" if hot > 0.5 else "MEDIUM",
            f"Temperature was above {IDEAL_TEMP[1]:.0f} °C for {hot * 100:.0f}% of the readings.",
            "Improve ventilation and shade; check the cooler and entrance."))

    if damp > 0.3 and cool > 0.1:
        risks.append(_risk(
            "Chalkbrood / fungal risk indicator", "HIGH" if damp > 0.6 else "MEDIUM",
            f"High humidity (above {IDEAL_HUMIDITY[1]:.0f}%) combined with cool periods favours fungal brood disease.",
            "Inspect brood frames for mummified larvae and improve ventilation."))
    elif damp > 0.5:
        risks.append(_risk(
            "Excess humidity", "MEDIUM",
            f"Humidity was above {IDEAL_HUMIDITY[1]:.0f}% for {damp * 100:.0f}% of the readings.",
            "Check for condensation and ventilation; damp hives invite mould and nosema."))

    if gas_high_share > 0.2:
        risks.append(_risk(
            "Poor ventilation / CO₂ build-up", "HIGH" if gas_high_share > 0.5 else "MEDIUM",
            f"Gas / CO₂ reading was high for {gas_high_share * 100:.0f}% of the readings.",
            "Open ventilation and check for a crowded or stressed colony."))

    if warmer_duty > 0.6:
        risks.append(_risk(
            "Possible weak colony", "MEDIUM",
            f"The warmer was on for {warmer_duty * 100:.0f}% of the time, so the colony may not hold its own heat.",
            "Inspect the queen, brood pattern and population."))

    if probe_gap is not None and probe_gap > 4:
        risks.append(_risk(
            "Uneven temperature across the hive", "LOW",
            f"The two probes differ by {probe_gap:.1f} °C on average.",
            "Check probe placement; a large gap can mean the cluster sits away from one probe."))

    if weight_slope_per_day is not None and weight_slope_per_day < -0.5:
        risks.append(_risk(
            "Falling hive weight", "MEDIUM",
            f"Weight is dropping about {abs(weight_slope_per_day):.1f} kg per day.",
            "Check stores and look for robbing or a swarm."))

    if not connected:
        risks.append(_risk("Monitor offline", "LOW", "The ESP32 is not responding; figures are from the last readings.", "Check power and Wi-Fi."))

    penalty = {"HIGH": 25, "MEDIUM": 12, "LOW": 5}
    score = 100 - sum(penalty[r["level"]] for r in risks)
    if in_range is not None:
        score -= (1 - in_range) * 20
    score = int(max(0, min(100, round(score))))
    status = "HEALTHY" if score >= 80 else "WATCH" if score >= 55 else "AT_RISK"

    productivity = None
    if weight_slope_per_day is not None:
        productivity = (
            "Nectar flow likely: hive weight is rising" if weight_slope_per_day > 0.3
            else "Stable stores" if weight_slope_per_day >= -0.5
            else "Stores are falling"
        )

    recommendations = [r["action"] for r in risks if r["level"] in ("HIGH", "MEDIUM")]
    if not recommendations:
        recommendations = ["Conditions look stable. Continue routine inspections."]

    return {
        "engine": "rule-based-v1",
        "status": status,
        "score": score,
        "data_points": total,
        "metrics": {
            "avg_temp": round(_mean(temps), 1) if temps else None,
            "min_temp": round(min(temps), 1) if temps else None,
            "max_temp": round(max(temps), 1) if temps else None,
            "avg_humidity": round(_mean(hums), 1) if hums else None,
            "gas_mean": round(gas_mean, 0) if gas_mean is not None else None,
            "time_in_ideal_temp_pct": round(in_range * 100, 0) if in_range is not None else None,
            "temp_trend_c_per_hour": round(temp_slope, 2),
            "warmer_on_pct": round(warmer_duty * 100, 0),
            "cooler_on_pct": round(cooler_duty * 100, 0),
            "hive_weight_kg": round(weights[-1], 2) if weights else None,
            "weight_trend_kg_per_day": round(weight_slope_per_day, 2) if weight_slope_per_day is not None else None,
        },
        "productivity": productivity or "Hive weight sensor not connected: productivity trend unavailable.",
        "risks": risks,
        "recommendations": recommendations,
        "disclaimer": "Decision support only. These are risk indicators from sensor data, not a diagnosis. Inspect the hive to confirm.",
    }
