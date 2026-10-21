import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world.js';
import { mcpSpec, seeded, call, mcp } from './helpers.js';

test('rule grants-by-name: a grant is keyed by key NAME, the key value never appears in it', () => {
  const { w, vk, grant } = seeded();
  assert.equal(grant.status, 201);
  assert.equal(grant.body.keyName, 'travel-agent');
  assert.ok(!JSON.stringify(w.grants.list()).includes(vk));
});

test('rule grants-by-name: deleting a key does NOT remove its grants (no cascade); the registry reports a dangling grant', () => {
  const { w } = seeded();
  assert.equal(w.registry.del('travel-agent').status, 200);
  assert.equal(w.grants.list().length, 1);
  assert.deepEqual(w.grants.warnings().map((x) => x.type), ['dangling']);
});

test('rule grants-by-name: delete + recreate under the same name inherits the grant; the OLD value stays dead', () => {
  const { w, vk } = seeded();
  w.registry.del('travel-agent');
  const re = w.registry.create({ name: 'travel-agent', spec: mcpSpec({ Custodian: 'Someone Else' }) });
  const newVk = re.body.spec.VirtualKey;
  assert.notEqual(newVk, vk);
  assert.equal(call(w, newVk, mcp()).status, 200, 'inherited access nobody granted to this key');
  assert.equal(call(w, vk, mcp()).status, 401, 'the old value is not resurrected');
  const warn = w.grants.warnings();
  assert.deepEqual(warn.map((x) => x.type), ['inherited']);
  assert.match(warn[0].message, /without anyone granting it/);
});

test('a normal grant raises no warning; a grant removed explicitly takes the access away', () => {
  const { w, vk } = seeded();
  assert.deepEqual(w.grants.warnings(), []);
  w.grants.remove(w.grants.list()[0].id);
  assert.equal(call(w, vk, mcp()).status, 403);
});

test('grant validation: unknown key 404, bad app 400, duplicate 409, bad tools 400', () => {
  const { w } = seeded();
  assert.equal(w.grants.grant({ keyName: 'nobody-agent', app: 'x-mcp' }).status, 404);
  assert.equal(w.grants.grant({ keyName: 'travel-agent', app: 'Bad App' }).status, 400);
  assert.equal(w.grants.grant({ keyName: 'travel-agent', app: 'flights-mcp' }).status, 409);
  assert.equal(w.grants.grant({ keyName: 'travel-agent', app: 'ok-mcp', tools: 'x' }).status, 400);
  assert.equal(w.grants.grant({ keyName: '!!', app: 'ok-mcp' }).status, 400);
  assert.equal(w.grants.remove('grant-999').status, 404);
});

test('per-tool grants: only the listed tools pass; an empty list means every tool on that app', () => {
  const { w, vk } = seeded({ tools: ['search'] });
  assert.equal(call(w, vk, mcp('flights-mcp', 'search')).status, 200);
  assert.equal(call(w, vk, mcp('flights-mcp', 'book')).status, 403);
  const open = seeded({ name: 'open-agent' });
  assert.equal(call(open.w, open.vk, mcp('flights-mcp', 'anything')).status, 200);
});

test('copy recreates grants for another name (rotation option a), with their tools', () => {
  const { w } = seeded({ tools: ['search'] });
  w.registry.create({ name: 'next-agent', spec: mcpSpec() });
  assert.match(w.grants.copy('travel-agent', 'next-agent'), /1 grant/);
  assert.deepEqual(w.grants.listFor('next-agent')[0].tools, ['search']);
});

test('worlds are isolated: a second world has none of the first one\'s grants', () => {
  const { w } = seeded();
  assert.equal(createWorld().grants.list().length, 0);
  assert.equal(w.grants.list().length, 1);
});
