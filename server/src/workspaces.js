// Workspaces (rule 13). A workspace id (default "default") scopes the mock world:
// keys, grants, gateway log, usage counters and the trace list. Reset clears the
// current workspace only. Worlds are created on first use; the number is capped.
// A client never picks an id: the header x-workspace is read by the middleware,
// and only well-formed ids are accepted.
export const DEFAULT_WORKSPACE = 'default';
export const MAX_WORKSPACES = 20;
export const WORKSPACE_HEADER = 'x-workspace';
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const validWorkspace = (id) => typeof id === 'string' && ID.test(id);

export class WorkspaceError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

// build(id) returns the workspace's world object; reset(world) returns a fresh one for the same id.
export function createWorkspaces({ build, reset, max = MAX_WORKSPACES }) {
  const all = new Map();
  return {
    get(id = DEFAULT_WORKSPACE) {
      if (!validWorkspace(id)) throw new WorkspaceError('bad_workspace', 400);
      let ws = all.get(id);
      if (!ws) {
        if (all.size >= max) throw new WorkspaceError('too_many_workspaces', 429);
        ws = build(id);
        all.set(id, ws);
      }
      return ws;
    },
    reset(id = DEFAULT_WORKSPACE) {
      if (!validWorkspace(id)) throw new WorkspaceError('bad_workspace', 400);
      if (!all.has(id)) return false;
      all.set(id, reset(id));
      return true;
    },
    resetAllBut(ids) { for (const k of [...all.keys()]) if (!ids.includes(k)) all.delete(k); },
    get current() { return all.get(DEFAULT_WORKSPACE); },
  };
}

/** The workspace middleware: reads x-workspace (default `default`), refuses a bad id (400). */
export function workspaceMiddleware() {
  return (req, res, next) => {
    const id = req.get(WORKSPACE_HEADER) || DEFAULT_WORKSPACE;
    if (!validWorkspace(id)) return res.status(400).json({ error: 'bad_workspace' });
    req.workspaceId = id;
    next();
  };
}
