import { Duration, RemovalPolicy, Tags } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { EnvName, webDomain } from '../domain-params';

export interface FrontendHostingProps {
  envName: EnvName;
}

export class FrontendHosting extends Construct {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly webDomainName: string;

  constructor(scope: Construct, id: string, props: FrontendHostingProps) {
    super(scope, id);

    this.webDomainName = webDomain(props.envName);

    const certificateArn = process.env.ACM_CERTIFICATE_ARN;
    if (!certificateArn) {
      throw new Error('ACM_CERTIFICATE_ARN environment variable is required');
    }

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'WebCertificate',
      certificateArn,
    );

    this.bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: `tabbyrdp-web-${props.envName}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: [`https://${this.webDomainName}`],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
    });

    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI');
    this.bucket.grantRead(oai);

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessIdentity(this.bucket, {
          originAccessIdentity: oai,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
      ],
      domainNames: [this.webDomainName],
      certificate,
    });

    Tags.of(this).add('project', 'tabbyrdp');
  }
}
