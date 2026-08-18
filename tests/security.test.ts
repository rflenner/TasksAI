import assert from "node:assert/strict";import test from "node:test";import{safeReturnTo,signedValue,verifySignedValue}from"../app/lib/security";
process.env.SESSION_SECRET="test-secret-that-is-longer-than-thirty-two-characters";
test("signed session values verify and reject tampering",()=>{const cookie=signedValue("opaque-session-id");assert.equal(verifySignedValue(cookie),"opaque-session-id");assert.equal(verifySignedValue(cookie.replace("opaque","changed")),null);assert.equal(verifySignedValue("unsigned@example.com"),null)});
test("return paths cannot redirect off site",()=>{assert.equal(safeReturnTo("/projects"),"/projects");assert.equal(safeReturnTo("//evil.example"),"/");assert.equal(safeReturnTo("https://evil.example"),"/")});
