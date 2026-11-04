// A tiny in-memory stand-in for Prisma's findFirst/updateMany, enough for the
// auth throttles' tests (otp.test.ts, loginThrottle.test.ts). Supports equality
// (including null) and { lt, lte, gt } in `where`, and { increment } in `data`.
type Row = Record<string, unknown>;

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { lt?: number | Date; lte?: number | Date; gt?: number | Date };
      if (value === null || value === undefined) return false;
      const v = value as number | Date;
      if (c.lt !== undefined && !(v < c.lt)) return false;
      if (c.lte !== undefined && !(v <= c.lte)) return false;
      if (c.gt !== undefined && !(v > c.gt)) return false;
      return true;
    }
    if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
    return value === cond;
  });
}

export function fakeTable(rows: Row[]) {
  return {
    rows,
    async findFirst({ where }: { where: Record<string, unknown> }) {
      // Newest first, like orderBy createdAt desc.
      const found = rows.filter((r) => matches(r, where))
        .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      return (found[0] ?? null) as any;
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      let count = 0;
      for (const row of rows) {
        if (!matches(row, where)) continue;
        for (const [key, value] of Object.entries(data)) {
          row[key] = value !== null && typeof value === "object" && "increment" in value
            ? (row[key] as number) + (value as { increment: number }).increment
            : value;
        }
        count++;
      }
      return { count };
    },
  };
}
