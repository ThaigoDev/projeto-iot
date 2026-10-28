"""Estação meteorológica simulada.

Gera um ciclo diário acelerado (1 dia simulado = DAY_SECONDS reais) com
temperatura, umidade relativa, vento, radiação solar e eventos de chuva.
"""
import math
import os
import random
import time

from common import connect, log, now_ms, publish

DEVICE_ID = os.getenv("DEVICE_ID", "estacao-meteo")
DAY_SECONDS = float(os.getenv("DAY_SECONDS", "720"))
INTERVAL = float(os.getenv("INTERVAL", "3"))


def main():
    client = connect(DEVICE_ID)
    started = time.time()
    rain_left = 0.0
    wind = 8.0
    seq = 0

    while True:
        elapsed = time.time() - started
        # Começa às 06:00 do dia simulado
        sim_hour = (6 + 24 * elapsed / DAY_SECONDS) % 24
        sun = max(0.0, math.sin(math.pi * (sim_hour - 6) / 12))  # 0 à noite, 1 ao meio-dia
        heat = math.sin(math.pi * ((sim_hour - 9) % 24) / 24) ** 2  # pico ~15h

        if rain_left <= 0 and random.random() < 0.006:
            rain_left = random.uniform(40, 120)  # segundos de chuva
            log(DEVICE_ID, "início de chuva")
        raining = rain_left > 0
        rain_left -= INTERVAL

        air_temp = 16 + 14 * heat + random.gauss(0, 0.3) - (3 if raining else 0)
        humidity = 84 - 32 * heat + random.gauss(0, 1.5) + (12 if raining else 0)
        wind = max(0.0, wind + random.gauss(0, 0.8) + (8 - wind) * 0.05)

        payload = {
            "deviceId": DEVICE_ID,
            "ts": now_ms(),
            "seq": seq,
            "simHour": round(sim_hour, 2),
            "airTemp": round(air_temp, 1),
            "airHumidity": round(min(100, max(15, humidity)), 0),
            "windKmh": round(wind, 1),
            "rainMmH": round(random.uniform(4, 14), 1) if raining else 0.0,
            "solarWm2": round(950 * sun * (0.35 if raining else 1) + random.gauss(0, 10), 0) if sun > 0 else 0,
        }
        publish(client, "agro/weather", payload, retain=True)
        if seq % 5 == 0:
            publish(client, f"agro/status/{DEVICE_ID}", {
                "deviceId": DEVICE_ID, "kind": "weather", "online": True, "ts": now_ms(),
                "uptimeS": int(elapsed), "battery": 100, "rssi": -58, "firmware": "meteo-fw 1.8.2",
            }, retain=True, qos=1)
        seq += 1
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
