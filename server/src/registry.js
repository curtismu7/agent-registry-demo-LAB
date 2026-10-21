// Stateful in-memory Agent Registry simulator. It models what we MEASURED about Privilege agent access keys
// (memory notes privilege-agent-key-api-facts / privilege-agent-key-rotation-facts; skills privilege-agent-nhi-lessons,
// privilege-nhi-setup) and nothing more. Everything is fake: VirtualKeys are sk-MOCK-..., no tenant, no network.
//
// It NEVER pretends in-place rotation exists. VirtualKey is server-generated and immutable; there is no rotate endpoint.
import { randomBytes } from 'node:crypto';
import { cleanText } from './safety.js';

export const SCOPES = ['llm', 'mcp', 'a2a'];
export const NAME_RE = /^[a-z][a-z0-9-]{1,40}$/;

// The real-behaviour rules this simulator encodes. status: verified (measured live 2026-10-14), demo-guard (a safety stop THIS demo
// adds; the real API does not stop you), unverified (stated by the skills but never reproduced; the mock picks the cautious reading).
export const RULES = {
  'virtual-key-immutable': { status: 'verified', text: 'VirtualKey is server-generated on create and immutable. A PUT carrying a new VirtualKey returns 200 and the value is ignored.' },
  'no-rotate-endpoint': { status: 'verified', text: 'There is no rotate or regenerate endpoint (only GET/POST/PUT/DELETE). Rotation is replacement: snapshot, create a successor, verify, revoke the old.' },
  'llm-needs-real-key': { status: 'verified', text: 'Creating a key with the llm scope requires Spec.RealKey (the upstream provider key): 400 "Spec.RealKey is required for llm scope".' },
  'real-key-never-returned': { status: 'verified', text: 'RealKey is never returned by a read (empty string). A PUT that omits it keeps the stored one.' },
  'never-delete-llm-without-real-key': { status: 'demo-guard', text: 'Deleting an llm-scoped key and recreating it loses the RealKey, so it cannot be recreated. The real API lets you delete; this demo refuses unless you show the RealKey you hold.' },
  'revoke-only-non-destructive-kill': { status: 'verified', text: 'PUT Revoked:true is the only non-destructive kill. The gateway then answers 401, indistinguishable from an unknown key.' },
  'grants-by-name': { status: 'verified', text: 'A grant references the key by NAME. Delete and recreate under the same name and the new key silently inherits the old key\'s grants.' },
  'native-caps-429': { status: 'verified', text: 'RPMLimit, TPMLimit, BudgetUSD (0 = unlimited) are enforced natively by the gateway on llm routes: over the cap is a 429 with retry-after.' },
  'guardrail-copied-with-spec': { status: 'verified', text: 'The per-key guardrail travels in the Spec, so a successor built from a snapshot carries it.' },
  'expired-edit-renews': { status: 'verified', text: 'An expired key is edit-locked until NotAfter is moved forward, so editing an expired key is renewing it.' },
  'workload-no-static-secret': { status: 'verified', text: 'A workload-identity key has no static secret: it authenticates by an external issuer\'s token (issuer, audience, subject, lifetime cap).' },
  'workload-gateway-acceptance': { status: 'unverified', text: 'Whether the deployed gateway accepts workload tokens on mcp and llm routes was NOT proven live (401 and no log line). The mock accepts a well-formed claim set; treat that as the intended design, not a measurement.' },
  'caps-on-mcp-a2a': { status: 'unverified', text: 'Caps were measured on llm routes only. The mock does not apply them to mcp/a2a calls.' },
  'duplicate-names': { status: 'unverified', text: 'Whether two keys can share a name at once was never tested. The mock refuses a duplicate (409), so a successor needs a new name.' },
  'unrevoke': { status: 'unverified', text: 'PUT Revoked:false was never tried. The mock refuses it.' },
  'caller-virtual-key-on-create': { status: 'unverified', text: 'A VirtualKey supplied on create was never tried. The mock ignores it, as it does on PUT.' },
};

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function mintVirtualKey(rand = randomBytes) {
  const bytes = rand(54);
  let s = '';
  for (let i = 0; i < 54; i++) s += B32[bytes[i] % 32];
  return `sk-MOCK-${s}`;
}

const err = (status, error, message, extra = {}) => ({ status, body: { error, message, ...extra }, notes: [] });
const clone = (x) => JSON.parse(JSON.stringify(x));
const MUTABLE = ['Scopes', 'Custodian', 'Provider', 'AllowedModels', 'RPMLimit', 'TPMLimit', 'BudgetUSD', 'NotAfter', 'Guardrail', 'Description'];
const CAPS = ['RPMLimit', 'TPMLimit', 'BudgetUSD'];

