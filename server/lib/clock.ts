// "Now" for the routes that build the debt cycle and the committed future
// (server/routes/debts.ts), so integration tests can pin the date instead of
// depending on the day they run. Only a test can move it.
let fixed: Date | null = null;

export function now(): Date {
  return fixed ? new Date(fixed) : new Date();
}

/** Tests only (NODE_ENV=test): pins now() to `date`, or releases it with null. */
export function setClockForTests(date: Date | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("setClockForTests is only for tests");
  fixed = date;
}
