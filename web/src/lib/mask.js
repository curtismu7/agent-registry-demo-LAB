// The UI never shows a whole key, not even a mock one: sk-MOCK-ABCD...WXYZ. The full value is only ever sent back to the mock gateway.
export const maskKey = (v) => String(v ?? "").replace(/sk-MOCK-([A-Za-z0-9-]{4})[A-Za-z0-9-]*([A-Za-z0-9]{4})\b/g, "sk-MOCK-$1...$2");
export const maskDeep = (o) => JSON.parse(maskKey(JSON.stringify(o)));
