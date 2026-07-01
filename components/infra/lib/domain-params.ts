const ROOT_DOMAIN = 'mikewheeler.dev';

export type EnvName = 'dev' | 'prod';

export function webDomain(envName: EnvName): string {
  return envName === 'prod'
    ? `tabbywebrtc.${ROOT_DOMAIN}`
    : `dev-tabbywebrtc.${ROOT_DOMAIN}`;
}

export function dnsRecordName(envName: EnvName): string {
  return envName === 'prod' ? 'tabbywebrtc' : 'dev-tabbywebrtc';
}
