import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { Readable } from 'node:stream';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { parseManifest, resolveArtifact } from '../lambda/src/lib/manifest';
import { resetR2ClientForTests } from '../lambda/src/lib/r2';

const s3Mock = mockClient(S3Client);

const sampleManifest = {
  schema_version: 1,
  version: '1.2.3',
  published_at: '2026-06-28T12:00:00Z',
  artifacts: {
    'linux-x86_64': {
      filename: 'tabbywebrtc-agent_1.2.3_amd64.deb',
      sha256: 'abc123',
      size_bytes: 42,
    },
    'linux-aarch64': {
      filename: 'tabbywebrtc-agent_1.2.3_arm64.deb',
      sha256: 'def456',
      size_bytes: 40,
    },
  },
};

function manifestBody(): Readable {
  return Readable.from([Buffer.from(JSON.stringify(sampleManifest))]);
}

function artifactBody(content = 'deb-payload'): Readable {
  return Readable.from([Buffer.from(content)]);
}

function apiEvent(
  overrides: Partial<APIGatewayProxyEvent> & Pick<APIGatewayProxyEvent, 'path'>,
): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    pathParameters: null,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '',
    isBase64Encoded: false,
    body: null,
    ...overrides,
  };
}

let getManifest: () => Promise<APIGatewayProxyResult>;
let downloadArtifact: (platform: string) => Promise<APIGatewayProxyResult>;
let handler: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

beforeAll(async () => {
  process.env.R2_BUCKET = 'tabbywebrtc-releases';
  process.env.R2_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.UPDATE_ENV_PREFIX = 'dev';

  const updates = await import('../lambda/src/handlers/updates');
  getManifest = updates.getManifest;
  downloadArtifact = updates.downloadArtifact;
  handler = (event) =>
    updates.handler(event, {} as never, {} as never) as Promise<APIGatewayProxyResult>;
});

beforeEach(() => {
  s3Mock.reset();
  resetR2ClientForTests();
  process.env.UPDATE_ENV_PREFIX = 'dev';
});

describe('manifest parsing', () => {
  it('parses a valid manifest', () => {
    const manifest = parseManifest(JSON.stringify(sampleManifest));
    expect(manifest).not.toBeNull();
    expect(manifest?.version).toBe('1.2.3');
    expect(manifest?.artifacts['linux-x86_64']?.filename).toBe(
      'tabbywebrtc-agent_1.2.3_amd64.deb',
    );
  });

  it('rejects invalid schema_version', () => {
    expect(
      parseManifest(
        JSON.stringify({
          ...sampleManifest,
          schema_version: 2,
        }),
      ),
    ).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(parseManifest('{not-json')).toBeNull();
  });
});

describe('platform resolution', () => {
  it('resolves known platform keys', () => {
    const manifest = parseManifest(JSON.stringify(sampleManifest))!;
    expect(resolveArtifact(manifest, 'linux-x86_64')?.filename).toBe(
      'tabbywebrtc-agent_1.2.3_amd64.deb',
    );
  });

  it('returns null for unknown platform keys', () => {
    const manifest = parseManifest(JSON.stringify(sampleManifest))!;
    expect(resolveArtifact(manifest, 'unknown-platform')).toBeNull();
  });
});

describe('updates handler', () => {
  it('returns manifest JSON with cache headers', async () => {
    s3Mock.on(GetObjectCommand).resolves({
      Body: manifestBody() as never,
    });

    const result = await getManifest();

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Content-Type']).toBe('application/json');
    expect(result.headers?.['Cache-Control']).toBe('max-age=300');
    expect(JSON.parse(result.body ?? '{}')).toEqual(sampleManifest);
    expect(s3Mock.commandCalls(GetObjectCommand)[0]?.args[0].input.Key).toBe(
      'dev/manifest.json',
    );
  });

  it('returns 404 when manifest is missing', async () => {
    s3Mock.on(GetObjectCommand).rejects({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });

    const result = await getManifest();

    expect(result.statusCode).toBe(404);
  });

  it('streams artifact for a known platform', async () => {
    s3Mock.on(GetObjectCommand).callsFake((input) => {
      if (input.Key === 'dev/manifest.json') {
        return { Body: manifestBody() as never };
      }
      if (input.Key === 'dev/1.2.3/tabbywebrtc-agent_1.2.3_amd64.deb') {
        return { Body: artifactBody('deb-bytes') as never };
      }
      return Promise.reject({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    });

    const result = await downloadArtifact('linux-x86_64');

    expect(result.statusCode).toBe(200);
    expect(result.isBase64Encoded).toBe(true);
    expect(Buffer.from(result.body ?? '', 'base64').toString()).toBe('deb-bytes');
    expect(result.headers?.['Content-Type']).toBe('application/vnd.debian.binary-package');
    expect(result.headers?.['Content-Disposition']).toBe(
      'attachment; filename="tabbywebrtc-agent_1.2.3_amd64.deb"',
    );
    expect(result.headers?.['Content-Length']).toBe('42');
    expect(result.headers?.['X-TabbyWebRTC-Version']).toBe('1.2.3');
    expect(result.headers?.['X-TabbyWebRTC-SHA256']).toBe('abc123');
  });

  it('returns 404 for unknown platform', async () => {
    s3Mock.on(GetObjectCommand).resolves({
      Body: manifestBody() as never,
    });

    const result = await downloadArtifact('unknown-platform');

    expect(result.statusCode).toBe(404);
  });

  it('returns 404 when artifact object is missing', async () => {
    s3Mock.on(GetObjectCommand).callsFake((input) => {
      if (input.Key === 'dev/manifest.json') {
        return { Body: manifestBody() as never };
      }
      return Promise.reject({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    });

    const result = await downloadArtifact('linux-x86_64');

    expect(result.statusCode).toBe(404);
  });

  it('uses prod prefix when UPDATE_ENV_PREFIX is prod', async () => {
    process.env.UPDATE_ENV_PREFIX = 'prod';
    s3Mock.on(GetObjectCommand).resolves({
      Body: manifestBody() as never,
    });

    await getManifest();

    expect(s3Mock.commandCalls(GetObjectCommand)[0]?.args[0].input.Key).toBe(
      'prod/manifest.json',
    );
  });

  it('routes manifest and download paths through handler', async () => {
    s3Mock.on(GetObjectCommand).callsFake((input) => {
      if (input.Key === 'dev/manifest.json') {
        return { Body: manifestBody() as never };
      }
      if (input.Key === 'dev/1.2.3/tabbywebrtc-agent_1.2.3_amd64.deb') {
        return { Body: artifactBody('deb-bytes') as never };
      }
      return Promise.reject({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    });

    const manifestResult = await handler(
      apiEvent({ path: '/updates/manifest.json' }),
    );
    expect(manifestResult.statusCode).toBe(200);

    const downloadResult = await handler(
      apiEvent({
        path: '/downloads/linux-x86_64',
        pathParameters: { platform: 'linux-x86_64' },
      }),
    );
    expect(downloadResult.statusCode).toBe(200);

    const unknownResult = await handler(
      apiEvent({
        path: '/downloads/unknown-platform',
        pathParameters: { platform: 'unknown-platform' },
      }),
    );
    expect(unknownResult.statusCode).toBe(404);
  });
});
