import { Stack, Tags } from 'aws-cdk-lib';
import {
  WebSocketApi,
  WebSocketStage,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { PolicyStatement, IRole } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export interface WebSocketApiConstructProps {
  wsHandlerFn: NodejsFunction;
  lambdaRole: IRole;
  envName: string;
}

export class WebSocketApiConstruct extends Construct {
  public readonly wsApi: WebSocketApi;
  public readonly wsStage: WebSocketStage;

  constructor(scope: Construct, id: string, props: WebSocketApiConstructProps) {
    super(scope, id);

    this.wsApi = new WebSocketApi(this, 'WsApi', {
      apiName: `tabbywebrtc-signaling-${props.envName}`,
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration('ConnectIntegration', props.wsHandlerFn),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('DisconnectIntegration', props.wsHandlerFn),
      },
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration('DefaultIntegration', props.wsHandlerFn),
      },
    });

    this.wsStage = new WebSocketStage(this, 'WsStage', {
      webSocketApi: this.wsApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    props.lambdaRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${Stack.of(this).region}:${Stack.of(this).account}:${this.wsApi.apiId}/*`,
        ],
      }),
    );

    props.wsHandlerFn.addEnvironment(
      'WS_CALLBACK_URL',
      `https://${this.wsApi.apiId}.execute-api.${Stack.of(this).region}.amazonaws.com/${this.wsStage.stageName}`,
    );

    Tags.of(this).add('project', 'tabbywebrtc');
  }
}
