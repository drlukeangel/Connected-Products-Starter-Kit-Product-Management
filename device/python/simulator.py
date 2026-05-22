"""Python device simulator for the Connected Products Starter Kit.

Publishes synthetic tool-telemetry MQTT messages to AWS IoT Core. Use this
to validate the cloud stack end-to-end without needing real hardware.

Same payload shape as the Rust firmware in `device/rust/`. Same topic:
`telemetry/<thing-name>`.

Usage:
    python simulator.py \\
        --endpoint xxxx-ats.iot.us-east-1.amazonaws.com \\
        --thing-name pm-kit-device-1 \\
        --cert  ../../cloud/cdk/certs/device.cert.pem \\
        --key   ../../cloud/cdk/certs/device.private.key \\
        --interval 10
"""

from __future__ import annotations

import argparse
import json
import random
import signal
import sys
import time
import uuid
from datetime import datetime, timezone

try:
    from awscrt import mqtt
    from awsiot import mqtt_connection_builder
    HAVE_AWS_CRT = True
except ImportError:
    HAVE_AWS_CRT = False


TOOL_MODELS = [
    ("DCD800", "20V MAX Drill"),
    ("DCF887", "20V MAX Impact Driver"),
    ("DCF899", "20V MAX Impact Wrench"),
]
JOB_SITES = [
    ("JS-001", 45.5234, -122.6845),
    ("JS-002", 40.7516, -73.9755),
    ("JS-003", 41.8789, -87.6359),
]


def build_event(thing_name: str) -> dict:
    """One synthetic telemetry event — same schema as the Rust firmware."""
    model_code, model_name = random.choice(TOOL_MODELS)
    site_id, lat, lon = random.choice(JOB_SITES)
    return {
        "event_id":         str(uuid.uuid4()),
        "event_ts":         datetime.now(timezone.utc).isoformat(),
        "thing_name":       thing_name,
        "tool_model":       model_code,
        "tool_model_name":  model_name,
        "firmware_version": "2.5.1",
        "job_site_id":      site_id,
        "gps_lat":          round(lat + random.uniform(-0.005, 0.005), 6),
        "gps_lon":          round(lon + random.uniform(-0.005, 0.005), 6),
        "battery_pct":      random.randint(5, 100),
        "torque_nm":        round(random.uniform(2.0, 95.0), 1),
        "usage_minutes":    random.randint(1, 240),
        "error_code":       random.choice(["", "", "", "E001_LOW_BATT", "E014_OVERTORQUE"]),
    }


def on_connection_interrupted(connection, error, **kwargs):
    print(f"connection interrupted: {error}", file=sys.stderr)


def on_connection_resumed(connection, return_code, session_present, **kwargs):
    print(f"connection resumed (return_code={return_code}, session_present={session_present})")


def main() -> int:
    if not HAVE_AWS_CRT:
        print("Missing awsiotsdk. Install with: pip install awsiotsdk", file=sys.stderr)
        return 2

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--endpoint",   required=True, help="AWS IoT Core ATS endpoint")
    p.add_argument("--thing-name", required=True, help="Registered Thing name")
    p.add_argument("--cert",       required=True, help="Path to device certificate (PEM)")
    p.add_argument("--key",        required=True, help="Path to device private key (PEM)")
    p.add_argument("--ca",         default=None,  help="Path to AWS Root CA (optional)")
    p.add_argument("--interval",   type=int, default=10, help="Seconds between events")
    p.add_argument("--count",      type=int, default=0, help="Number of events to send (0 = forever)")
    args = p.parse_args()

    topic = f"telemetry/{args.thing_name}"

    print(f"Connecting to {args.endpoint} as {args.thing_name}…")
    conn = mqtt_connection_builder.mtls_from_path(
        endpoint=args.endpoint,
        cert_filepath=args.cert,
        pri_key_filepath=args.key,
        ca_filepath=args.ca,
        client_id=args.thing_name,
        on_connection_interrupted=on_connection_interrupted,
        on_connection_resumed=on_connection_resumed,
        clean_session=False,
        keep_alive_secs=30,
    )
    conn.connect().result()
    print(f"Connected. Publishing to {topic} every {args.interval}s.")

    stopping = {"v": False}
    def stop(*_):
        stopping["v"] = True
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    sent = 0
    try:
        while not stopping["v"] and (args.count == 0 or sent < args.count):
            event = build_event(args.thing_name)
            payload = json.dumps(event)
            conn.publish(topic=topic, payload=payload, qos=mqtt.QoS.AT_LEAST_ONCE)
            sent += 1
            print(f"  [{sent}] {event['event_id'][:8]} battery={event['battery_pct']:>3}% "
                  f"torque={event['torque_nm']:>5}Nm err={event['error_code'] or '-'}")
            time.sleep(args.interval)
    finally:
        print("Disconnecting…")
        conn.disconnect().result()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
