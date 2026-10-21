// Vercel Function: every /api/* request is rewritten here (vercel.json) and
// handled by the same Express app as local dev. The original path is kept, so
// Express routes see /api/debts, not /.
import app from "../server/app.js";

export default app;
