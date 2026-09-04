#!/usr/bin/env node
/**
 * Make sure `better-sqlite3` in backend/node_modules matches the ABI of the
 * Node.js runtime that is about to run the tests.
 *
 * The release pipeline rebuilds better-sqlite3 for Electron's ABI so the
 * packaged app can load it. Vitest, however, runs under plain Node, and the
 * Electron build then fails with:
 *
 *   Error: The module '...better_sqlite3.node' was compiled against a
 *   different Node.js version using NODE_MODULE_VERSION ...
 *
 * which is exactly what broke the "Run backend tests" CI step. Rebuilding the
 * backend copy for Node is safe: electron-builder only packages the *root*
 * node_modules, so the Electron-ABI build the app ships with is untouched.
 *
 * The rebuild only happens when the module actually fails to load, so normal
 * runs stay instant.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadError() {
  try {
    require('better-sqlite3');
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

const error = loadError();

if (!error) {
  process.exit(0);
}

const isAbiMismatch = /NODE_MODULE_VERSION|different Node\.js version|was compiled against/i.test(error.message);

if (!isAbiMismatch) {
  console.error('[sqlite-abi] better-sqlite3 could not be loaded:');
  console.error(error.message);
  process.exit(1);
}

console.log('[sqlite-abi] better-sqlite3 was built for a different ABI — rebuilding it for this Node runtime...');

const rebuild = spawnSync('npm', ['rebuild', 'better-sqlite3'], { stdio: 'inherit', shell: true });

if (rebuild.status !== 0) {
  console.error(`[sqlite-abi] Rebuild failed (exit ${String(rebuild.status)}).`);
  process.exit(rebuild.status ?? 1);
}

const remaining = loadError();

if (remaining) {
  console.error('[sqlite-abi] better-sqlite3 still cannot be loaded after the rebuild:');
  console.error(remaining.message);
  process.exit(1);
}

console.log('[sqlite-abi] Rebuild complete.');
