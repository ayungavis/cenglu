import { AsyncLocalStorage } from "node:async_hooks";
import type { LogContext } from "./types";

const asyncLocalStorage = new AsyncLocalStorage<Map<string, unknown>>();

export function run<T>(context: Partial<LogContext>, fn: () => T): T {
  const store = new Map(Object.entries(context));
  return asyncLocalStorage.run(store, fn);
}

export function get(): Partial<LogContext> {
  const store = asyncLocalStorage.getStore();
  if (!store) {
    return {};
  }
  return Object.fromEntries(store);
}

export function set(key: string, value: unknown): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store.set(key, value);
  }
}

export function remove(key: string): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store.delete(key);
  }
}

export function clear(): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store.clear();
  }
}
