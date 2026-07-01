# Backend — AWS Infrastructure SDD (CDK)

## Scope

Defines the complete AWS CDK stack: all resource definitions, IAM policies, environment variables, and deployment configuration. The CDK app is the single source of truth for all cloud infrastructure.

---

## Project Layout

```
infra/
  bin/
    app.ts                  # CDK App entry point
  lib/
    tabbywebrtc-stack.ts       # Main stack
    constructs/
      websocket-api.ts      # API Gateway WebSocket + routes
      lambda-functions.ts   # All Lambda definitions
      dynamodb-tables.ts    # All DynamoDB tables
      iam-roles.ts          # Execution roles + policies
  lambda/
    src/
      connect.ts
      disconnect.ts
      router.ts
      handlers/
        auth.ts
        signal.ts
        agent.ts
        turn.ts
  package.json
  cdk.json
  tsconfig.json
```

---

## CDK Stack: `TabbyWebRTCStack`

### DynamoDB Tables

```ts
const connectionsTable = new Table(this, 'ConnectionsTable', {
  tableName: 'tabbywebrtc-connections',
  partitionKey: { name: 'connectionId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'TTL',
  removalPolicy: RemovalPolicy.DESTROY,
})
connectionsTable.addGlobalSecondaryIndex({
  indexName: 'userId-index',
  partitionKey: { name: 'userId', type: AttributeType.STRING },
  projectionType: ProjectionType.ALL,
})
connectionsTable.addGlobalSecondaryIndex({
  indexName: 'agentId-index',
  partitionKey: { name: 'agentId', type: AttributeType.STRING },
  projectionType: ProjectionType.ALL,
})

const pendingSessionsTable = new Table(this, 'PendingSessionsTable', {
  tableName: 'tabbywebrtc-pending-sessions',
  partitionKey: { name: 'pendingSessionId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'expiresAt',
  removalPolicy: RemovalPolicy.DESTROY,
})

const agentsTable = new Table(this, 'AgentsTable', {
  tableName: 'tabbywebrtc-agents',
  partitionKey: { name: 'agentId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY,
})
agentsTable.addGlobalSecondaryIndex({
  indexName: 'userId-index',
  partitionKey: { name: 'userId', type: AttributeType.STRING },
  projectionType: ProjectionType.ALL,
})

const sourceLocksTable = new Table(this, 'SourceLocksTable', {
  tableName: 'tabbywebrtc-source-locks',
  partitionKey: { name: 'sourceId', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'TTL',
  removalPolicy: RemovalPolicy.DESTROY,
})
```

### Lambda Execution Role

```ts
const lambdaRole = new Role(this, 'LambdaRole', {
  assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
  managedPolicies: [
    ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
  ],
})

connectionsTable.grantReadWriteData(lambdaRole)
pendingSessionsTable.grantReadWriteData(lambdaRole)
agentsTable.grantReadWriteData(lambdaRole)
sourceLocksTable.grantReadWriteData(lambdaRole)
```

Execute-API permission (for `PostToConnection`) is added after the API is created:

```ts
lambdaRole.addToPolicy(new PolicyStatement({
  actions: ['execute-api:ManageConnections'],
  resources: [`arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/*`],
}))
```

### Lambda Functions

All Lambdas share a single bundled asset (esbuild via `NodejsFunction`).

```ts
const commonEnv = {
  CONNECTIONS_TABLE: connectionsTable.tableName,
  PENDING_SESSIONS_TABLE: pendingSessionsTable.tableName,
  AGENTS_TABLE: agentsTable.tableName,
  SOURCE_LOCKS_TABLE: sourceLocksTable.tableName,
  CLERK_JWKS_URL: process.env.CLERK_JWKS_URL!,
  TURN_SECRET: process.env.TURN_SECRET!,
  TURN_URLS: process.env.TURN_URLS!,
}

const wsHandlerFn = new NodejsFunction(this, 'WsHandler', {
  entry: 'lambda/src/router.ts',
  handler: 'handler',
  runtime: Runtime.NODEJS_22_X,
  architecture: Architecture.ARM_64,
  memorySize: 128,
  timeout: Duration.seconds(10),
  role: lambdaRole,
  environment: { ...commonEnv, WS_CALLBACK_URL: '' },
  bundling: { minify: true, sourceMap: false },
})

const turnFn = new NodejsFunction(this, 'TurnCredentials', {
  entry: 'lambda/src/handlers/turn.ts',
  handler: 'handler',
  runtime: Runtime.NODEJS_22_X,
  architecture: Architecture.ARM_64,
  memorySize: 128,
  timeout: Duration.seconds(5),
  role: lambdaRole,
  environment: commonEnv,
  bundling: { minify: true, sourceMap: false },
})
```

After WebSocket API creation, patch `WS_CALLBACK_URL` into the Lambda environment:

```ts
wsHandlerFn.addEnvironment(
  'WS_CALLBACK_URL',
  `https://${wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`
)
```

### API Gateway WebSocket API

```ts
const wsApi = new WebSocketApi(this, 'WsApi', {
  apiName: 'tabbywebrtc-signaling',
  connectRouteOptions: {
    integration: new WebSocketLambdaIntegration('ConnectIntegration', wsHandlerFn),
  },
  disconnectRouteOptions: {
    integration: new WebSocketLambdaIntegration('DisconnectIntegration', wsHandlerFn),
  },
  defaultRouteOptions: {
    integration: new WebSocketLambdaIntegration('DefaultIntegration', wsHandlerFn),
  },
})

const wsStage = new WebSocketStage(this, 'WsStage', {
  webSocketApi: wsApi,
  stageName: 'prod',
  autoDeploy: true,
})
```

### REST API for TURN Credentials

```ts
const restApi = new RestApi(this, 'RestApi', {
  restApiName: 'tabbywebrtc-rest',
  defaultCorsPreflightOptions: {
    allowOrigins: Cors.ALL_ORIGINS,
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['Authorization'],
  },
})

const turnResource = restApi.root.addResource('turn-credentials')
turnResource.addMethod('GET', new LambdaIntegration(turnFn), {
  authorizationType: AuthorizationType.NONE,
})
```

---

## Environment Variables (SSM / GitHub Secrets)

| Variable | Source | Description |
|---|---|---|
| `CLERK_JWKS_URL` | GitHub Secret | Clerk public JWKS endpoint |
| `TURN_SECRET` | GitHub Secret | HMAC secret for TURN credential generation |
| `TURN_URLS` | GitHub Secret | Comma-separated CoTURN TURN URLs |

Passed to CDK deploy via `--context` flags or environment variables in the CI pipeline.

---

## Stack Outputs

```ts
new CfnOutput(this, 'WsEndpoint', { value: wsStage.url })
new CfnOutput(this, 'RestEndpoint', { value: restApi.url })
```

These outputs are consumed by the frontend build process to inject the correct API URLs.

---

## Multi-Environment Strategy

| Environment | Stack Suffix | AWS Account | Domain |
|---|---|---|---|
| `dev` | `TabbyWebRTCDev` | Same account | `dev.signal.tabbywebrtc.com` |
| `prod` | `TabbyWebRTCProd` | Same account | `signal.tabbywebrtc.com` |

Environment is selected by passing `--context env=dev` or `--context env=prod` to `cdk deploy`.
