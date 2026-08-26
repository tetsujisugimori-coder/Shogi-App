import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  runCleanups,
  combineErrors,
  createFsEventPromise,
  createViteWatcherPromise,
  verifyFseventsNativePhase,
  verifyViteWatcherPhase,
} from './verify-macos-fsevents-core.mjs';

const require = createRequire(import.meta.url);

// Re-export all core helpers for testability and backwards compatibility
export {
  runCleanups,
  combineErrors,
  createFsEventPromise,
  createViteWatcherPromise,
  verifyFseventsNativePhase,
  verifyViteWatcherPhase,
};

/**
 * Verifies fsevents loading, native watching, and Vite file watcher functionality on macOS (darwin).
 * On non-darwin platforms (Linux/Windows), performs static inspection and logs platform info.
 * This public function accepts no parameters to prevent environment spoofing or step skipping.
 *
 * @returns {Promise<{ success: boolean, platform: string, isDarwin: boolean, nativeVerified: boolean }>}
 */
export async function verifyMacOsFsevents() {
  const currentPlatform = process.platform;
  const isDarwin = currentPlatform === 'darwin';
  console.log(`[verify:macos-fsevents] Running on platform: ${currentPlatform} (${os.type()} ${os.release()})`);

  if (!isDarwin) {
    console.log('[verify:macos-fsevents] Current platform is not darwin (macOS).');
    console.log('[verify:macos-fsevents] Static inspection note: macOS native watching was NOT executed on this platform.');
    console.log('[verify:macos-fsevents] Static inspection note: Vite watcher macOS native path was NOT executed on this platform.');
    console.log('[verify:macos-fsevents] Inspecting package-lock.json for fsevents metadata:');

    const lockPath = path.resolve(process.cwd(), 'package-lock.json');
    if (fs.existsSync(lockPath)) {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      const fseventsPkg = lock.packages?.['node_modules/fsevents'];
      if (fseventsPkg) {
        console.log(` - fsevents version: ${fseventsPkg.version}`);
        console.log(` - fsevents optional: ${fseventsPkg.optional}`);
        console.log(` - fsevents os constraint: ${JSON.stringify(fseventsPkg.os)}`);
        console.log(` - fsevents hasInstallScript: ${fseventsPkg.hasInstallScript}`);
      } else {
        console.log(' - fsevents not found in package-lock.json node_modules');
      }
    }
    console.log('[verify:macos-fsevents] Non-darwin platform static check passed (native macOS watch skipped).');
    return { success: true, platform: currentPlatform, isDarwin: false, nativeVerified: false };
  }

  // --- macOS (Darwin) verification ---
  console.log('[verify:macos-fsevents] Starting macOS-specific fsevents and Vite watcher verification...');

  // 1. Verify fsevents module resolution and loading
  let fsevents;
  try {
    fsevents = require('fsevents');
    console.log(' [1/3] Successfully required fsevents module on macOS');
  } catch (err) {
    console.error(` [1/3] FAILED to require fsevents: ${err.message}`);
    throw err;
  }

  if (typeof fsevents.watch !== 'function' || typeof fsevents.getInfo !== 'function') {
    throw new Error('fsevents module does not export expected watch/getInfo functions');
  }
  console.log('       fsevents API exports verified (watch, getInfo, constants)');

  // 2. Native fsevents watcher phase
  console.log(' [2/3] Testing native fsevents watcher in temporary directory...');
  const eventData = await verifyFseventsNativePhase({
    fs,
    fsevents,
  });
  console.log(`       fsevents native event received successfully: ${path.basename(eventData.filepath)}`);

  // 3. Vite watcher phase (Vite is dynamically imported only on macOS during standalone verification)
  console.log(' [3/3] Testing Vite dev watcher integration...');
  const { createServer } = await import('vite');
  const changedFile = await verifyViteWatcherPhase({
    fs,
    createServer,
  });
  console.log(`       Vite watcher detected file change successfully: ${path.basename(changedFile)}`);

  console.log('[verify:macos-fsevents] All macOS fsevents & Vite watcher tests PASSED successfully.\n');
  return { success: true, platform: 'darwin', isDarwin: true, nativeVerified: true };
}

// Run directly from CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  verifyMacOsFsevents()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n[verify:macos-fsevents] FAILED:', err);
      process.exit(1);
    });
}
