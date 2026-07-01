import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DynamoDbTables } from './dynamodb-tables';

export interface IamRolesProps {
  tables: DynamoDbTables;
}

export class IamRoles extends Construct {
  public readonly lambdaRole: Role;

  constructor(scope: Construct, id: string, props: IamRolesProps) {
    super(scope, id);

    this.lambdaRole = new Role(this, 'LambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    props.tables.connectionsTable.grantReadWriteData(this.lambdaRole);
    props.tables.pendingSessionsTable.grantReadWriteData(this.lambdaRole);
    props.tables.agentsTable.grantReadWriteData(this.lambdaRole);
    props.tables.sourceLocksTable.grantReadWriteData(this.lambdaRole);

    Tags.of(this).add('project', 'tabbywebrtc');
  }
}
