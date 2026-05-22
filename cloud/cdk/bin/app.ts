#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ConnectedProductsStack } from '../lib/connected-products-stack';

const app = new cdk.App();

new ConnectedProductsStack(app, 'ConnectedProductsStarterKit', {
  description: 'Connected Products Starter Kit for Product Managers — IoT Core + Lambda + DynamoDB + minimal HTTP API.',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region:  process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  tags: {
    Project:    'connected-products-starter-kit',
    Owner:      'lukeangel.co',
    CostCenter: 'pm-starter-kits',
  },
});
