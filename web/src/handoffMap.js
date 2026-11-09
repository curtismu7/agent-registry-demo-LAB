// Customer Agent LAB hands a use case here with ?from=customer-agent&uc=<id>&vertical=<id> (read by the vendored return-link module).
// Preselect only where the catalog id obviously maps to this lab's own story or persona; anything else opens the defaults (strip only).
// UC19 (agent identity lifecycle) -> S01 register, grant, call; UC39 (centralized revocation: retire the agent) -> S02 revoke and refuse.
// UC-NHI2 (lifecycle export, JML) has no matching story, so it gets the strip only. Of the incoming verticals only banking exists here.
export const UC_SCENARIO = Object.freeze({ UC19: "S01", UC39: "S02" });
export const VERTICAL_MAP = Object.freeze({ banking: "banking" });
export const scenarioFor = (ctx) => (ctx && Object.hasOwn(UC_SCENARIO, ctx.uc) ? UC_SCENARIO[ctx.uc] : null);
export const verticalFor = (ctx) => (ctx && ctx.vertical && Object.hasOwn(VERTICAL_MAP, ctx.vertical) ? VERTICAL_MAP[ctx.vertical] : null);
