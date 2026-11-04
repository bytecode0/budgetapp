import { test } from "node:test";
import assert from "node:assert/strict";
import { installHint, isIOS, type InstallEnv } from "./install.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const env = (over: Partial<InstallEnv> = {}): InstallEnv => ({
  userAgent: IPHONE, maxTouchPoints: 5, standalone: false, dismissed: false, canPrompt: false, ...over,
});

test("iPhone in the browser gets the Share instructions", () => {
  assert.equal(installHint(env()), "ios");
});

test("iPadOS posing as a Mac is still iOS; a real Mac is not", () => {
  assert.equal(isIOS(IPAD_AS_MAC, 5), true);
  assert.equal(isIOS(IPAD_AS_MAC, 0), false);
});

test("Android shows the hint only once the browser offers its install prompt", () => {
  assert.equal(installHint(env({ userAgent: ANDROID, canPrompt: false })), null);
  assert.equal(installHint(env({ userAgent: ANDROID, canPrompt: true })), "prompt");
});

test("desktop never shows the hint, even with an install prompt", () => {
  assert.equal(installHint(env({ userAgent: DESKTOP, maxTouchPoints: 0, canPrompt: true })), null);
});

test("nothing when already installed or closed on this device", () => {
  assert.equal(installHint(env({ standalone: true })), null);
  assert.equal(installHint(env({ dismissed: true })), null);
  assert.equal(installHint(env({ userAgent: ANDROID, canPrompt: true, dismissed: true })), null);
});
