# Connected Products Starter Kit for Product Managers

> A reference architecture I developed while leading engineering teams
> building connected hardware products. Open-sourced as a starting template
> for PMs and engineering leaders running the same playbook.

The kit is **the canonical artifact I hand a new engineering team on day
one** — the rubric they use to choose a wireless stack, the architecture
they align on, and runnable reference code they fork instead of inventing
from scratch.

- **Three runtimes**: a Python simulator (quick start, no hardware needed),
  a Rust embedded variant (production-shaped, ready for ESP32 / Pi Pico W),
  and a TypeScript dashboard.
- **One cloud**: AWS IoT Core → Lambda → DynamoDB, defined in TypeScript CDK.
- **One decision rubric**: the five questions teams answer *before* picking
  BLE vs LoRa vs cellular.
- **One architecture doc**: the diagram a senior leader keeps in their head.

Stack: `typescript (CDK)` · `python (device simulator)` · `rust (embedded)` ·
`typescript (lambda + dashboard)` · `aws iot core / lambda / dynamodb`.

---

## How teams use this

The kit is organized by *audience*. Different roles read different files:

- **Engineering managers** — fork the whole repo as a starting template for
  a new connected-product squad. The CDK stack, Lambda, and device code
  are reference shape you'll evolve, not artifacts you'll keep verbatim.
- **Product managers** — read `docs/rubric.md` and stop there. The rubric
  is the conversation; the rest is implementation detail.
- **Architects** — read `docs/ARCHITECTURE.md`, push back on the trade-offs,
  fork the CDK stack as the basis for the team's real infrastructure.
- **Firmware engineers** — lift `device/rust/` as a known-good MQTT + TLS
  starting point on ESP32-C3, then replace the synthetic sensors with the
  real ones.
- **Cloud engineers** — `cloud/cdk/` is the smallest production-shaped
  IoT-Core-to-DDB stack I know how to write. Lift, adapt, ship.

The repo's job is to **make the first 30 days of a connected-product team
cheaper.** Every engineering team I've led through this stack has hit the
same six pitfalls; the kit and the architecture doc make most of them
avoidable before a single line of code is written.

---

## Why this exists

Every PM I've worked with on connected hardware has run the same first 30
days: they Google "AWS IoT Core tutorial," follow a six-screen wizard, end
up with a single device publishing to MQTT with a hardcoded cert, and have
no idea how to scale it to 10,000 units.

This kit collapses those 30 days into one afternoon. The team clones it,
deploys one CDK stack, chooses either the Python simulator or the Rust
firmware, and watches data show up in the dashboard. Then they read the
rubric and the architecture doc — which is where the real product-management
work lives, and which is the part of the kit that's the same whether you're
building a connected drill or a connected coffee machine.

## What's in the box

| Path                            | Job                                                        |
| ------------------------------- | ---------------------------------------------------------- |
| `device/python/simulator.py`    | Pure-Python MQTT publisher — quick start, no hardware      |
| `device/rust/`                  | Rust embedded firmware — production-shaped, ESP32-ready   |
| `cloud/cdk/`                    | TypeScript CDK stack: IoT Core thing + rule + Lambda + DDB |
| `cloud/lambda/`                 | TypeScript Lambda — ingest + persist                       |
| `dashboard/`                    | TypeScript SPA reading DynamoDB via API Gateway            |
| `docs/ARCHITECTURE.md`          | The diagram + the decisions behind it                      |
| `docs/rubric.md`                | The connected-product decision rubric                      |

That's the kit. Lift any piece and replace it; the seams are clean.

---

## Quick start (Python device, ~10 minutes)

