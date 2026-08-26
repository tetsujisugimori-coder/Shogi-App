import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * Executes cleanup tasks sequentially, ensuring all tasks run even if some throw.
 * Returns an array of failed cleanup descriptors: { name: string, error: Error }.
 *
 * @param {Array<{ name: string, run: () => void | Promise<void> }>} cleanups
 * @returns {Promise<Array<{ name: string, error: Error }>>}
 */
export async function runCleanups(cleanups) {
  const errors = [];
  for (const cleanup of cleanups) {
    try {
      await cleanup.run();
    } catch (err) {
      const normalizedError = err instanceof Error ? err : new Error(String(err));
      errors.push({
        name: cleanup.name,
        error: normalizedError,
      });
    }
  }
  return errors;
}

/**
 * Combines a primary verification error with any cleanup errors.
 *
 * - If neither error exists, returns null.
 * - If only primary error exists, returns the primary error.
 * - If only cleanup errors exist:
 *     - Single cleanup error: returns a formatted Error with cause.
 *     - Multiple cleanup errors: returns an AggregateError.
 * - If both primary and cleanup errors exist: returns an AggregateError containing all errors.
 *
 * @param {Error|null} primaryError
 * @param {Array<{ name: string, error: Error }>} cleanupErrors
 * @returns {Error|AggregateError|null}
 */
export function combineErrors(primaryError, cleanupErrors = []) {
  const hasPrimary = Boolean(primaryError);
  const hasCleanups = cleanupErrors.length > 0;

  if (!hasPrimary && !hasCleanups) {
    return null;
  }

  if (!hasPrimary) {
    if (cleanupErrors.length === 1) {
      const single = cleanupErrors[0];
      const err = new Error(`Cleanup failed [${single.name}]: ${single.error.message}`);
      err.cause = single.error;
      return err;
    }
    const errors = cleanupErrors.map(
      (c) => new Error(`[${c.name}] ${c.error.message}`, { cause: c.error })
    );
    const message = `Multiple cleanup tasks failed (${cleanupErrors.length} errors):\n` +
      cleanupErrors.map((c) => ` - [${c.name}]: ${c.error.message}`).join('\n');
    return new AggregateError(errors, message);
  }

  if (!hasCleanups) {
    return primaryError;
  }

  const allErrors = [
    primaryError,
    ...cleanupErrors.map((c) => new Error(`[${c.name}] ${c.error.message}`, { cause: c.error })),
  ];
  const message = `Verification failed: ${primaryError.message}\nAdditionally, ${cleanupErrors.length} cleanup task(s) failed:\n` +
    cleanupErrors.map((c) => ` - [${c.name}]: ${c.error.message}`).join('\n');
  return new AggregateError(allErrors, message, { cause: primaryError });
}

/**
 * Creates and manages a Promise for native fsevents event reception.
 * Guards against race conditions, ensures getInfo() errors reject the Promise,
 * and clears timers on settlement.
 *
 * @param {Object} params
 * @param {any} params.fsevents - fsevents module instance or mock
 * @param {string} params.tempDir - Target directory path to watch
 * @param {number} [params.timeoutMs=5000] - Timeout in milliseconds
 * @param {Function} [params.getInfoFn] - Optional getInfo function override for testing
 * @returns {{
 *   eventPromise: Promise<{ filepath: string, flags: number, info: any }>,
 *   getStopWatcher: () => (() => Promise<void>|void) | null,
 *   clearTimer: () => void,
 *   isSettled: () => boolean
 * }}
 */
