import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local stand-in for claude.ai's Design canvases (the AL-190 fake-site pattern). Start the app with
 * `AGENT_LANES_DESIGN_TEST_ORIGIN` set to `origin`: canvas links still name claude.ai, and the view
 * loads the same path here. claude.ai itself is never contacted.
 *
 * - `/design/p/<id>`: a canvas page that says its id;
 * - `/design/p/signed-out`: redirects to `/login`, as claude.ai does without a session.
 */
export async function startFakeClaudeSite(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    const html = (body: string) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY' });
      response.end(body);
    };
    if (path === '/design/p/signed-out') {
      response.writeHead(302, { Location: '/login?returnTo=%2Fdesign%2Fp%2Fsigned-out' });
      response.end();
      return;
    }
    if (path === '/login') return html('<!doctype html><title>Sign in</title><p>sign in</p>');
    const canvas = /^\/design\/p\/([\w-]+)$/.exec(path);
    if (canvas) return html(`<!doctype html><title>Canvas ${canvas[1]}</title><p id="canvas">${canvas[1]}</p>`);
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
