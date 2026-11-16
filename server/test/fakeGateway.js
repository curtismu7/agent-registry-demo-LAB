// A fake Privilege MCP door on a loopback port, for the Real trace tests. It is not the gateway: it answers initialize,
// notifications/initialized, tools/list and tools/call at /<app>/mcp, accepts one agent key (built by the test at run time), and
// refuses every tool call with a bare 403 the way a door with no grant does. behaviour 'bad-key' answers 401 on every call.
import http from 'node:http';

export const SESSION_ID = 'fake-mcp-session-0001';

export async function startFakeGateway({ key, behaviour = 'ok' } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let rpc = null; try { rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { rpc = null; }
      seen.push({ method: req.method, url: req.url, headers: req.headers, rpc });
      const reply = (status, obj, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(obj === undefined ? '' : typeof obj === 'string' ? obj : JSON.stringify(obj)); };
      if (req.method === 'DELETE') return reply(204);
      if (req.method !== 'POST' || !/^\/[a-z0-9-]+\/mcp$/.test(req.url) || !rpc) return reply(404, { error: 'not_found' });
      if (behaviour === 'bad-key' || req.headers.authorization !== `Bearer ${key}`) return reply(401, 'Bearer token required', { 'www-authenticate': 'Bearer realm="fake"' });
      if (rpc.method === 'initialize') return reply(200, { jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-door', version: '0' } } }, { 'mcp-session-id': SESSION_ID });
      if (rpc.method === 'notifications/initialized') { res.writeHead(202); res.end(); return undefined; }
      if (rpc.method === 'tools/list') return reply(200, { jsonrpc: '2.0', id: rpc.id, result: { tools: [{ name: 'search_flights', description: 'fake', inputSchema: { type: 'object' } }] } });
      if (rpc.method === 'tools/call') return reply(403, 'Forbidden');
      return reply(200, { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: 'fake: unknown method' } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { seen, port, origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
