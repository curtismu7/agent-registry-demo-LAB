// Grants. A grant says "this key may reach this app (optionally only these tools)". It references the key by NAME.
// That is the real behaviour and it is the trap: delete the key, recreate one with the same name, and the new key
// silently inherits the old key's grants. Grants are never cascaded away when a key is deleted.
import { NAME_RE } from './registry.js';
import { cleanText } from './safety.js';

export function createGrants({ registry, now = () => Date.now() }) {
  const grants = [];
  let seq = 0;

  function grant({ keyName, app, tools = [] } = {}) {
    if (!NAME_RE.test(String(keyName ?? ''))) return { status: 400, body: { error: 'invalid_key_name', message: 'keyName must be a key name' } };
    const a = cleanText(app, 60);
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(a)) return { status: 400, body: { error: 'invalid_app', message: 'app must be lowercase letters, digits and dashes' } };
    if (!Array.isArray(tools) || tools.length > 50) return { status: 400, body: { error: 'invalid_tools', message: 'tools must be an array' } };
    const incarnation = registry.incarnationOf(keyName);
    if (incarnation === null) return { status: 404, body: { error: 'key_not_found', message: `no key named ${keyName}` } };
    const existing = grants.find((g) => g.keyName === keyName && g.app === a);
    if (existing) return { status: 409, body: { error: 'grant_exists', message: `${keyName} already has a grant for ${a}` } };
    const g = { id: `grant-${++seq}`, keyName, app: a, tools: tools.map((t) => cleanText(t, 60)), createdAt: new Date(now()).toISOString(), forIncarnation: incarnation };
    grants.push(g);
    return { status: 201, body: pub(g), notes: [`Grant references the key by NAME (${keyName}), not by its VirtualKey.`] };
  }

  const pub = ({ id, keyName, app, tools, createdAt }) => ({ id, keyName, app, tools, createdAt });
  const list = () => grants.map(pub);
  const listFor = (keyName) => grants.filter((g) => g.keyName === keyName).map(pub);
  function remove(id) {
    const i = grants.findIndex((g) => g.id === id);
    if (i < 0) return { status: 404, body: { error: 'not_found', message: `no grant ${id}` } };
    grants.splice(i, 1);
    return { status: 200, body: { removed: id } };
  }

  // By name only. This is the whole trap.
  function allowed(keyName, app, tool) {
    const g = grants.find((x) => x.keyName === keyName && x.app === app);
    if (!g) return { ok: false, reason: 'no_grant' };
    if (tool && g.tools.length && !g.tools.includes(tool)) return { ok: false, reason: 'tool_not_granted' };
    return { ok: true };
  }

  // Recreate grants for a successor key (rotation option (a): keep the new name, recreate its grants).
  function copy(fromName, toName) {
    const made = grants.filter((g) => g.keyName === fromName).map((g) => grant({ keyName: toName, app: g.app, tools: g.tools }));
    return `${made.filter((m) => m.status === 201).length} grant(s) recreated for ${toName}`;
  }

  // Grants whose key is gone (dangling), or that were written for a previous key and are now held by a different one (inherited).
  function warnings() {
    const out = [];
    for (const g of grants) {
      const inc = registry.incarnationOf(g.keyName);
      if (inc === null) out.push({ type: 'dangling', grant: g.id, keyName: g.keyName, app: g.app, message: `Grant ${g.id} names ${g.keyName}, but no such key exists. Whoever creates a key with that name inherits it.` });
      else if (inc !== g.forIncarnation) out.push({ type: 'inherited', grant: g.id, keyName: g.keyName, app: g.app, message: `Grant ${g.id} was written for an earlier key named ${g.keyName}. The key that holds the name now inherited access to ${g.app} without anyone granting it.` });
    }
    return out;
  }

  return { grant, list, listFor, remove, allowed, copy, warnings };
}
