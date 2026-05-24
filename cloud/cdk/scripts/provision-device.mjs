#!/usr/bin/env node
// Device provisioning — closes the one gap CloudFormation can't: minting an
// X.509 device identity and getting its private key onto this machine so the
// simulator (and, later, real firmware) can authenticate to AWS IoT Core.
//
// Run AFTER `cdk deploy`, with the same AWS credentials/region. It:
//   1. creates an IoT keys + certificate pair (set active)
//   2. attaches the device policy + the Thing to that certificate
//   3. looks up the account's IoT data endpoint
//   4. writes cert.pem / private.key / endpoint to cloud/cdk/certs/
//   5. prints the exact simulator command to run
//
// Idempotent-ish: refuses to mint a second cert if certs/ is already
// populated unless you pass --force. Tear down with `npm run deprovision`.

import {
  IoTClient,
  CreateKeysAndCertificateCommand,
  AttachPolicyCommand,
  AttachThingPrincipalCommand,
  DescribeEndpointCommand,
} from '@aws-sdk/client-iot';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const THING_NAME  = 'pm-kit-device-1';
const POLICY_NAME = 'pm-kit-device-policy';
const REGION =
  process.env.AWS_REGION ||
  process.env.AWS_DEFAULT_REGION ||
  process.env.CDK_DEFAULT_REGION ||
  'us-east-1';

const here     = dirname(fileURLToPath(import.meta.url));
const CERT_DIR  = join(here, '..', 'certs');
const CERT_PEM  = join(CERT_DIR, 'device.cert.pem');
const KEY_PEM   = join(CERT_DIR, 'device.private.key');
const META_JSON = join(CERT_DIR, 'certificate.json');
const ENDPOINT  = join(CERT_DIR, 'endpoint.txt');

const force = process.argv.includes('--force');

async function main() {
  if (existsSync(CERT_PEM) && !force) {
    console.error(
      `Refusing to mint a new cert: ${CERT_PEM} already exists.\n` +
      `  - To use the existing cert, just run the simulator.\n` +
      `  - To replace it, run \`npm run deprovision\` first, or re-run with --force.`,
    );
    process.exit(1);
  }

  const iot = new IoTClient({ region: REGION });

  console.log(`[1/4] Creating keys + certificate in ${REGION}…`);
  const cert = await iot.send(new CreateKeysAndCertificateCommand({ setAsActive: true }));
  const { certificateArn, certificateId, certificatePem, keyPair } = cert;
  console.log(`      certificateId=${certificateId}`);

  console.log(`[2/4] Attaching policy "${POLICY_NAME}" and Thing "${THING_NAME}"…`);
  await iot.send(new AttachPolicyCommand({ policyName: POLICY_NAME, target: certificateArn }));
  await iot.send(new AttachThingPrincipalCommand({ thingName: THING_NAME, principal: certificateArn }));

  console.log(`[3/4] Looking up IoT data endpoint…`);
  const { endpointAddress } = await iot.send(
    new DescribeEndpointCommand({ endpointType: 'iot:Data-ATS' }),
  );

  console.log(`[4/4] Writing credentials to ${CERT_DIR}…`);
  mkdirSync(CERT_DIR, { recursive: true });
  writeFileSync(CERT_PEM, certificatePem, { mode: 0o600 });
  writeFileSync(KEY_PEM, keyPair.PrivateKey, { mode: 0o600 });
  writeFileSync(ENDPOINT, endpointAddress + '\n');
  writeFileSync(
    META_JSON,
    JSON.stringify({ certificateId, certificateArn, thingName: THING_NAME, region: REGION }, null, 2),
  );

  console.log('\nDone. Device is provisioned and attached.\n');
  console.log('Run the simulator (from device/python/):\n');
  console.log(
    `  python simulator.py \\\n` +
    `    --endpoint ${endpointAddress} \\\n` +
    `    --thing-name ${THING_NAME} \\\n` +
    `    --cert ../../cloud/cdk/certs/device.cert.pem \\\n` +
    `    --key  ../../cloud/cdk/certs/device.private.key \\\n` +
    `    --interval 5`,
  );
}

main().catch((err) => {
  console.error('\nProvisioning failed:', err?.message ?? err);
  process.exit(1);
});
