/// <reference path="../src/testing/vitest.d.ts" />

import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";
import { setupLoggerMatchers } from "../src/testing/matchers";

// Set up custom matchers
// biome-ignore lint/suspicious/noMisplacedAssertion: vitest specific
setupLoggerMatchers(expect);

// Global test setup
beforeAll(() => {
  // Suppress console output during tests unless DEBUG is set
  if (!process.env.DEBUG) {
    // We don't actually suppress here since we use TestTransport
    // But you could add console mocking here if needed
  }
});

// Global test teardown
afterAll(() => {
  // Clean up any resources
});

// Reset state between tests
beforeEach(() => {
  // Reset any global state if needed
});

afterEach(() => {
  // Clean up after each test
});
