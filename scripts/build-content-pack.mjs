// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the scenarios.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenarios = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/data/scenarios.json'), 'utf8'));
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function buildPack() {
  const story = (id) => scenarios.find((s) => s.id === id);
  const tryCard = (id, cardId, label) => ({ id: cardId, label, description: story(id).takeaway, group: 'try-it', action: { type: 'route', href: `/#scenario-${id}` }, story: id });
  return {
    schema: 'demo-content-pack/1',
    id: 'agent-registry-demo',
    title: 'Agent Registry Lifecycle',
    version,
    demo: { id: 'agent-registry-demo', name: 'Agent Registry Lifecycle', catalog: 'D11', baseUrl: 'http://localhost:5010', doctor: '/api/health', tags: ['agent-registry', 'nhi', 'rotation', 'revocation', 'workload-identity', 'mock'] },
    glossary: [
      { id: 'agent-key', term: 'Agent access key', definition: 'One credential that is the agent\'s whole identity in the registry: scopes, custodian, caps, expiry, guardrail and grants hang off it. The agent sends it as a Bearer token on every call. The VirtualKey is server-generated and cannot be edited.', aliases: ['virtual key', 'non-human identity'] },
      { id: 'custodian', term: 'Custodian', definition: 'The human an agent acts as and answers for. If the custodian\'s account goes inactive the key stops working, so pick someone who will stay.' },
      { id: 'grant', term: 'Grant', definition: 'A policy that lets a key reach one app, optionally only some tools. It references the key by NAME, not by its value.' },
      { id: 'rotate-by-replacement', term: 'Rotate by replacement', definition: 'There is no rotate endpoint. Snapshot the spec, create a successor under a new name, copy its grants, verify it with a call, then revoke the old key. A PUT carrying a new VirtualKey returns 200 and is ignored.' },
      { id: 'revoke', term: 'Revoke', definition: 'Revoked:true. The only non-destructive kill: the key, its caps and its grants stay, and the gateway answers 401 without saying why.' },
      { id: 'real-key', term: 'RealKey', definition: 'The upstream provider key an llm-scoped agent key needs at create time. Reads return it as an empty string, so deleting an llm key before holding the RealKey is a one-way door.' },
      { id: 'workload-identity', term: 'Workload identity', definition: 'A key with no static secret that authenticates by a token from an external issuer, with a mandatory audience and a lifetime cap. Whether the deployed gateway accepts these tokens is UNVERIFIED.' },
    ],
    sources: [
      { id: 'rfc6750', title: 'RFC 6750: The OAuth 2.0 Bearer Token Usage', url: 'https://www.rfc-editor.org/rfc/rfc6750', kind: 'standard', use: 'Bearer credential and the 401 challenge shape', status: 'not-read', checked: '2026-10-21' },
      { id: 'rfc9728', title: 'RFC 9728: OAuth 2.0 Protected Resource Metadata', url: 'https://www.rfc-editor.org/rfc/rfc9728', kind: 'standard', use: 'resource_metadata in the mcp 401 challenge', status: 'not-read', checked: '2026-10-21' },
    ],
    cards: [
      tryCard('S01', 'try-happy', 'Register, grant, call'),
      tryCard('S02', 'try-revoke', 'Revoke and watch it refused'),
      tryCard('S03', 'try-scope', 'Two different 403s'),
      tryCard('S04', 'try-cap', 'The 429 shape'),
      tryCard('S05', 'try-rotate', 'Rotate by replacement'),
      tryCard('S06', 'try-delete-llm', 'The delete trap for llm keys'),
      tryCard('S07', 'try-same-name', 'Same-name recreate inherits grants'),
      tryCard('S08', 'try-workload', 'A workload identity with no secret'),
      tryCard('S09', 'try-expiry', 'Expiry and renewal'),
      { id: 'concept-lifecycle', label: 'The agent lifecycle', description: 'Register, grant, rotate, retire.', group: 'concept', action: { type: 'route', href: '/#concept-lifecycle' }, terms: ['agent-key', 'custodian', 'grant', 'rotate-by-replacement', 'revoke'] },
      { id: 'concept-traps', label: 'Traps that cost hours', description: 'RealKey, same-name grants, the PUT that is ignored.', group: 'concept', action: { type: 'route', href: '/#concept-traps' }, terms: ['real-key', 'grant', 'workload-identity'] },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: scenarios.map((s) => ({ id: s.id, title: s.title, say: s.takeaway })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
  console.log('wrote content-pack.json');
}
