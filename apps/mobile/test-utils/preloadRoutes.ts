/**
 * Loads every route module under app/ once per test file, before its tests run.
 *
 * Why: renderRouter('./app') requires each route file the first time a suite renders. That
 * one-off cost (transforming and loading the whole route tree) used to land inside the first
 * test's 5 s budget. On a cold CI runner it took 8–15 s, the first test timed out, and its
 * still-running render overlapped the next tests' act() calls, failing them too.
 *
 * Jest keeps loaded modules for the rest of the test file, so renderRouter then finds them
 * already loaded. It uses expo-router's own context (getMockContext), so exactly the modules
 * renderRouter would load are loaded, after the file's jest.mock() calls (which are hoisted).
 */
import { getMockContext } from 'expo-router/testing-library';

/** Generous only for this one-off load; individual tests keep Jest's default timeout. */
export const PRELOAD_TIMEOUT_MS = 60_000;

export function preloadRoutes(appDir = './app'): void {
  const context = getMockContext(appDir) as ((key: string) => unknown) & { keys(): string[] };
  for (const key of context.keys()) context(key);
}
