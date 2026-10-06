import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isTrustedSenderUrl } from './trusted-sender';

const rendererFile = process.platform === 'win32' ? 'C:\\Apps\\Agent Lanes\\out\\renderer\\index.html' : '/opt/agent-lanes/out/renderer/index.html';

describe('isTrustedSenderUrl', () => {
  it('trusts the dev server origin in development', () => {
    expect(isTrustedSenderUrl('http://localhost:5173/', 'http://localhost:5173', rendererFile)).toBe(true);
  });

  it('refuses another origin in development', () => {
    expect(isTrustedSenderUrl('https://claude.ai/design', 'http://localhost:5173', rendererFile)).toBe(false);
  });

  it('trusts the bundled renderer file when packaged', () => {
    expect(isTrustedSenderUrl(pathToFileURL(rendererFile).href, undefined, rendererFile)).toBe(true);
  });

  it('refuses a different local file when packaged', () => {
    const other = rendererFile.replace('index.html', 'evil.html');
    expect(isTrustedSenderUrl(pathToFileURL(other).href, undefined, rendererFile)).toBe(false);
  });

  it('refuses missing or malformed URLs', () => {
    expect(isTrustedSenderUrl(undefined, undefined, rendererFile)).toBe(false);
    expect(isTrustedSenderUrl('not a url', undefined, rendererFile)).toBe(false);
  });
});
