# Architecture

The whole stack, with the decisions called out where they hurt.

```
┌──────────────┐
│   Device     │  Rust on ESP32-C3 (production)  or  Python on laptop (dev)
│              │  Reads sensors → packages JSON → MQTT publish over TLS
└──────┬───────┘
       │ MQTT over TLS, port 8883, mTLS with per-device cert
       │ Topic: telemetry/<thing-name>
       ▼
┌──────────────┐
│  IoT Core    │  Managed MQTT broker. Per-device Thing + Certificate +
│              │  IAM policy. Rule engine matches topic pattern.
└──────┬───────┘
       │ IoT Rule: SELECT *, topic() as topic FROM 'telemetry/+'
       │ Rule action: invoke Lambda
       ▼
┌──────────────┐
│   Lambda     │  TypeScript on Node 20. Validates payload (Zod),
│  (ingest)    │  enriches with server-side timestamp, writes to DDB.
└──────┬───────┘
       │ DDB PutItem, partition key = thing_name, sort key = event_ts
       ▼
┌──────────────┐
│  DynamoDB    │  pay-per-request. TTL on event_ts + 30 days.
│              │  GSI on (job_site_id, event_ts) for site-level queries.
└──────┬───────┘
       │
       │ Dashboard reads via API Gateway → Lambda → DDB Query
       ▼
┌──────────────┐
│   Dashboard  │  Vite + TS. Polls last 100 events / thing. No build needed.
└──────────────┘
```

## Decisions

### Why MQTT and not HTTP?

For telemetry from constrained devices, MQTT wins on three axes:

- **Persistent connection.** No TCP handshake per message — critical
  for battery devices that send every 10 minutes for years.
- **Cleaner pub/sub.** The rule engine routes by topic without the
  device knowing where the data goes.
- **Smaller wire format.** ~14 bytes of overhead vs HTTPS' ~700.

For event-driven *commands* down to the device (rare, urgent, ack
required), MQTT is also better — HTTP would require long-polling or
push.

### Why per-device certs and not API keys?

API keys can be extracted from firmware in 30 seconds with a logic
analyzer. Per-device X.509 certs, baked into a secure element, are the
only thing that stops a fleet-wide credential leak from one bad
device. AWS IoT Core does the heavy lifting; the only thing we add is
the provisioning step.

In the dev stack the cert is on disk for convenience. In production
it goes into the ATECC608A secure element on the board.

### Why DynamoDB and not Timestream / Postgres?

For the *write* side of an IoT pipeline, DDB has the right shape:

- Pay-per-request scales to zero, important for a kit.
- Single-digit-ms PutItem latency, important when Lambda has a 1s budget.
- TTL on items handles retention automatically.

For *analytics* you'd add a Kinesis Firehose → S3 → Athena leg
alongside. Out of scope for the starter kit — that's its own post.

### Why a GSI on (job_site_id, event_ts)?

The dashboard's most expensive query is "show me the last N events for
this site." Without a GSI it's a full table scan. The GSI makes it a
range query; cost goes from O(rows) to O(events_returned).

If you have a dozen sites and a few hundred devices, you don't need
this. At 100+ sites and 10k+ devices, you do.

### Why is the Lambda written in TypeScript and not Python?

Two reasons:

- Cold-start on Node 20 with a small TS bundle is ~80ms; on Python 3.11
  with boto3 it's ~250ms. For ingest Lambdas that fire frequently from
  many devices, the cold-start tax adds up.
- Sharing types between the Lambda and the dashboard — both written in
  TS — means we have *one* canonical telemetry schema, not two that
  drift.

### Why CDK and not Terraform?

CDK lets us co-locate the Lambda code, the IoT topic rule, the DDB
schema, and the IAM policy in one TypeScript program. For a starter
kit that fits in a `cdk deploy`, that's the right ergonomics.

For a multi-account, multi-region production org, Terraform is often
the right answer. Convert when you outgrow CDK's blast radius.

---

## The pieces this kit doesn't address yet

Listed honestly so the gaps are explicit:

- **OTA firmware updates.** AWS IoT Jobs or Greengrass — separate
  starter kit's worth of complexity.
- **Cert rotation.** Per-device certs that rotate quarterly without
  bricking devices. Hard problem; not a starter-kit problem.
- **Edge inference.** Running an ML model on the device for
  anomaly detection. Add Greengrass + SageMaker Edge later.
- **Time-series analytics.** Trend dashboards, alerts, anomaly
  detection. Add Kinesis Firehose → S3 → Athena/QuickSight when you
  have data to analyze.
- **Multi-tenancy.** If buyers are fleet operators with their own
  scoped views, you need IoT Thing Groups + scoped IAM. Not in here.

The starter kit is the smallest useful thing — these gaps are where
real engineering money goes once the kit stops fitting.
