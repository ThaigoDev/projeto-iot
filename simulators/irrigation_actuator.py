"""Controlador de válvulas de irrigação simulado.

Recebe comandos em agro/cmd/irrigation/<talhão>, simula o tempo de atuação
mecânica da válvula e publica o estado em agro/actuator/irrigation/<talhão>.
"""
import json
import os
import random
import threading
import time

from common import connect, log, now_ms, publish

DEVICE_ID = os.getenv("DEVICE_ID", "atuador-irrigacao")
valves = {}
lock = threading.Lock()


def actuate(client, plot_id, cmd):
    time.sleep(random.uniform(0.2, 0.8))  # tempo mecânico da válvula
    is_open = cmd.get("action") == "open"
    with lock:
        valves[plot_id] = is_open
    publish(client, f"agro/actuator/irrigation/{plot_id}", {
        "deviceId": DEVICE_ID,
        "plotId": plot_id,
        "open": is_open,
        "flowLpm": round(random.uniform(38, 46), 1) if is_open else 0.0,
        "cmdId": cmd.get("cmdId"),
        "cmdTs": cmd.get("ts"),
        "ts": now_ms(),
    }, retain=True, qos=1)
    log(DEVICE_ID, f"válvula {plot_id} {'ABERTA' if is_open else 'FECHADA'} ({cmd.get('reason', '-')})")


def main():
    started = time.time()

    def on_message(c, userdata, msg):
        try:
            cmd = json.loads(msg.payload)
        except ValueError:
            return
        plot_id = msg.topic.rsplit("/", 1)[-1]
        threading.Thread(target=actuate, args=(c, plot_id, cmd), daemon=True).start()

    client = connect(DEVICE_ID, on_message, subscriptions=["agro/cmd/irrigation/+"])
    while True:
        with lock:
            open_count = sum(1 for v in valves.values() if v)
        publish(client, f"agro/status/{DEVICE_ID}", {
            "deviceId": DEVICE_ID, "kind": "actuator", "online": True, "ts": now_ms(),
            "uptimeS": int(time.time() - started), "openValves": open_count,
            "battery": 100, "rssi": -61, "firmware": "valve-ctl 3.1.0",
        }, retain=True, qos=1)
        time.sleep(5)


if __name__ == "__main__":
    main()
