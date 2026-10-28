"""Nó de campo simulado (gateway LoRa + sondas de solo + armadilha de pragas).

Cada contêiner representa um gateway de setor responsável por alguns talhões.
Para cada talhão publica, a cada INTERVAL segundos, umidade/temperatura do solo,
pH, condutividade elétrica, NDVI e contagem de pragas. A física é simples mas
coerente: o solo seca com o calor, a chuva e a irrigação o reidratam, e eventos
aleatórios (falha de válvula, surto de pragas, acidificação, deficiência
nutricional) degradam a lavoura até serem resolvidos.
"""
import json
import os
import random
import threading
import time

from common import connect, fatal, load_config, log, now_ms, publish

NODE_ID = os.getenv("NODE_ID")
INTERVAL = float(os.getenv("INTERVAL", "2"))
ANOMALY_RATE = float(os.getenv("ANOMALY_RATE", "0.0012"))
# Problemas iniciais para a demonstração não começar "toda verde"; ex.: "T-07:pest_outbreak"
SEED_ANOMALIES = [s for s in os.getenv("SEED_ANOMALIES", "").split(",") if ":" in s]

ANOMALIES = {
    "valve_fault": "falha na válvula de irrigação",
    "pest_outbreak": "surto de pragas",
    "acid_drift": "acidificação do solo",
    "nutrient_deficit": "deficiência nutricional",
}


def mid(r):
    return (r[0] + r[1]) / 2


class Plot:
    def __init__(self, spec, crop):
        self.id = spec["id"]
        self.r = crop["ranges"]
        self.moisture = random.uniform(mid(self.r["soilMoisture"]), self.r["soilMoisture"][1] - 2)
        self.soil_temp = mid(self.r["soilTemp"])
        self.ph = mid(self.r["ph"]) + random.uniform(-0.1, 0.1)
        self.ec = mid(self.r["ec"]) + random.uniform(-0.1, 0.1)
        self.ndvi_base = self.r["ndvi"][1] - random.uniform(0.04, 0.1)
        self.ndvi = self.ndvi_base
        self.pest_rate = random.uniform(0.5, 2)
        self.valve_open = False
        self.anomaly = None
        self.anomaly_until = 0.0

    def start_anomaly(self, kind, duration):
        self.anomaly = kind
        self.anomaly_until = time.time() + duration
        log(NODE_ID, f"{self.id}: início de anomalia '{ANOMALIES[kind]}' ({int(duration)}s)")

    def step(self, weather):
        if self.anomaly and time.time() > self.anomaly_until:
            log(NODE_ID, f"{self.id}: anomalia '{ANOMALIES[self.anomaly]}' resolvida")
            self.anomaly = None

        air_temp = weather.get("airTemp", 24)
        solar = weather.get("solarWm2", 500)
        rain = weather.get("rainMmH", 0)

        # Balanço hídrico do solo
        evaporation = 0.12 * (air_temp / 25) * (1 + solar / 1000)
        irrigation = 0.95 if self.valve_open and self.anomaly != "valve_fault" else 0
        if self.anomaly == "valve_fault":
            evaporation *= 1.6
        # Drenagem: acima da capacidade de campo a água percola rapidamente
        drainage = max(0.0, self.moisture - self.r["soilMoisture"][1]) * 0.03
        self.moisture += irrigation + rain * 0.012 - evaporation - drainage + random.gauss(0, 0.08)
        self.moisture = min(98, max(5, self.moisture))

        # Temperatura do solo acompanha o ar com atraso térmico
        # O solo amortece a variação diária do ar (inércia térmica)
        target_soil = 0.45 * air_temp + 10.5 + solar * 0.0008 - (self.moisture - 60) * 0.03
        self.soil_temp += (target_soil - self.soil_temp) * 0.05 + random.gauss(0, 0.05)

        ph_target = mid(self.r["ph"]) - (1.1 if self.anomaly == "acid_drift" else 0)
        self.ph += (ph_target - self.ph) * 0.02 + random.gauss(0, 0.008)

        ec_target = self.r["ec"][0] * 0.45 if self.anomaly == "nutrient_deficit" else mid(self.r["ec"])
        self.ec += (ec_target - self.ec) * 0.03 + random.gauss(0, 0.01)

        pest_target = random.uniform(13, 22) if self.anomaly == "pest_outbreak" else random.uniform(0.5, 2.5)
        self.pest_rate += (pest_target - self.pest_rate) * 0.04

        # Vigor (NDVI) cai sob estresse e se recupera lentamente
        stress = 0.0
        lo, hi = self.r["soilMoisture"]
        if self.moisture < lo:
            stress += (lo - self.moisture) / 40
        if self.pest_rate > self.r["pests"][1]:
            stress += (self.pest_rate - self.r["pests"][1]) / 30
        if self.ph < self.r["ph"][0] - 0.3:
            stress += 0.15
        if self.ec < self.r["ec"][0]:
            stress += 0.12
        self.ndvi += (self.ndvi_base - self.ndvi) * 0.01 - stress * 0.004 + random.gauss(0, 0.002)
        self.ndvi = min(0.95, max(0.1, self.ndvi))

        return {
            "soilMoisture": round(self.moisture, 1),
            "soilTemp": round(self.soil_temp, 1),
            "airTemp": round(air_temp + random.gauss(0, 0.2), 1),
            "airHumidity": round(weather.get("airHumidity", 65) + random.gauss(0, 1), 0),
            "ph": round(self.ph, 2),
            "ec": round(self.ec, 2),
            "ndvi": round(self.ndvi, 3),
            "pests": max(0, round(random.gauss(self.pest_rate, 0.8))),
        }


