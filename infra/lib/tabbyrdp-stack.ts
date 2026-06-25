import { Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DynamoDbTables } from './constructs/dynamodb-tables';
import { IamRoles } from './constructs/iam-roles';

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
  }
}
