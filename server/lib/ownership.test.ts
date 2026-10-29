// Run with:  node --import tsx --test server/lib/ownership.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mutationAccess, reorderableEntries, visibleToWhere } from "./ownership.js";

test("the owner may change their own record, private or shared", () => {
  assert.equal(mutationAccess({ ownerUserId: "ana", visibility: "private" }, "ana"), "ok");
  assert.equal(mutationAccess({ ownerUserId: "ana", visibility: "household" }, "ana"), "ok");
  assert.equal(mutationAccess({ ownerUserId: "ana" }, "ana"), "ok");
});

test("another member's household-shared record is read-only", () => {
  assert.equal(mutationAccess({ ownerUserId: "ana", visibility: "household" }, "ben"), "forbidden");
});

test("another member's private record is answered as not found", () => {
  assert.equal(mutationAccess({ ownerUserId: "ana", visibility: "private" }, "ben"), "hidden");
});

test("records without visibility (income) are read-only for other members", () => {
  assert.equal(mutationAccess({ ownerUserId: "ana" }, "ben"), "forbidden");
});

test("no authenticated user never owns anything", () => {
  assert.equal(mutationAccess({ ownerUserId: "ana", visibility: "household" }, undefined), "forbidden");
});

test("reorder only touches rows the caller can see", () => {
  const visible = new Set(["mine", "shared"]);
  assert.deepEqual(
    reorderableEntries([
      { id: "mine", sortOrder: 0 },
      { id: "partners-private", sortOrder: 1 },
      { id: "shared", sortOrder: 2 },
      { id: "other-pool", sortOrder: 3 },
    ], visible),
    [{ id: "mine", sortOrder: 0 }, { id: "shared", sortOrder: 2 }],
  );
});

test("reorder drops malformed entries", () => {
  const visible = new Set(["a"]);
  assert.deepEqual(reorderableEntries([{ id: "a", sortOrder: 1.5 }], visible), []);
  assert.deepEqual(reorderableEntries([{ id: "a", sortOrder: "2" as unknown as number }], visible), []);
});

test("visible rows are the caller's own plus household-shared ones", () => {
  assert.deepEqual(visibleToWhere("ana"), { OR: [{ ownerUserId: "ana" }, { visibility: "household" }] });
});
