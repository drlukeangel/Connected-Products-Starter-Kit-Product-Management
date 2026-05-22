# Rust firmware (ESP32-C3)

Production-shaped device firmware. Same MQTT payload as the Python
simulator; intended to be flashed onto an actual ESP32-C3 board.

## Build

```bash
# One-time toolchain install
cargo install espup espflash ldproxy
espup install
. ~/export-esp.sh    # Linux/macOS. Windows: . $HOME/export-esp.ps1

# Provision device certs (from the CDK stack output)
mkdir -p certs
cp ../../cloud/cdk/certs/device.cert.pem certs/
cp ../../cloud/cdk/certs/device.private.key certs/
curl -o certs/AmazonRootCA1.pem https://www.amazontrust.com/repository/AmazonRootCA1.pem

# Edit src/main.rs:
#   WIFI_SSID, WIFI_PSK, IOT_ENDPOINT, THING_NAME

# Build + flash + monitor
cargo run --release
```

## What this firmware deliberately doesn't do (yet)

- **NVS-stored secrets** — credentials are constants in `main.rs` for
  the kit. In production, write them to NVS during manufacture and
  read at boot.
- **Secure element integration** — production firmware delegates
  cert + key to an ATECC608A or similar. The kit uses flash storage.
- **OTA** — no rollback, no signature verification. Add `esp-idf-svc::ota`
  + the AWS IoT Jobs flow when you need it.
- **Sleep states** — kit firmware runs at full power. Real
  battery-powered firmware uses light-sleep between publishes.
- **Real sensor reads** — `build_event()` returns plausible synthetic
  values. Replace with actual ADC / I²C / SPI reads for your hardware.

Each of those gaps is its own engineering project. The kit is the
starting line.
