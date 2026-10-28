"""Utilidades compartilhadas pelos dispositivos simulados (MQTT, config, log)."""
import json
import os
import sys
import time

import paho.mqtt.client as mqtt

BROKER_HOST = os.getenv("MQTT_HOST", "mosquitto")
BROKER_PORT = int(os.getenv("MQTT_PORT", "1883"))
CONFIG_PATH = os.getenv("FARM_CONFIG", "/config/farm.json")


def log(device_id, msg):
    print(f"[{time.strftime('%H:%M:%S')}] {device_id}: {msg}", flush=True)


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def connect(device_id, on_message=None, subscriptions=()):
    """Conecta ao broker com Last Will (offline) e reconexão automática."""
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=device_id)
    status_topic = f"agro/status/{device_id}"
    client.will_set(status_topic, json.dumps({"deviceId": device_id, "online": False}), qos=1, retain=True)
    client.reconnect_delay_set(min_delay=1, max_delay=10)

    def _on_connect(c, userdata, flags, reason_code, properties):
        log(device_id, f"conectado ao broker ({reason_code})")
        for topic in subscriptions:
            c.subscribe(topic, qos=1)

    client.on_connect = _on_connect
    if on_message:
        client.on_message = on_message

    while True:
        try:
            client.connect(BROKER_HOST, BROKER_PORT, keepalive=15)
            break
        except OSError as exc:
            log(device_id, f"broker indisponível ({exc}); tentando novamente em 2s")
            time.sleep(2)
    client.loop_start()
    return client


def publish(client, topic, payload, retain=False, qos=0):
    client.publish(topic, json.dumps(payload, ensure_ascii=False), qos=qos, retain=retain)


def now_ms():
    return int(time.time() * 1000)


def fatal(msg):
    print(msg, file=sys.stderr, flush=True)
    sys.exit(1)
