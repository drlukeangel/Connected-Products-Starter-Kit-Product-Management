#!/usr/bin/env node
// Tear down the device identity created by provision-device.mjs. Run this
// BEFORE `cdk destroy` — a certificate that's still attached to a policy or
// Thing can't be deleted, and CloudFormation doesn't know the cert exists
// (we minted it out-of-band), so it won't clean it up for you.

import {
  IoTClient,
  DetachPolicyCommand,
  DetachThingPrincipalCommand,
  UpdateCertificateCommand,
  DeleteCertificateCommand,
} from '@aws-sdk/client-iot';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY_NAME = 'pm-kit-device-policy';
const here    = dirname(fileURLToPath(import.meta.url));
const CERT_DIR = join(here, '..', 'certs');
const META_JSON = join(CERT_DIR, 'certificate.json');

async function main() {
  if (!existsSync(META_JSON)) {
    console.error(`No ${META_JSON} found — nothing to deprovision.`);
    process.exit(0);
  }
  const { certificateId, certificateArn, thingName, region } = JSON.parse(
    readFileSync(META_JSON, 'utf8'),
  );
  const iot = new IoTClient({ region });

  // Detach + deactivate + delete. Swallow "already gone" errors so the
  // script is safe to re-run.
  const step = async (label, fn) => {
    try { await fn(); console.log(`  ok: ${label}`); }
    catch (e) { console.log(`  skip: ${label} (${e.name ?? e.message})`); }
  };

  console.log(`Tearing down cert ${certificateId} in ${region}…`);
  await step('detach policy',  () => iot.send(new DetachPolicyCommand({ policyName: POLICY_NAME, target: certificateArn })));
  await step('detach Thing',   () => iot.send(new DetachThingPrincipalCommand({ thingName, principal: certificateArn })));
  await step('deactivate cert',() => iot.send(new UpdateCertificateCommand({ certificateId, newStatus: 'INACTIVE' })));
  await step('delete cert',    () => iot.send(new DeleteCertificateCommand({ certificateId, forceDelete: true })));

  rmSync(CERT_DIR, { recursive: true, force: true });
  console.log('\nDone. Cert deleted and local certs/ removed. Safe to `cdk destroy`.');
}

main().catch((err) => {
  console.error('\nDeprovision failed:', err?.message ?? err);
  process.exit(1);
});
