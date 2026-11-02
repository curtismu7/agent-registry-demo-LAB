// Mock / Real switch in the header of every page. Real is enabled only when the server says it is available; otherwise its
// tooltip (title) carries the server's reason. Hosted builds cannot be switched.
export default function ModeToggle({ info, onSelect }) {
  const loading = !info;
  const source = info?.source;
  const realOff = loading || info.realAvailable !== true;
  const reason = realOff && !loading ? info.realReason || "Real mode is not available." : undefined;
  const pick = (next) => { if (next !== source) onSelect?.(next); };
  return (
    <div className="seg" role="group" aria-label="Mode" data-testid="mode">
      <button type="button" className="btn" aria-pressed={source === "mock"} disabled={loading} onClick={() => pick("mock")} data-testid="mode-mock">Mock</button>
      <button type="button" className="btn" aria-pressed={source === "real"} disabled={realOff} title={reason} onClick={() => pick("real")} data-testid="mode-real">Real</button>
    </div>
  );
}