```bash
git clone https://github.com/drlukeangel/Connected-Products-Starter-Kit-Product-Management.git
cd Connected-Products-Starter-Kit-Product-Management

# 1. Deploy the cloud stack (one-time)
cd cloud/cdk
npm install
npx cdk bootstrap        # if you've never used CDK in this account/region
npx cdk deploy

# 2. The deploy prints these outputs you'll need:
#    - ThingName
#    - IoTEndpoint
#    - DashboardApiUrl
# It also writes device certs to ./certs/

# 3. Run the Python simulator pointed at your endpoint
cd ../../device/python
pip install -r requirements.txt
python simulator.py \
  --endpoint <IoTEndpoint> \
  --thing-name <ThingName> \
  --cert ../../cloud/cdk/certs/device.cert.pem \
  --key  ../../cloud/cdk/certs/device.private.key

# 4. Open the dashboard
cd ../../dashboard
npm install && npm run dev
# → http://localhost:5173
```

You should see fake telemetry events streaming into the dashboard within
~5 seconds of starting the simulator.

## Production shape (Rust on ESP32)

The Python simulator is for getting unblocked. The Rust device code is
for the real product:

```bash
cd device/rust
cargo install espup espflash
espup install
. ~/export-esp.sh   # or the equivalent on your shell
cargo run --release
```

Same MQTT messages, same cloud, but now your device fits in a tool
handle and runs for a year on two AA cells. The `Cargo.toml` is set up
for `esp32c3` by default; flip the target for other chips.

## The architecture, in 30 seconds

```
┌──────────┐   MQTT/TLS    ┌────────────┐   Rule    ┌─────────┐   Stream   ┌──────────┐
│  Device  │ ────────────► │  IoT Core  │ ────────► │ Lambda  │ ─────────► │ DynamoDB │
│ (Rust /  │               │            │           │ (TS)    │            │          │
│  Python) │               └────────────┘           └─────────┘            └────┬─────┘
└──────────┘                                                                    │
                                                                                ▼
                                                                          ┌──────────┐
                                                                          │  API GW  │
                                                                          │  + SPA   │
                                                                          └──────────┘
```

Full version with decision-tree commentary in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## The five questions before BLE vs LoRa vs cellular

The rubric in [`docs/rubric.md`](docs/rubric.md) gives you the framework
in one page. Summary:

1. **How far is the device from the nearest gateway / phone / router?**
2. **How often does it need to phone home?**
3. **What's the BOM-cost budget per device?**
4. **What's the power budget — wall power, battery, harvest?**
5. **What's the security model the buyer requires?**

Answer those five, the wireless choice usually picks itself.

---

## What this kit deliberately doesn't do

- **No multi-tenant fleet management.** AWS IoT Core handles single-tenant
  fleets at moderate scale. If you need org-scoped multi-tenancy, look at
  AWS IoT FleetWise or roll your own per-tenant Thing Groups.
- **No OTA firmware updates.** That deserves its own kit; Greengrass v2
  or AWS IoT Jobs are the obvious next step.
- **No certificate rotation.** The CDK stack provisions a single device
  cert. Cert rotation at fleet scale is a separate problem worth a
  dedicated post.
- **No data-engineering / analytics layer.** Pair this with the [PII
  Masking Starter Kit](https://github.com/drlukeangel/PII-Masking-Starter-Kit-Product-Management)
  when telemetry contains operator PII (it usually does).

---

## When you outgrow this

- **AWS IoT FleetWise** — vehicle and equipment fleet management with
  edge-side filtering. Use when you have ≥ 1k devices and per-device
  data volumes that make raw forwarding expensive.
- **AWS IoT Greengrass v2** — push compute to the device. Use when
  latency, bandwidth, or air-gap requirements rule out cloud-only.
- **AWS IoT SiteWise** — industrial telemetry with built-in asset models.
  Use when your devices map to physical assets with hierarchy
  (sites → lines → machines → sensors).
- **AWS IoT Device Defender** — fleet security audits and behavioral
  anomaly detection. Plug it in once you have more than a handful of
  devices.

This kit is the smallest useful thing. Graduate when it stops fitting.

---

## License

MIT.

## Maintainer

Luke Angel · [lukeangel.co](https://lukeangel.co)
