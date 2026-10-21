// Trace envelope: W3C traceparent plus the raw request and response as they would look on the wire.
// Every key-looking value is masked on the way out, so a trace can be pasted anywhere.
import { randomBytes } from 'node:crypto';

const hex = (n) => randomBytes(n).toString('hex');
export const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function newTraceparent() { return `00-${hex(16)}-${hex(8)}-01`; }
// Keep the caller's trace id when it sent a valid traceparent, start a new span either way.
export function childTraceparent(incoming) {
  const m = TRACEPARENT.exec(String(incoming || ''));
  if (!m || /^0+$/.test(m[1]) || /^0+$/.test(m[2])) return newTraceparent();
  return `00-${m[1]}-${hex(8)}-${m[3]}`;
}

// sk-MOCK-ABCDEF...WXYZ -> sk-MOCK-ABCD...WXYZ
export function maskKeys(text) {
  return String(text).replace(/sk-MOCK-([A-Z0-9-]{4})[A-Z0-9-]*([A-Z0-9]{4})\b/g, 'sk-MOCK-$1...$2');
}

const REASON = { 200: 'OK', 201: 'Created', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 429: 'Too Many Requests' };

export function rawRequest({ method, host, path, headers = {}, body }) {
  const head = [`${method} ${path} HTTP/1.1`, `Host: ${host}`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)].join('\n');
  const text = body === undefined ? head : `${head}\n\n${typeof body === 'string' ? body : JSON.stringify(body, null, 2)}`;
  return maskKeys(text);
}

export function rawResponse({ status, headers = {}, body }) {
  const head = [`HTTP/1.1 ${status} ${REASON[status] || ''}`.trim(), ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)].join('\n');
  const text = body === undefined ? head : `${head}\n\n${typeof body === 'string' ? body : JSON.stringify(body, null, 2)}`;
  return maskKeys(text);
}

export function envelope({ traceparent, request, response, log = [], notes = [] }) {
  return { traceparent, traceId: TRACEPARENT.exec(traceparent)?.[1], request, response, gatewayLog: log, notes };
}
