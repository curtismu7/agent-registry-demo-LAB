// What the Help dialog says. Plain, and as hedged as the rest of the lab (rule 2): what was measured, what is simulated, what is UNVERIFIED.
export const HELP_SECTIONS = [
  {
    heading: "What this lab is",
    body: [
      "An AI agent is a non-human identity, so give it the same lifecycle you give a person: a named owner, the least scope it needs, an expiry, a grant to exactly one tool, a safe way to replace its credential, and a kill switch that works.",
      "The banner says it: Mock only — a simulated registry, not the real product. No tenant, no outbound network; every key is an obviously fake sk-MOCK- value and every address is a reserved .invalid name."
    ]
  },
  {
    heading: "What was measured, and what was not",
    body: [
      "The registry behaviour (register, grant, revoke, refusal codes, rotation-by-replacement, expiry) was built from observations on one test tenant. docs/safety.md lists each rule and whether it is verified or UNVERIFIED; docs/live-checks.md lets the owner compare with a real tenant.",
      "UNVERIFIED: whether workload tokens work on every gateway route — do not promise it."
    ]
  },
  {
    heading: "How to use the page",
    body: [
      "Tabs: Registry, Lifecycle, Gateway, Diagram, Raw, Talk track.",
      "1. Registry: pick a vertical, register an agent, mint a key — the registry mints it; nobody chooses the value.",
      "2. Lifecycle: run the scenarios (S01 happy path, S02 retire/revoke, S03–S04 refusals: named 403, bare 403, 429 with retry-after, S05 rotation by replacement — there is no rotate button; S06 llm keys cannot be deleted without their RealKey; S07 delete-and-recreate silently inherits old grants).",
      "3. Gateway: watch calls be allowed or refused and why; the event list is small and only for the lifecycle.",
      "4. Diagram: press Simulate, drag boxes.",
      "5. Raw: the underlying records."
    ]
  },
  {
    heading: "Mode honesty",
    body: [
      "Mock by default. If the mode menu offers Real and the lab has a live-check setup, switching reloads every view; otherwise it is refused with the server's reason. Reset clears every mock key, grant, usage counter and event and puts the diagram back."
    ]
  },
  {
    heading: "What is deliberately out of scope",
    body: [
      "Screening agent traffic and holding the audit trail are separate demos (AI Guard sidecar, kill switch and cap enforcement, audit trail). Here revocation answers 401 without saying why — a revoked key looks like an unknown one."
    ]
  }
];