def main():
    if not NODE_ID:
        fatal("NODE_ID não definido")
    cfg = load_config()
    node = next((n for n in cfg["nodes"] if n["id"] == NODE_ID), None)
    if not node:
        fatal(f"nó {NODE_ID} não existe em farm.json")

    plots = {p["id"]: Plot(p, cfg["crops"][p["crop"]]) for p in node["plots"]}
    for seed in SEED_ANOMALIES:
        pid, kind = seed.split(":", 1)
        if pid in plots and kind in ANOMALIES:
            plots[pid].start_anomaly(kind, random.uniform(300, 480))

    weather = {}
    lock = threading.Lock()

    def on_message(c, userdata, msg):
        try:
            data = json.loads(msg.payload)
        except ValueError:
            return
        with lock:
            if msg.topic == "agro/weather":
                weather.update(data)
            else:
                pid = msg.topic.rsplit("/", 1)[-1]
                if pid in plots:
                    plots[pid].valve_open = bool(data.get("open"))

    subs = ["agro/weather"] + [f"agro/actuator/irrigation/{pid}" for pid in plots]
    client = connect(NODE_ID, on_message, subscriptions=subs)

    started = time.time()
    battery = random.uniform(78, 99)
    rssi_base = random.uniform(-92, -68)
    seq = 0
    log(NODE_ID, f"monitorando talhões {', '.join(plots)}")

    while True:
        with lock:
            snapshot = dict(weather)
            for plot in plots.values():
                if not plot.anomaly and random.random() < ANOMALY_RATE:
                    plot.start_anomaly(random.choice(list(ANOMALIES)), random.uniform(150, 360))
                metrics = plot.step(snapshot)
                publish(client, f"agro/telemetry/{NODE_ID}/{plot.id}", {
                    "nodeId": NODE_ID, "plotId": plot.id, "seq": seq, "ts": now_ms(), "metrics": metrics,
                })
        if seq % 5 == 0:
            battery = max(5, battery - random.uniform(0, 0.05))
            publish(client, f"agro/status/{NODE_ID}", {
                "deviceId": NODE_ID, "kind": "field-node", "online": True, "ts": now_ms(),
                "uptimeS": int(time.time() - started), "battery": round(battery, 1),
                "rssi": round(rssi_base + random.gauss(0, 2)), "firmware": node.get("firmware"),
                "plots": list(plots),
            }, retain=True, qos=1)
        seq += 1
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
