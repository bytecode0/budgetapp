// Local dev entry (npm run dev:server). In production the same app runs as a
// Vercel Function — see api/index.ts.
import app from "./app.js";

const PORT = process.env.SERVER_PORT || 3002;

app.listen(PORT, () => {
  console.log(`[server] Remanso running on http://localhost:${PORT}`);
});
