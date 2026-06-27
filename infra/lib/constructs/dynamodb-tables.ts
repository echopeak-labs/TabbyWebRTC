import {
  AttributeType,
  BillingMode,
  ProjectionType,
  Table,
} from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface DynamoDbTablesProps {
  envName: string;
}

export class DynamoDbTables extends Construct {
  public readonly connectionsTable: Table;
  public readonly pendingSessionsTable: Table;
  public readonly agentsTable: Table;
  public readonly sourceLocksTable: Table;

  constructor(scope: Construct, id: string, props: DynamoDbTablesProps) {
    super(scope, id);

    const suffix = props.envName;

    this.connectionsTable = new Table(this, 'ConnectionsTable', {
      tableName: `tabbyrdp-connections-${suffix}`,
      partitionKey: { name: 'connectionId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'TTL',
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'agentId-index',
      partitionKey: { name: 'agentId', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.pendingSessionsTable = new Table(this, 'PendingSessionsTable', {
      tableName: `tabbyrdp-pending-sessions-${suffix}`,
      partitionKey: { name: 'pendingSessionId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.agentsTable = new Table(this, 'AgentsTable', {
      tableName: `tabbyrdp-agents-${suffix}`,
      partitionKey: { name: 'agentId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'TTL',
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.agentsTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: { name: 'userId', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.sourceLocksTable = new Table(this, 'SourceLocksTable', {
      tableName: `tabbyrdp-source-locks-${suffix}`,
      partitionKey: { name: 'sourceId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'TTL',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    Tags.of(this).add('project', 'tabbyrdp');
  }
}