export function createFsEventPromise({ fsevents, tempDir, timeoutMs = 5000, getInfoFn }) {
  let fseventTimer = null;
  let stopWatcher = null;
  let settled = false;

  const eventPromise = new Promise((resolve, reject) => {
    fseventTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (fseventTimer) {
        clearTimeout(fseventTimer);
        fseventTimer = null;
      }
      reject(new Error('Timeout waiting for fsevents native event'));
    }, timeoutMs);

    try {
      stopWatcher = fsevents.watch(tempDir, (filepath, flags) => {
        if (settled) return;
        try {
          const infoGetter = getInfoFn || fsevents.getInfo;
          const info = infoGetter.call(fsevents, filepath, flags);
          settled = true;
          if (fseventTimer) {
            clearTimeout(fseventTimer);
            fseventTimer = null;
          }
          resolve({ filepath, flags, info });
        } catch (err) {
          settled = true;
          if (fseventTimer) {
            clearTimeout(fseventTimer);
            fseventTimer = null;
          }
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    } catch (e) {
      if (settled) return;
      settled = true;
      if (fseventTimer) {
        clearTimeout(fseventTimer);
        fseventTimer = null;
      }
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });

  return {
    eventPromise,
    getStopWatcher: () => stopWatcher,
    clearTimer: () => {
      if (fseventTimer) {
        clearTimeout(fseventTimer);
        fseventTimer = null;
      }
    },
    isSettled: () => settled,
  };
}

/**
 * Creates and manages a Promise for Vite watcher file change detection.
 *
 * @param {Object} params
 * @param {any} params.viteServer - Vite dev server instance
 * @param {number} [params.timeoutMs=6000] - Timeout in milliseconds
 * @returns {{
 *   promise: Promise<string>,
 *   getHandler: () => ((changedPath: string) => void) | null,
 *   clearTimer: () => void,
 *   isSettled: () => boolean
 * }}
 */
export function createViteWatcherPromise({ viteServer, timeoutMs = 6000 }) {
  let viteTimer = null;
  let viteChangeHandler = null;
  let settled = false;

  const promise = new Promise((resolve, reject) => {
    viteTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (viteTimer) {
        clearTimeout(viteTimer);
        viteTimer = null;
      }
      reject(new Error('Timeout waiting for Vite file watcher event'));
    }, timeoutMs);

    viteChangeHandler = (changedPath) => {
      if (settled) return;
      settled = true;
      if (viteTimer) {
        clearTimeout(viteTimer);
        viteTimer = null;
      }
      resolve(changedPath);
    };

    viteServer.watcher.on('change', viteChangeHandler);
  });

  return {
    promise,
    getHandler: () => viteChangeHandler,
    clearTimer: () => {
      if (viteTimer) {
        clearTimeout(viteTimer);
        viteTimer = null;
      }
    },
    isSettled: () => settled,
  };
}

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

  // 2. Test fsevents native file watching in an isolated temporary directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shogi-fsevents-test-'));
  console.log(` [2/3] Testing native fsevents watcher in temporary directory: ${tempDir}`);
  let stopWatcher = null;
  let fseventWatcherControl = null;
  let fseventPrimaryError = null;

  try {
    fseventWatcherControl = createFsEventPromise({
      fsevents,
      tempDir,
      timeoutMs: 5000,
    });

    // Give watcher brief moment to initialize
    await new Promise((r) => setTimeout(r, 100));

    stopWatcher = fseventWatcherControl.getStopWatcher();

    // Create a temporary file to trigger native event
    const triggerFile = path.join(tempDir, 'watch-trigger.txt');
    fs.writeFileSync(triggerFile, 'test content for fsevents', 'utf-8');

    const eventData = await fseventWatcherControl.eventPromise;
    console.log(`       fsevents native event received successfully: ${path.basename(eventData.filepath)}`);
  } catch (err) {
    fseventPrimaryError = err instanceof Error ? err : new Error(String(err));
  } finally {
    if (fseventWatcherControl) {
      fseventWatcherControl.clearTimer();
      stopWatcher = fseventWatcherControl.getStopWatcher() || stopWatcher;
    }

    const cleanups = [
      {
        name: 'fsevents watcher stop',
        run: async () => {
          if (stopWatcher) {
            await stopWatcher();
            stopWatcher = null;
          }
        },
      },
      {
        name: 'fsevents temp directory removal',
        run: () => {
          if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        },
      },
    ];

    const cleanupErrors = await runCleanups(cleanups);
    const combined = combineErrors(fseventPrimaryError, cleanupErrors);
    if (combined) {
      throw combined;
    }
  }

  // 3. Test Vite watcher in an isolated directory
  console.log(' [3/3] Testing Vite dev watcher integration...');
  const viteTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shogi-vite-watch-test-'));
  let viteServer = null;
  let viteWatcherControl = null;
  let vitePrimaryError = null;

  try {
    const { createServer } = await import('vite');
    fs.writeFileSync(path.join(viteTempDir, 'index.html'), '<html><body>Watcher Test</body></html>', 'utf-8');
    fs.writeFileSync(path.join(viteTempDir, 'test.js'), 'export const a = 1;', 'utf-8');

    viteServer = await createServer({
      root: viteTempDir,
      logLevel: 'error',
      server: {
        port: 0,
        middlewareMode: false,
      },
    });

    await viteServer.listen();

    viteWatcherControl = createViteWatcherPromise({
      viteServer,
      timeoutMs: 6000,
    });

    // Allow watcher to initialize
    await new Promise((r) => setTimeout(r, 200));

    // Modify file
    fs.appendFileSync(path.join(viteTempDir, 'test.js'), '\nexport const b = 2;');

    const changedFile = await viteWatcherControl.promise;
    console.log(`       Vite watcher detected file change successfully: ${path.basename(changedFile)}`);
  } catch (err) {
    vitePrimaryError = err instanceof Error ? err : new Error(String(err));
  } finally {
    if (viteWatcherControl) {
      viteWatcherControl.clearTimer();
    }

    const cleanups = [
      {
        name: 'Vite listener removal',
        run: () => {
          const handler = viteWatcherControl?.getHandler();
          if (handler && viteServer?.watcher) {
            viteServer.watcher.off('change', handler);
          }
        },
      },
      {
        name: 'Vite server close',
        run: async () => {
          if (viteServer) {
            await viteServer.close();
            viteServer = null;
          }
        },
      },
      {
        name: 'Vite temp directory removal',
        run: () => {
          if (fs.existsSync(viteTempDir)) {
            fs.rmSync(viteTempDir, { recursive: true, force: true });
          }
        },
      },
    ];

    const cleanupErrors = await runCleanups(cleanups);
    const combined = combineErrors(vitePrimaryError, cleanupErrors);
    if (combined) {
      throw combined;
    }
  }

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
