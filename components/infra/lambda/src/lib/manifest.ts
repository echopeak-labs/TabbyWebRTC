export const PLATFORM_KEYS = [
  'linux-x86_64',
  'linux-aarch64',
  'macos-x86_64',
  'macos-aarch64',
  'windows-x86_64',
] as const;

export type PlatformKey = (typeof PLATFORM_KEYS)[number];

export interface ArtifactRecord {
  filename: string;
  sha256: string;
  size_bytes: number;
}

export interface ReleaseManifest {
  schema_version: number;
  version: string;
  published_at: string;
  artifacts: Partial<Record<PlatformKey, ArtifactRecord>>;
}

export function isPlatformKey(key: string): key is PlatformKey {
  return (PLATFORM_KEYS as readonly string[]).includes(key);
}

function isArtifactRecord(value: unknown): value is ArtifactRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.filename === 'string' &&
    typeof record.sha256 === 'string' &&
    typeof record.size_bytes === 'number' &&
    Number.isInteger(record.size_bytes) &&
    record.size_bytes >= 0
  );
}

export function parseManifest(json: string): ReleaseManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const root = parsed as Record<string, unknown>;
  if (
    root.schema_version !== 1 ||
    typeof root.version !== 'string' ||
    typeof root.published_at !== 'string' ||
    !root.artifacts ||
    typeof root.artifacts !== 'object'
  ) {
    return null;
  }

  const artifacts = root.artifacts as Record<string, unknown>;
  const normalized: Partial<Record<PlatformKey, ArtifactRecord>> = {};

  for (const [key, value] of Object.entries(artifacts)) {
    if (!isPlatformKey(key) || !isArtifactRecord(value)) {
      continue;
    }
    normalized[key] = value;
  }

  return {
    schema_version: 1,
    version: root.version,
    published_at: root.published_at,
    artifacts: normalized,
  };
}

export function resolveArtifact(
  manifest: ReleaseManifest,
  platform: string,
): ArtifactRecord | null {
  if (!isPlatformKey(platform)) {
    return null;
  }
  return manifest.artifacts[platform] ?? null;
}

export function contentTypeForFilename(filename: string): string {
  if (filename.endsWith('.deb')) {
    return 'application/vnd.debian.binary-package';
  }
  if (filename.endsWith('.pkg') || filename.endsWith('.msi')) {
    return 'application/octet-stream';
  }
  return 'application/octet-stream';
}
