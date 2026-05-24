// Connected Products Starter Kit — CDK infrastructure stack.
//
// Provisions the reference cloud architecture the team I led aligned on:
// an AWS IoT Core Thing + per-device cert, a topic rule that pipes
// telemetry into a Lambda, a DynamoDB table behind the Lambda, and a tiny
// HTTP API the dashboard reads from.
//
// Deliberately minimal — this is the *starting* shape. Teams fork it,
// then evolve toward FleetWise / Greengrass / SiteWise as their scale
// demands.

import * as cdk from 'aws-cdk-lib';
import * as iot from 'aws-cdk-lib/aws-iot';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export class ConnectedProductsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -----------------------------------------------------------------
    // Data store — pay-per-request, TTL after 30 days, GSI for site
    // queries. Right shape for a starter kit; large teams replace with
    // partitioned Parquet on S3 + Athena for analytics.
    // -----------------------------------------------------------------
    const telemetryTable = new ddb.Table(this, 'TelemetryTable', {
      tableName: 'connected-products-telemetry',
      partitionKey: { name: 'thing_name', type: ddb.AttributeType.STRING },
      sortKey:      { name: 'event_ts',   type: ddb.AttributeType.STRING },
      billingMode:  ddb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires_at',
      removalPolicy: cdk.RemovalPolicy.DESTROY,    // starter kit — not a production policy
      pointInTimeRecovery: false,
    });

    telemetryTable.addGlobalSecondaryIndex({
      indexName: 'job_site_index',
      partitionKey: { name: 'job_site_id', type: ddb.AttributeType.STRING },
      sortKey:      { name: 'event_ts',    type: ddb.AttributeType.STRING },
      projectionType: ddb.ProjectionType.ALL,
    });

    // -----------------------------------------------------------------
    // Ingest Lambda — validates the MQTT payload, enriches with server
    // timestamp + TTL, writes to DDB. Node 20 for cold-start headroom.
    // -----------------------------------------------------------------
    const ingestFn = new nodejs.NodejsFunction(this, 'IngestFn', {
      entry: path.join(__dirname, '..', '..', 'lambda', 'src', 'ingest.ts'),
      // Lambda source lives in cloud/lambda (sibling of cloud/cdk), so point
      // the bundler at the repo root and the lambda's own lockfile.
      projectRoot:      path.join(__dirname, '..', '..', '..'),
      depsLockFilePath: path.join(__dirname, '..', '..', 'lambda', 'package-lock.json'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        TELEMETRY_TABLE: telemetryTable.tableName,
        TTL_DAYS:        '30',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        externalModules: ['@aws-sdk/*'],
      },
    });
    telemetryTable.grantWriteData(ingestFn);

    // -----------------------------------------------------------------
    // Query Lambda — reads back the last 100 events per thing for the
    // dashboard. Kept separate from ingest so each Lambda's IAM and
    // memory shape can stay minimal.
    // -----------------------------------------------------------------
    const queryFn = new nodejs.NodejsFunction(this, 'QueryFn', {
      entry: path.join(__dirname, '..', '..', 'lambda', 'src', 'query.ts'),
      projectRoot:      path.join(__dirname, '..', '..', '..'),
      depsLockFilePath: path.join(__dirname, '..', '..', 'lambda', 'package-lock.json'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(5),
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: { TELEMETRY_TABLE: telemetryTable.tableName },
      bundling: { minify: true, target: 'node20' },
    });
    telemetryTable.grantReadData(queryFn);

    // -----------------------------------------------------------------
    // IoT Core — Thing + cert + policy. One Thing for the starter; real
    // fleets use ThingGroups + provisioning templates. Cert lives on
    // disk for the kit; production firmware reads it from the secure
    // element.
    // -----------------------------------------------------------------
    const thing = new iot.CfnThing(this, 'StarterThing', {
      thingName: 'pm-kit-device-1',
    });

    const policy = new iot.CfnPolicy(this, 'DevicePolicy', {
      policyName: 'pm-kit-device-policy',
      policyDocument: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            actions: ['iot:Connect'],
            resources: [`arn:aws:iot:${this.region}:${this.account}:client/${thing.thingName}`],
          }),
          new iam.PolicyStatement({
            actions: ['iot:Publish'],
            resources: [`arn:aws:iot:${this.region}:${this.account}:topic/telemetry/${thing.thingName}`],
          }),
        ],
      }),
    });

    // Topic rule — every message on telemetry/+ goes to the Lambda.
    const rule = new iot.CfnTopicRule(this, 'TelemetryRule', {
      ruleName: 'pm_kit_telemetry_to_lambda',
      topicRulePayload: {
        sql: "SELECT *, topic() AS topic, timestamp() AS server_ts FROM 'telemetry/+'",
        awsIotSqlVersion: '2016-03-23',
        ruleDisabled: false,
        actions: [{ lambda: { functionArn: ingestFn.functionArn } }],
      },
    });
    ingestFn.addPermission('AllowIoTInvoke', {
      principal: new iam.ServicePrincipal('iot.amazonaws.com'),
      sourceArn: rule.attrArn,
    });

    // -----------------------------------------------------------------
    // HTTP API for the dashboard — single route, no auth in the kit.
    // Real deployments terminate behind Cognito or an org SSO.
    // -----------------------------------------------------------------
    const httpApi = new apigw.HttpApi(this, 'DashboardApi', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigw.CorsHttpMethod.GET],
      },
    });
    httpApi.addRoutes({
      path: '/events',
      methods: [apigw.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('QueryIntegration', queryFn),
    });

    // -----------------------------------------------------------------
    // Outputs — printed by `cdk deploy` so the team can wire devices +
    // dashboards without spelunking the AWS console.
    // -----------------------------------------------------------------
    new cdk.CfnOutput(this, 'ThingName',         { value: thing.thingName! });
    new cdk.CfnOutput(this, 'TelemetryTableName', { value: telemetryTable.tableName });
    new cdk.CfnOutput(this, 'DashboardApiUrl',   { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'NextSteps', {
      value: [
        '1. Mint + attach a device cert and fetch the endpoint: npm run provision',
        '2. Run the simulator with the command that command prints.',
        '3. Open the dashboard and point it at the DashboardApiUrl above.',
      ].join(' | '),
    });
  }
}
