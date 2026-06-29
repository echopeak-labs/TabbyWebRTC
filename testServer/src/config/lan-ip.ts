import os from 'node:os';
import { execSync } from 'node:child_process';

export function detectLanIp(override?: string): string {
  if (override) {
    return override;
  }

  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal && net.address !== '127.0.0.1') {
        return net.address;
      }
    }
  }

  try {
    const output = execSync('hostname -I', { encoding: 'utf8' }).trim();
    const first = output.split(/\s+/)[0];
    if (first) {
      return first;
    }
  } catch {
    // ignore
  }

  return '127.0.0.1';
}
