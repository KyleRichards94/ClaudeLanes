import { isIP } from 'node:net';

/** `::ffff:10.0.0.12` (an IPv4 client on a dual-stack socket) → `10.0.0.12`. */
export function plainIp(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return (mapped?.[1] ?? address).toLowerCase();
}

function ipv4Octets(ip: string): number[] | null {
  if (isIP(ip) !== 4) return null;
  return ip.split('.').map(Number);
}

export function isLoopbackIp(address: string): boolean {
  const ip = plainIp(address);
  return ip === '::1' || ipv4Octets(ip)?.[0] === 127;
}

/** RFC 1918, IPv4 link-local, IPv6 unique-local and link-local: what an office LAN uses (PL§7). */
export function isPrivateIp(address: string): boolean {
  const ip = plainIp(address);
  const v4 = ipv4Octets(ip);
  if (v4) {
    const [a = 0, b = 0] = v4;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIP(ip) !== 6) return false;
  return /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
}

export function isLoopbackHost(host: string): boolean {
  return host.toLowerCase() === 'localhost' || isLoopbackIp(host);
}
