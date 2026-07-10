import { Duration, RemovalPolicy, SecretValue } from 'aws-cdk-lib';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { IRole } from 'aws-cdk-lib/aws-iam';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DynamoDbTables } from './dynamodb-tables';

export interface LambdaFunctionsProps {
  tables: DynamoDbTables;
  lambdaRole: IRole;
  envName: 'dev' | 'prod';
}

function envOrPlaceholder(key: string, placeholder: string): string {
  return process.env[key] ?? placeholder;
}

export class LambdaFunctions extends Construct {
  public readonly wsHandlerFn: NodejsFunction;
  public readonly turnFn: NodejsFunction;
  public readonly agentFn: NodejsFunction;
  public readonly authFn: NodejsFunction;
  public readonly updatesFn: NodejsFunction;
  public readonly appSecret: Secret;

  constructor(scope: Construct, id: string, props: LambdaFunctionsProps) {
    super(scope, id);

    this.appSecret = new Secret(this, 'AppSecret', {
      secretName: `tabbywebrtc/${props.envName}/app`,
      description: `TabbyWebRTC runtime secrets (${props.envName})`,
      secretObjectValue: {
        TABBYWEBRTC_JWT_SECRET: SecretValue.unsafePlainText(
          envOrPlaceholder('TABBYWEBRTC_JWT_SECRET', 'placeholder-jwt-secret'),
        ),
        TURN_SECRET: SecretValue.unsafePlainText(
          envOrPlaceholder('TURN_SECRET', 'placeholder-turn-secret'),
        ),
        TURN_URLS: SecretValue.unsafePlainText(
          envOrPlaceholder('TURN_URLS', 'turn:placeholder.example.com:3478'),
        ),
        CLERK_JWKS_URL: SecretValue.unsafePlainText(
          envOrPlaceholder(
            'CLERK_JWKS_URL',
            'https://placeholder.clerk.accounts.dev/.well-known/jwks.json',
          ),
        ),
        CLERK_ISSUER: SecretValue.unsafePlainText(
          envOrPlaceholder('CLERK_ISSUER', 'https://placeholder.clerk.accounts.dev'),
        ),
        R2_BUCKET: SecretValue.unsafePlainText(
          envOrPlaceholder('R2_BUCKET', 'tabbywebrtc-releases'),
        ),
        R2_ENDPOINT: SecretValue.unsafePlainText(
          envOrPlaceholder('R2_ENDPOINT', 'https://placeholder.r2.cloudflarestorage.com'),
        ),
        R2_ACCESS_KEY_ID: SecretValue.unsafePlainText(
          envOrPlaceholder('R2_ACCESS_KEY_ID', 'placeholder'),
        ),
        R2_SECRET_ACCESS_KEY: SecretValue.unsafePlainText(
          envOrPlaceholder('R2_SECRET_ACCESS_KEY', 'placeholder'),
        ),
      },
      removalPolicy:
        props.envName === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    this.appSecret.grantRead(props.lambdaRole);

    const commonEnv = {
      CONNECTIONS_TABLE: props.tables.connectionsTable.tableName,
      PENDING_SESSIONS_TABLE: props.tables.pendingSessionsTable.tableName,
      AGENTS_TABLE: props.tables.agentsTable.tableName,
      SOURCE_LOCKS_TABLE: props.tables.sourceLocksTable.tableName,
      APP_SECRET_ARN: this.appSecret.secretArn,
      REQUIRE_ENCRYPTED_SALT: process.env.REQUIRE_ENCRYPTED_SALT ?? 'false',
    };

    const bundling = { minify: true, sourceMap: false };

    this.wsHandlerFn = new NodejsFunction(this, 'WsHandler', {
      entry: 'lambda/src/router.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.seconds(10),
      role: props.lambdaRole,
      environment: { ...commonEnv, WS_CALLBACK_URL: '' },
      bundling,
    });

    this.turnFn = new NodejsFunction(this, 'TurnCredentials', {
      entry: 'lambda/src/handlers/turn.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.seconds(5),
      role: props.lambdaRole,
      environment: commonEnv,
      bundling,
    });

    this.agentFn = new NodejsFunction(this, 'AgentHandler', {
      entry: 'lambda/src/handlers/agent.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.seconds(10),
      role: props.lambdaRole,
      environment: commonEnv,
      bundling,
    });

    this.authFn = new NodejsFunction(this, 'AuthHandler', {
      entry: 'lambda/src/handlers/auth.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.seconds(10),
      role: props.lambdaRole,
      environment: commonEnv,
      bundling,
    });

    this.updatesFn = new NodejsFunction(this, 'UpdatesHandler', {
      entry: 'lambda/src/handlers/updates.ts',
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(30),
      role: props.lambdaRole,
      environment: {
        APP_SECRET_ARN: this.appSecret.secretArn,
        UPDATE_ENV_PREFIX: props.envName,
      },
      bundling,
    });

    Tags.of(this).add('project', 'tabbywebrtc');
  }
}
