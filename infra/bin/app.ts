#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TabbyWebRtcStack } from '../lib/tabbywebrtc-stack';

const app = new cdk.App();
const envName = app.node.tryGetContext('env') ?? 'dev';

if (envName !== 'dev' && envName !== 'prod') {
  throw new Error('Context "env" must be "dev" or "prod"');
}

const stackId = envName === 'dev' ? 'TabbyWebRTCDev' : 'TabbyWebRTCProd';
const AWS_REGION = 'us-east-1';

new TabbyWebRtcStack(app, stackId, {
  envName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: AWS_REGION,
  },
});
