// {{cast}} tokens: one text, filled from the chosen vertical's cast. An unknown token stays visible so a typo is seen, not hidden.
export const fill = (text, cast) => String(text ?? "").replace(/\{\{(\w+)\}\}/g, (m, k) => (k in (cast || {}) ? String(cast[k]) : m));
