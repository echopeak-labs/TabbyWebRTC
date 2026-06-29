import { CfnOutput, Stack, StackProps, Tags } from 'aws-cdk-lib';
import {
  AuthorizationType,
  Cors,
  LambdaIntegration,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { DynamoDbTables } from './constructs/dynamodb-tables';
import { FrontendHosting } from './constructs/frontend-hosting';
import { IamRoles } from './constructs/iam-roles';
import { LambdaFunctions } from './constructs/lambda-functions';
import { WebSocketApiConstruct } from './constructs/websocket-api';

export interface TabbyRdpStackProps extends StackProps {
  envName: 'dev' | 'prod';
}

export class TabbyRdpStack extends Stack {
  public readonly tables: DynamoDbTables;
  public readonly roles: IamRoles;

  constructor(scope: Construct, id: string, props: TabbyRdpStackProps) {
    super(scope, id, props);

    Tags.of(this).add('project', 'tabbyrdp');

    this.tables = new DynamoDbTables(this, 'Tables', { envName: props.envName });
    this.roles = new IamRoles(this, 'Roles', { tables: this.tables });

    const lambdas = new LambdaFunctions(this, 'Lambdas', {
      tables: this.tables,
      lambdaRole: this.roles.lambdaRole,
      envName: props.envName,
    });

    const wsApi = new WebSocketApiConstruct(this, 'WebSocketApi', {
      wsHandlerFn: lambdas.wsHandlerFn,
      lambdaRole: this.roles.lambdaRole,
      envName: props.envName,
    });

    const restApi = new RestApi(this, 'RestApi', {
      restApiName: `tabbyrdp-rest-${props.envName}`,
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type'],
      },
    });

    const turnResource = restApi.root.addResource('turn-credentials');
    turnResource.addMethod('GET', new LambdaIntegration(lambdas.turnFn), {
      authorizationType: AuthorizationType.NONE,
    });

    const agentsResource = restApi.root.addResource('agents');
    agentsResource.addMethod('GET', new LambdaIntegration(lambdas.agentFn), {
      authorizationType: AuthorizationType.NONE,
    });

    const pairResource = agentsResource.addResource('pair');
    pairResource.addMethod('POST', new LambdaIntegration(lambdas.agentFn), {
      authorizationType: AuthorizationType.NONE,
    });

    const authResource = restApi.root.addResource('auth');
    const approveResource = authResource.addResource('approve');
    approveResource.addMethod('POST', new LambdaIntegration(lambdas.authFn), {
      authorizationType: AuthorizationType.NONE,
    });

    const updatesResource = restApi.root.addResource('updates');
    const manifestResource = updatesResource.addResource('manifest.json');
    manifestResource.addMethod('GET', new LambdaIntegration(lambdas.updatesFn), {
      authorizationType: AuthorizationType.NONE,
    });

    const downloadsResource = restApi.root.addResource('downloads');
    const platformResource = downloadsResource.addResource('{platform}');
    platformResource.addMethod('GET', new LambdaIntegration(lambdas.updatesFn), {
      authorizationType: AuthorizationType.NONE,
    });

    const frontend = new FrontendHosting(this, 'Frontend', {
      envName: props.envName,
    });

    new CfnOutput(this, 'WebDomain', { value: frontend.webDomainName });
    new CfnOutput(this, 'FrontendBucketName', {
      value: frontend.bucket.bucketName,
    });
    new CfnOutput(this, 'FrontendDistributionId', {
      value: frontend.distribution.distributionId,
    });
    new CfnOutput(this, 'FrontendDistributionDomain', {
      value: frontend.distribution.distributionDomainName,
    });

    new CfnOutput(this, 'WsEndpoint', { value: wsApi.wsStage.url });
    new CfnOutput(this, 'RestEndpoint', { value: restApi.url });
    new CfnOutput(this, 'UpdateManifestUrl', {
      value: `${restApi.url}updates/manifest.json`,
    });
    new CfnOutput(this, 'DownloadBaseUrl', {
      value: `${restApi.url}downloads/`,
    });
  }
}
