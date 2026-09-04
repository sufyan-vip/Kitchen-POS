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
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const outputDir = join(process.cwd(), 'dist-electron');
const isWindows = process.platform === 'win32';
const isCI = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';
const optedOut = process.env.SKIP_PORTABLE_BUILD === 'true';

const portableDir = join(outputDir, 'portable');

function alreadyBuilt() {
  if (!existsSync(portableDir)) { return false; }
  return readdirSync(portableDir).some(name => /\.exe$/i.test(name));
}

/**
 * Move the artifact into dist-electron/portable/ so the installer build that
 * runs afterwards cannot overwrite or clean it away. The release workflow
 * uploads every .exe under dist-electron recursively, so a subdirectory is
 * still collected.
 */
function stashArtifact() {
  const produced = readdirSync(outputDir).filter(name => /portable.*\.exe$/i.test(name));
  if (produced.length === 0) {
    console.warn('[portable] Build reported success but no portable .exe was found.');
    return;
  }
  mkdirSync(portableDir, { recursive: true });
  for (const name of produced) {
    renameSync(join(outputDir, name), join(portableDir, name));
    console.log(`[portable] Stashed ${name} in dist-electron/portable/.`);
  }
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
    try {
      stashArtifact();
    } catch (e) {
      console.warn(`[portable] Could not move the artifact: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    // Never fail the pipeline: the installer is the primary deliverable.
    console.warn(`[portable] Portable build failed (exit ${String(result.status)}). Continuing — the installer build is unaffected.`);
  }
}
