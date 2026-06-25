#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TabbyRdpStack } from '../lib/tabbyrdp-stack';

const app = new cdk.App();
const envName = app.node.tryGetContext('env') ?? 'dev';

if (envName !== 'dev' && envName !== 'prod') {
  throw new Error('Context "env" must be "dev" or "prod"');
}

const stackId = envName === 'dev' ? 'TabbyRDPDev' : 'TabbyRDPProd';

new TabbyRdpStack(app, stackId, {
  envName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
