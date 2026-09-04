#!/usr/bin/env node
/**
 * Build the single-file Windows portable executable.
 *
 * Why this exists as a build-script step rather than a CI step: the release
 * workflow invokes `npx electron-builder --win nsis`, and an explicit target
 * list on the CLI replaces the `win.target` list in electron-builder.yml — so
 * the `portable` target configured there would otherwise never be produced.
 * Running it here, right after the renderer/main bundles are built and the
 * native modules have been rebuilt for Electron, yields both artifacts in
 * dist-electron/.
 *
 * It is a deliberate no-op unless it is running on a Windows CI machine, and a
 * failure here never fails the build — the NSIS installer is the primary
 * artifact and must always be produced.
 *
 * Locally, use `npm run package:win` to build the installer and the portable
 * executable together.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const outputDir = join(process.cwd(), 'dist-electron');
const isWindows = process.platform === 'win32';
const isCI = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';
const optedOut = process.env.SKIP_PORTABLE_BUILD === 'true';

function alreadyBuilt() {
  if (!existsSync(outputDir)) { return false; }
  return readdirSync(outputDir).some(name => /portable.*\.exe$/i.test(name));
}

if (optedOut) {
  console.log('[portable] SKIP_PORTABLE_BUILD=true — skipping.');
} else if (!isWindows || !isCI) {
  console.log(`[portable] Skipping (platform=${process.platform}, ci=${String(isCI)}). Use "npm run package:win" locally.`);
} else if (alreadyBuilt()) {
  console.log('[portable] A portable executable already exists — skipping.');
} else {
  console.log('[portable] Building the Windows portable executable...');
  const result = spawnSync('npx', ['electron-builder', '--win', 'portable', '--publish', 'never'], {
    stdio: 'inherit',
    shell: true,
  });

  if (result.status === 0) {
    console.log('[portable] Portable executable built.');
  } else {
    // Never fail the pipeline: the installer is the primary deliverable.
    console.warn(`[portable] Portable build failed (exit ${String(result.status)}). Continuing — the installer build is unaffected.`);
  }
}
