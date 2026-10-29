// Run with:  node --import tsx --test server/lib/ownership.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mutationAccess } from "./ownership.js";

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
