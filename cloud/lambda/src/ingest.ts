// Ingest Lambda — invoked by the IoT Core topic rule on every MQTT
// publish to telemetry/+. Validates the payload, enriches with server
// metadata, writes to DynamoDB.
//
// Reference shape for the engineering team. Real deployments add:
//   - dead-letter queue for malformed payloads
//   - structured logging (Powertools for AWS)
//   - per-thing rate limiting
//   - schema-version negotiation

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { TelemetryEvent, type TelemetryRecord } from './schema';

const TABLE   = process.env.TELEMETRY_TABLE!;
const TTL_DAYS = Number(process.env.TTL_DAYS ?? 30);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface IoTRuleEvent extends Record<string, unknown> {
  topic?: string;
  server_ts?: number;
}

export async function handler(event: IoTRuleEvent): Promise<{ ok: boolean; reason?: string }> {
  // The IoT rule SELECT * inlines all device fields onto the event object;
  // `topic` and `server_ts` come from `topic()` / `timestamp()`.
  const parsed = TelemetryEvent.safeParse(event);
  if (!parsed.success) {
    console.warn('rejected payload', { issues: parsed.error.flatten(), event });
    return { ok: false, reason: 'schema_violation' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const record: TelemetryRecord = {
    ...parsed.data,
    server_ts:  new Date().toISOString(),
    expires_at: nowSec + TTL_DAYS * 86_400,
  };

  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: record,
  }));

  console.log('stored', {
    thing_name: record.thing_name,
    event_id:   record.event_id,
    battery:    record.battery_pct,
  });
  return { ok: true };
}
