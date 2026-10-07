import { describe, expect, it } from 'vitest';
import { findListeningUrl } from './listening-url';

describe('findListeningUrl', () => {
  it('reads the URL ASP.NET, Vite and Next print', () => {
    expect(findListeningUrl('info: Microsoft.Hosting.Lifetime[14]')).toBeNull();
    expect(findListeningUrl('      Now listening on: http://localhost:5080')).toBe('http://localhost:5080/');
    expect(findListeningUrl('  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m')).toBe(
      'http://localhost:5173/',
    );
    expect(findListeningUrl('   - Local:        http://localhost:3000')).toBe('http://localhost:3000/');
  });

  it('turns wildcard hosts into localhost and keeps loopback addresses', () => {
    expect(findListeningUrl('Now listening on: http://0.0.0.0:8080')).toBe('http://localhost:8080/');
    expect(findListeningUrl('Now listening on: http://[::]:8080')).toBe('http://localhost:8080/');
    expect(findListeningUrl('Now listening on: https://+:7001')).toBe('https://localhost:7001/');
    expect(findListeningUrl('Server running at http://127.0.0.1:4000/app.')).toBe('http://127.0.0.1:4000/app');
  });

  it('ignores links to other hosts and URLs without a port', () => {
    expect(findListeningUrl('See https://aka.ms/dotnet-warnings/CS0168 for details')).toBeNull();
    expect(findListeningUrl('Open http://localhost/ in a browser')).toBeNull();
    expect(findListeningUrl('http://localhost:99999')).toBeNull();
  });
});
