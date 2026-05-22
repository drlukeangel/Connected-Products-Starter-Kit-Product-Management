# Connected Product Decision Rubric

The five questions you answer *before* you pick a wireless protocol,
a cloud, a microcontroller, or anything else. Answer these in order —
later choices depend on earlier ones.

---

## 1. How far is the device from the nearest gateway, phone, or router?

The single biggest input to the wireless decision. Round-trip distance
in the worst case, not the average case.

| Distance | Likely choice |
| --- | --- |
| ≤ 30m, line-of-sight | **Bluetooth Low Energy (BLE)** to a phone or hub |
| ≤ 100m indoor, no walls | **Wi-Fi** if router exists; BLE mesh otherwise |
| 100m – 10km outdoor | **LoRa / LoRaWAN** |
| Truly anywhere | **Cellular** (LTE-M / NB-IoT for low data, 4G for high) |
| Truly anywhere + low cost + low data | **LPWAN** (Sigfox, NB-IoT) |

## 2. How often does it need to phone home?

Frequency × payload size = bandwidth need × power draw. Both go up
linearly; battery life goes down exponentially.

| Cadence | Wireless option survives? |
| --- | --- |
| Once per hour, small payload | BLE, LoRa, NB-IoT all fine |
| Once per minute, small payload | BLE/Wi-Fi/cellular fine; LoRa marginal |
| Once per second | Wi-Fi or cellular; LoRa is out |
| Real-time / event-driven | Wi-Fi or cellular with sticky connection |

If your spec says "real-time" and your power budget is "two AA
batteries for a year," the spec is wrong. Renegotiate before you pick a
chip.

## 3. What's the BOM-cost budget per device?

Per-unit cost dominates feasibility at scale. Round numbers (2026):

| Component | Approx BOM cost |
| --- | --- |
| ESP32-C3 module | $1.50 – $3 |
| LoRa module (RAK / Murata) | $7 – $12 |
| Cellular LTE-M module | $12 – $25 |
| GPS module (u-blox) | $4 – $8 |
| Cellular eSIM + data plan (per year) | $5 – $20 |
| Certs + provisioning (cloud cost amortized) | < $0.50 |

A $40 device with cellular + GPS eats most of its BOM on radios. A $40
device with BLE has $35 left for everything else. The radio choice
locks the rest of the BOM.

## 4. What's the power budget?

Three flavors, very different design constraints:

- **Wall-powered** — anything goes. Wi-Fi, cellular always-on, frequent
  polling — no problem.
- **Battery, replaceable, year+ lifetime** — sub-1mA average draw. BLE
  advertising, LoRa with long intervals, NB-IoT PSM mode. Aggressive
  sleep states; no Wi-Fi.
- **Energy-harvest (solar / kinetic)** — sub-100μA average. Backscatter
  protocols, beacon-only, no acknowledgments. Real engineering problem.

The power budget often forces the wireless choice retroactively. A
year-on-two-AAs spec rules out Wi-Fi before any other constraint kicks
in.

## 5. What's the security model the buyer requires?

Construction sites, industrial floors, hospitals, and consumer homes
have wildly different threat models. Three rough tiers:

- **Consumer / unmanaged network** — cert per device, TLS to cloud,
  no on-device secrets beyond the cert. Cloud handles auth.
- **Commercial / managed network** — add device attestation (TPM or
  secure element), cert rotation, on-device anti-tamper.
- **Industrial / regulated** — everything above + Device Defender or
  equivalent fleet behavior monitoring, hardware secure element
  (ATECC608, NXP A71CH), and the ability to revoke a single device
  in < 60 seconds.

Tier 2 and 3 add real BOM cost ($1.50 – $5 per device for the secure
element). If the buyer is regulated and your BOM doesn't include this,
you have a problem before you ship.

---

## Worked example: a connected power tool

Pretend we're scoping a connected impact driver:

| Question | Answer | Implication |
| --- | --- | --- |
| 1. Distance? | ≤ 30m to the operator's phone, sometimes 200m to a job-site gateway | **BLE** to phone *and* **LoRa** to gateway — dual radio |
| 2. Cadence? | Telemetry every 10 min, event-driven for errors | Both BLE and LoRa survive |
| 3. BOM budget? | $8 for radios on a $300 tool | Within range; LoRa pricey but acceptable |
| 4. Power budget? | Tool's own 20V battery — no concern | All options open |
| 5. Security? | Commercial — fleet-managed by construction company | Add secure element ($2 BOM), cert per tool, anti-tamper |

End result: BLE + LoRa dual radio, secure element, fleet management
via IoT Core + Thing Groups. The five questions did the work.

---

## The rubric is the post

Hand this page to a hardware PM in their first month and you save them
a quarter of bad meetings. Print it. Tape it next to your monitor.
