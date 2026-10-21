import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on PORT (default 5010, npm start) and Vite on VITE_PORT (default 5011). /api is proxied, so the browser only ever
// talks to one origin (same-origin writes). Ports stay inside 5010-5049.
const api = { target: `http://127.0.0.1:${Number(process.env.PORT) || 5010}` };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 5011, strictPort: true, proxy: { "/api": api } },
  // The real server app is loaded by Node itself in tests, so its data files resolve normally.
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js", server: { deps: { external: [/\/server\/src\//] } } },
});
