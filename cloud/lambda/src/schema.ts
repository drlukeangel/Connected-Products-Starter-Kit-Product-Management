// Canonical telemetry schema. Imported by both ingest.ts and query.ts
// so we have one source of truth — schema drift between Lambdas is one
// of the IoT failure modes the kit's architecture doc explicitly warns
// against.

import { z } from 'zod';

export const TelemetryEvent = z.object({
  event_id:         z.string().min(1),
  event_ts:         z.string().min(1),
  thing_name:       z.string().min(1),
  tool_model:       z.string(),
  tool_model_name:  z.string().optional(),
  firmware_version: z.string(),
  job_site_id:      z.string(),
  gps_lat:          z.number(),
  gps_lon:          z.number(),
  battery_pct:      z.number().int().min(0).max(100),
  torque_nm:        z.number(),
  usage_minutes:    z.number().int().min(0),
  error_code:       z.string().optional().default(''),
});

export type TelemetryEvent = z.infer<typeof TelemetryEvent>;

// Server-augmented record actually written to DDB
export interface TelemetryRecord extends TelemetryEvent {
  server_ts: string;
  expires_at: number;   // epoch seconds — DDB TTL
}
