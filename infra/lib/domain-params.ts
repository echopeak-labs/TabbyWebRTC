const ROOT_DOMAIN = 'mikewheeler.dev';

export type EnvName = 'dev' | 'prod';

export function webDomain(envName: EnvName): string {
  return envName === 'prod'
    ? `tabbyrdp.${ROOT_DOMAIN}`
    : `dev-tabbyrdp.${ROOT_DOMAIN}`;
}

export function dnsRecordName(envName: EnvName): string {
  return envName === 'prod' ? 'tabbyrdp' : 'dev-tabbyrdp';
}