export function createRegistry({ now = () => Date.now(), rand = randomBytes } = {}) {
  const keys = new Map(); // name -> { id, spec, realKey, createdAt }
  const events = [];
  let seq = 0;
  let idSeq = 0;
  const emit = (type, key, detail = '') => {
    events.push({ seq: ++seq, at: new Date(now()).toISOString(), type, key, detail });
    if (events.length > 500) events.shift();
  };

  const stateOf = (k) => {
    if (k.spec.Revoked) return 'revoked';
    if (k.spec.NotAfter && Date.parse(k.spec.NotAfter) <= now()) return 'expired';
    return 'active';
  };
  const view = (name, k) => ({ name, state: stateOf(k), spec: { ...clone(k.spec), RealKey: '' } });

  function normalise(input, { partial }) {
    const out = {};
    const problems = [];
    if ('Scopes' in input || !partial) {
      const s = input.Scopes;
      if (!Array.isArray(s) || s.length === 0 || s.some((x) => !SCOPES.includes(x))) problems.push(`Scopes must be a non-empty subset of ${SCOPES.join(', ')}`);
      else out.Scopes = [...new Set(s)];
    }
    if ('Custodian' in input) out.Custodian = cleanText(input.Custodian, 80);
    if ('Description' in input) out.Description = cleanText(input.Description, 200);
    if ('Provider' in input) out.Provider = cleanText(input.Provider, 40);
    if ('AllowedModels' in input) {
      if (!Array.isArray(input.AllowedModels)) problems.push('AllowedModels must be an array');
      else out.AllowedModels = input.AllowedModels.map((m) => cleanText(m, 80)).slice(0, 20);
    }
    for (const c of CAPS) {
      if (c in input) {
        if (!Number.isInteger(input[c]) || input[c] < 0) problems.push(`${c} must be a non-negative integer (0 = unlimited)`);
        else out[c] = input[c];
      }
    }
    if ('NotAfter' in input) {
      if (input.NotAfter === '' || input.NotAfter === null) out.NotAfter = '';
      else if (Number.isNaN(Date.parse(input.NotAfter))) problems.push('NotAfter must be an ISO 8601 time or empty');
      else out.NotAfter = new Date(input.NotAfter).toISOString();
    }
    if ('Guardrail' in input) {
      if (!input.Guardrail || typeof input.Guardrail !== 'object' || Array.isArray(input.Guardrail) || JSON.stringify(input.Guardrail).length > 1000) problems.push('Guardrail must be a small object');
      else out.Guardrail = clone(input.Guardrail);
    }
    return { out, problems };
  }

  function validateWorkload(w) {
    const p = [];
    if (!w || typeof w !== 'object') return ['WorkloadIdentity must be an object'];
    if (!w.Issuer) p.push('WorkloadIdentity.Issuer is required');
    if (!w.Audience) p.push('WorkloadIdentity.Audience is mandatory: an unbound token is replayable elsewhere');
    if (!w.Subject && !w.AllowAnySubject) p.push('WorkloadIdentity needs Subject, or AllowAnySubject:true on purpose');
    return p;
  }

  function create(body) {
    const b = body || {};
    const name = String(b.name ?? '');
    const spec = b.spec && typeof b.spec === 'object' ? b.spec : {};
    if (!NAME_RE.test(name)) return err(400, 'invalid_name', 'name must be lowercase letters, digits and dashes, 2-41 characters, starting with a letter. The name is permanent.');
    if (keys.has(name)) return err(409, 'name_in_use', `a key named ${name} already exists`, { rule: 'duplicate-names' });
    const { out, problems } = normalise(spec, { partial: false });
    const workload = spec.WorkloadIdentity ? clone(spec.WorkloadIdentity) : null;
    if (workload) {
      problems.push(...validateWorkload(workload));
      if (out.Scopes?.includes('llm')) problems.push('workload-identity keys are limited to mcp and a2a in this demo (llm with a workload identity was never exercised)');
    } else if (!out.Custodian) problems.push('Custodian is required: the human the agent acts as');
    if (problems.length) return err(400, 'invalid_spec', problems.join('; '));
    const notes = [];
    if (out.Scopes.includes('llm')) {
      if (!out.Provider) return err(400, 'invalid_spec', 'Provider is required for llm scope (one provider per key)');
      if (!spec.RealKey) return err(400, 'real_key_required', 'Spec.RealKey is required for llm scope', { rule: 'llm-needs-real-key' });
    }
    if ('VirtualKey' in spec) notes.push('Supplied VirtualKey ignored: it is server-generated (rule caller-virtual-key-on-create, UNVERIFIED on the real product).');
    const k = {
      id: ++idSeq,
      realKey: out.Scopes.includes('llm') ? String(spec.RealKey) : '',
      createdAt: now(),
      spec: {
        Description: '', Provider: '', AllowedModels: [], RPMLimit: 0, TPMLimit: 0, BudgetUSD: 0, NotAfter: '', Guardrail: { mode: 'alert', blockAgreement: 'off' },
        Custodian: workload ? 'workload-identity' : '', ...out,
        VirtualKey: workload ? '' : mintVirtualKey(rand), Revoked: false, ...(workload ? { WorkloadIdentity: workload } : {}),
      },
    };
    keys.set(name, k);
    emit('key.created', name, `${k.spec.Scopes.join('+')}${workload ? ' (workload identity, no static secret)' : ''}`);
    return { status: 201, body: view(name, k), notes };
  }

  const get = (name) => (keys.has(name) ? { status: 200, body: view(name, keys.get(name)), notes: [] } : err(404, 'not_found', `no key named ${name}`));
  const list = () => ({ status: 200, body: { items: [...keys.keys()].sort().map((n) => view(n, keys.get(n))) }, notes: [] });

  function update(name, body) {
    const k = keys.get(name);
    if (!k) return err(404, 'not_found', `no key named ${name}`);
    const b = body || {};
    if (b.name !== undefined && b.name !== name) return err(400, 'name_immutable', 'the name is permanent: rename = delete + recreate, and the key value changes');
    const spec = b.spec && typeof b.spec === 'object' ? b.spec : {};
    const notes = [];
    const known = new Set([...MUTABLE, 'VirtualKey', 'RealKey', 'Revoked', 'WorkloadIdentity']);
    const unknown = Object.keys(spec).filter((f) => !known.has(f));
    if (unknown.length) return err(400, 'unknown_field', `unknown Spec field(s): ${unknown.join(', ')}`);
    if (spec.Revoked === false && k.spec.Revoked) return err(400, 'unrevoke_unsupported', 'un-revoking was never tried on the real product; create a successor instead', { rule: 'unrevoke' });
    const { out, problems } = normalise(spec, { partial: true });
    if ('WorkloadIdentity' in spec) {
      if (!k.spec.WorkloadIdentity) problems.push('a static-secret key cannot become a workload identity: create a new key');
      else { problems.push(...validateWorkload(spec.WorkloadIdentity)); out.WorkloadIdentity = clone(spec.WorkloadIdentity); }
    }
    const scopes = out.Scopes || k.spec.Scopes;
    if (k.spec.WorkloadIdentity && scopes.includes('llm')) problems.push('workload-identity keys are limited to mcp and a2a in this demo');
    const nextReal = spec.RealKey ? String(spec.RealKey) : k.realKey; // omitted or blank keeps the stored one
    if (scopes.includes('llm') && !nextReal) return err(400, 'real_key_required', 'Spec.RealKey is required for llm scope', { rule: 'llm-needs-real-key' });
    if (problems.length) return err(400, 'invalid_spec', problems.join('; '));
    if ('VirtualKey' in spec && spec.VirtualKey !== k.spec.VirtualKey) notes.push('PUT carried a different VirtualKey: returned 200 and ignored it (rule virtual-key-immutable). Nothing was rotated.');
    if (k.spec.NotAfter && Date.parse(k.spec.NotAfter) <= now() && out.NotAfter && Date.parse(out.NotAfter) > now()) notes.push('Editing an expired key renewed it (rule expired-edit-renews).');
    Object.assign(k.spec, out);
    if (scopes.includes('llm')) k.realKey = nextReal;
    if (spec.Revoked === true) k.spec.Revoked = true;
    emit('key.updated', name, Object.keys(out).join(',') || 'no field changed');
    if (spec.Revoked === true) emit('key.revoked', name, 'via PUT Revoked:true');
    return { status: 200, body: view(name, k), notes };
  }

  function revoke(name) {
    const k = keys.get(name);
    if (!k) return err(404, 'not_found', `no key named ${name}`);
    if (!k.spec.Revoked) { k.spec.Revoked = true; emit('key.revoked', name, 'Revoked:true (non-destructive: the key, its caps and its grants stay)'); }
    return { status: 200, body: view(name, k), notes: ['Revoked, not deleted: this is the only non-destructive kill (rule revoke-only-non-destructive-kill).'] };
  }

  function del(name, { heldRealKey } = {}) {
    const k = keys.get(name);
    if (!k) return err(404, 'not_found', `no key named ${name}`);
    if (k.spec.Scopes.includes('llm') && (!heldRealKey || heldRealKey !== k.realKey)) {
      emit('key.delete.blocked', name, 'llm-scoped key, RealKey not shown');
      return err(409, 'blocked_by_demo_guard', 'refused: this key has the llm scope and you have not shown the RealKey you hold. Delete + recreate loses the RealKey (reads return an empty string), so the key could never be recreated. Revoke instead.', { rule: 'never-delete-llm-without-real-key', demoGuard: true });
    }
    keys.delete(name);
    emit('key.deleted', name, 'deleted (its grants, which reference it by name, are NOT removed)');
    return { status: 200, body: { deleted: name }, notes: ['Grants that name this key were not touched (rule grants-by-name).'] };
  }

  // The full spec, as a safe rotation must snapshot it before anything is deleted. RealKey is not in it: reads never return it.
  function snapshot(name) {
    const k = keys.get(name);
    if (!k) return null;
    const { VirtualKey, Revoked, ...rest } = clone(k.spec);
    return { name, takenAt: new Date(now()).toISOString(), spec: rest };
  }

  // Rotation by replacement. hooks.onSuccessor(oldName, newName) copies grants; hooks.verify(successorView) -> { ok, detail }.
  // Never deletes anything: the old key is revoked only after the successor verified, so a failure leaves the old key working.
  function rotateByReplacement(name, { successorName, realKey, onSuccessor, verify } = {}) {
    const steps = [];
    const step = (s, ok, detail) => { steps.push({ step: s, ok, detail }); return ok; };
    const fail = (status, error, message, extra) => ({ ...err(status, error, message, { steps, ...extra }) });
    const snap = snapshot(name);
    if (!snap) return err(404, 'not_found', `no key named ${name}`);
    step('snapshot', true, `captured ${Object.keys(snap.spec).length} Spec fields before touching anything`);
    if (!NAME_RE.test(successorName || '') || successorName === name) return fail(400, 'invalid_successor', 'successorName must be a valid, different name (two keys sharing a name was never tested)', { rule: 'duplicate-names' });
    const spec = { ...snap.spec };
    if (snap.spec.Scopes.includes('llm')) spec.RealKey = realKey;
    const created = create({ name: successorName, spec });
    if (!step('create-successor', created.status === 201, created.status === 201 ? `${successorName} created with a new server-generated VirtualKey` : created.body.message)) {
      return fail(created.status, created.body.error, `${created.body.message} The old key was not touched.`, { rule: created.body.rule });
    }
    if (onSuccessor) step('copy-grants', true, onSuccessor(name, successorName) || 'grants recreated for the new name');
    const succ = get(successorName).body;
    const v = verify ? verify(succ) : { ok: true, detail: 'no verifier supplied' };
    if (!step('verify', v.ok, v.detail)) {
      revoke(successorName);
      step('discard-successor', true, `${successorName} revoked; ${name} is untouched and still works`);
      return fail(409, 'verify_failed', `successor failed verification: ${v.detail}. ${name} is untouched.`);
    }
    revoke(name);
    step('revoke-old', true, `${name} revoked (not deleted); repoint consumers to ${successorName}, confirm the old value now gets 401, delete later`);
    emit('key.rotated', name, `replaced by ${successorName}`);
    return { status: 200, body: { old: get(name).body, successor: get(successorName).body, steps }, notes: ['Replacement, not in-place rotation: the real product has no rotate endpoint (rule no-rotate-endpoint).'] };
  }

  const authenticate = (virtualKey) => {
    if (!virtualKey) return null;
    for (const [name, k] of keys) if (k.spec.VirtualKey && k.spec.VirtualKey === virtualKey) return { name, k };
    return null;
  };
  const workloadKeys = () => [...keys].filter(([, k]) => k.spec.WorkloadIdentity).map(([name, k]) => ({ name, k }));

  return {
    create, get, list, update, revoke, del, snapshot, rotateByReplacement,
    events: () => events.slice(), stateOf: (name) => (keys.has(name) ? stateOf(keys.get(name)) : null),
    // Demo-only introspection (not a real API surface):
    incarnationOf: (name) => (keys.has(name) ? keys.get(name).id : null),
    hasRealKey: (name) => Boolean(keys.get(name)?.realKey),
    // Used by the mock gateway:
    authenticate, workloadKeys, entry: (name) => keys.get(name) || null,
    stateOfEntry: stateOf,
  };
}
