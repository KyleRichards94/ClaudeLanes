import { describe, expect, it } from 'vitest';
import { isLoopbackHost, isLoopbackIp, isPrivateIp, plainIp } from './addresses';

describe('peer addresses', () => {
  it('reads an IPv4 client on a dual-stack socket as IPv4', () => {
    expect(plainIp('::ffff:10.0.0.12')).toBe('10.0.0.12');
    expect(plainIp('FE80::1')).toBe('fe80::1');
  });

  it.each(['10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.1.20', '169.254.10.1', '::ffff:192.168.0.5', 'fd12:3456::1', 'fe80::1'])('treats %s as private', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', '127.0.0.1', '::1', '2001:4860::8888', 'KYLE-PC', ''])('treats %s as not private', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });

  it('knows loopback addresses and names', () => {
    expect(isLoopbackIp('127.0.0.1')).toBe(true);
    expect(isLoopbackIp('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackIp('::1')).toBe(true);
    expect(isLoopbackIp('10.0.0.1')).toBe(false);
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('KYLE-PC')).toBe(false);
  });
});
