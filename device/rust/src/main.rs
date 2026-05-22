// Production-shaped device firmware for the Connected Products Starter Kit.
//
// Targets ESP32-C3. Connects to Wi-Fi, then to AWS IoT Core over MQTT/TLS,
// then publishes synthetic tool-telemetry events every TELEMETRY_INTERVAL_S
// seconds with the same payload shape as device/python/simulator.py.
//
// In a real product the secrets below come from NVS, not source. They're
// shown here as constants for clarity; replace with read-from-flash before
// flashing anything that leaves your desk.

#![allow(unused_imports)]

use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use embedded_svc::mqtt::client::{Event, EventPayload, QoS};
use esp_idf_hal::peripherals::Peripherals;
use esp_idf_svc::eventloop::EspSystemEventLoop;
use esp_idf_svc::mqtt::client::{EspMqttClient, MqttClientConfiguration};
use esp_idf_svc::nvs::EspDefaultNvsPartition;
use esp_idf_svc::wifi::{BlockingWifi, ClientConfiguration, Configuration, EspWifi};
use log::*;
use serde::Serialize;

// --- Configuration (in production these live in NVS / secure element) ----

const WIFI_SSID: &str = "REPLACE_WITH_YOUR_SSID";
const WIFI_PSK:  &str = "REPLACE_WITH_YOUR_PSK";

// AWS IoT Core ATS endpoint, e.g. "xxxx-ats.iot.us-east-1.amazonaws.com"
const IOT_ENDPOINT: &str = "REPLACE_WITH_YOUR_ENDPOINT";

// Thing name = MQTT client ID = part of the publish topic
const THING_NAME: &str = "pm-kit-device-1";

// Embedded as static bytes in the firmware. In production these go in the
// secure element (ATECC608A on a real DEWALT-style tool).
const ROOT_CA:    &[u8] = include_bytes!("../certs/AmazonRootCA1.pem");
const DEVICE_CRT: &[u8] = include_bytes!("../certs/device.cert.pem");
const DEVICE_KEY: &[u8] = include_bytes!("../certs/device.private.key");

const TELEMETRY_INTERVAL_S: u64 = 10;

// --- Payload shape (mirrors Python simulator) -----------------------------

#[derive(Serialize)]
struct TelemetryEvent<'a> {
    event_id:         String,
    event_ts:         String,
    thing_name:       &'a str,
    tool_model:       &'a str,
    tool_model_name:  &'a str,
    firmware_version: &'a str,
    job_site_id:      &'a str,
    gps_lat:          f64,
    gps_lon:          f64,
    battery_pct:      u8,
    torque_nm:        f64,
    usage_minutes:    u16,
    error_code:       &'a str,
}

fn iso8601_now() -> String {
    // The ESP-IDF clock is synced via SNTP after Wi-Fi associates.
    // For the kit, a coarse RFC3339-ish format is enough.
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Very minimal — production firmware would use `time::format_description::well_known::Rfc3339`.
    let days = secs / 86_400;
    let hh = (secs % 86_400) / 3_600;
    let mm = (secs % 3_600) / 60;
    let ss = secs % 60;
    format!("1970-01-01T{:02}:{:02}:{:02}Z (+{}d)", hh, mm, ss, days)
}

fn build_event() -> TelemetryEvent<'static> {
    // Pseudo-random selection. Real firmware reads the actual sensors here.
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let battery = ((now % 96) + 5) as u8;
    let torque  = 2.0 + (now % 9_300) as f64 / 100.0;
    TelemetryEvent {
        event_id:         format!("evt-{:016x}", now.wrapping_mul(0x9E3779B97F4A7C15)),
        event_ts:         iso8601_now(),
        thing_name:       THING_NAME,
        tool_model:       "DCF887",
        tool_model_name:  "20V MAX Impact Driver",
        firmware_version: env!("CARGO_PKG_VERSION"),
        job_site_id:      "JS-001",
        gps_lat:          45.5234,
        gps_lon:          -122.6845,
        battery_pct:      battery,
        torque_nm:        torque,
        usage_minutes:    (now % 241) as u16,
        error_code:       if battery < 15 { "E001_LOW_BATT" } else { "" },
    }
}

// --- Setup helpers --------------------------------------------------------

fn connect_wifi(
    wifi: &mut BlockingWifi<EspWifi<'static>>,
) -> anyhow::Result<()> {
    let cfg = Configuration::Client(ClientConfiguration {
        ssid: WIFI_SSID.try_into().map_err(|_| anyhow::anyhow!("ssid too long"))?,
        password: WIFI_PSK.try_into().map_err(|_| anyhow::anyhow!("psk too long"))?,
        ..Default::default()
    });
    wifi.set_configuration(&cfg)?;
    wifi.start()?;
    wifi.connect()?;
    wifi.wait_netif_up()?;
    info!("Wi-Fi connected: {}", WIFI_SSID);
    Ok(())
}

fn mqtt_url() -> String {
    format!("mqtts://{IOT_ENDPOINT}:8883")
}

// --- Entry point ----------------------------------------------------------

fn main() -> anyhow::Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    info!("connected-product-firmware v{} booting…", env!("CARGO_PKG_VERSION"));

    let peripherals = Peripherals::take()?;
    let sysloop = EspSystemEventLoop::take()?;
    let nvs = EspDefaultNvsPartition::take()?;

    let mut wifi = BlockingWifi::wrap(
        EspWifi::new(peripherals.modem, sysloop.clone(), Some(nvs))?,
        sysloop,
    )?;
    connect_wifi(&mut wifi)?;

    let mqtt_cfg = MqttClientConfiguration {
        client_id: Some(THING_NAME),
        server_certificate: Some(esp_idf_svc::tls::X509::pem_until_nul(ROOT_CA)),
        client_certificate: Some(esp_idf_svc::tls::X509::pem_until_nul(DEVICE_CRT)),
        private_key: Some(esp_idf_svc::tls::X509::pem_until_nul(DEVICE_KEY)),
        keep_alive_interval: Some(Duration::from_secs(30)),
        ..Default::default()
    };

    let (mut client, mut conn) =
        EspMqttClient::new(&mqtt_url(), &mqtt_cfg)?;

    // Connection event loop on its own thread — keeps the main loop
    // free for sensor reads and publishes.
    thread::spawn(move || {
        info!("mqtt connection thread up");
        while let Ok(event) = conn.next() {
            match event.payload() {
                EventPayload::Connected(_) => info!("mqtt: connected"),
                EventPayload::Disconnected => warn!("mqtt: disconnected"),
                EventPayload::Error(e)     => error!("mqtt error: {e}"),
                _ => {}
            }
        }
    });

    let topic = format!("telemetry/{THING_NAME}");
    info!("publishing to {topic} every {TELEMETRY_INTERVAL_S}s");

    loop {
        let event = build_event();
        let payload = serde_json::to_vec(&event)?;
        match client.enqueue(&topic, QoS::AtLeastOnce, false, &payload) {
            Ok(msg_id) => info!("queued msg {msg_id} battery={}%", event.battery_pct),
            Err(e)     => error!("enqueue failed: {e}"),
        }
        thread::sleep(Duration::from_secs(TELEMETRY_INTERVAL_S));
    }
}
