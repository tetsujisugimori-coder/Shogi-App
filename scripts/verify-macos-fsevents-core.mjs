import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
 * Executes the isolated native fsevents watcher verification phase.
 * Accepts dependencies for full testability without leaking resources.
 *
 * @param {Object} [deps]
 * @param {any} [deps.fs] - File system implementation (default: node:fs)
 * @param {any} [deps.fsevents] - fsevents module or mock (required)
 * @param {string} [deps.tempDir] - Optional custom temporary directory path
 * @param {number} [deps.timeoutMs=5000] - Timeout in milliseconds
 * @param {number} [deps.settleDelayMs=100] - Settling delay before trigger
 * @param {Function} [deps.getInfoFn] - Optional getInfo function override
 * @returns {Promise<{ filepath: string, flags: number, info: any }>}
 */
export async function verifyFseventsNativePhase(deps = {}) {
  const fsImpl = deps.fs || fs;
  const fseventsImpl = deps.fsevents;
  if (!fseventsImpl) {
    throw new Error('fsevents module is required for verifyFseventsNativePhase');
  }

  const tempDir = deps.tempDir || fsImpl.mkdtempSync(path.join(os.tmpdir(), 'shogi-fsevents-test-'));
  let stopWatcher = null;
  let fseventWatcherControl = null;
  let fseventPrimaryError = null;
  let eventData = null;

  try {
    fseventWatcherControl = createFsEventPromise({
      fsevents: fseventsImpl,
      tempDir,
      timeoutMs: deps.timeoutMs ?? 5000,
      getInfoFn: deps.getInfoFn,
    });

    if (deps.settleDelayMs !== 0) {
      await new Promise((r) => setTimeout(r, deps.settleDelayMs ?? 100));
    }

    stopWatcher = fseventWatcherControl.getStopWatcher();

    // Trigger file change
    const triggerFile = path.join(tempDir, 'watch-trigger.txt');
    fsImpl.writeFileSync(triggerFile, 'test content for fsevents', 'utf-8');

    eventData = await fseventWatcherControl.eventPromise;
    return eventData;
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
          if (fsImpl.existsSync(tempDir)) {
            fsImpl.rmSync(tempDir, { recursive: true, force: true });
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

  return eventData;
}

/**
 * Executes the isolated Vite dev watcher verification phase.
 * Accepts dependencies for full testability without loading Vite in Vitest jsdom.
 *
 * @param {Object} [deps]
 * @param {any} [deps.fs] - File system implementation (default: node:fs)
 * @param {Function} [deps.createServer] - Vite createServer function (required)
 * @param {string} [deps.tempDir] - Optional custom temporary directory path
 * @param {number} [deps.timeoutMs=6000] - Timeout in milliseconds
 * @param {number} [deps.settleDelayMs=200] - Settling delay before trigger
 * @returns {Promise<string>} Path of the modified file detected by Vite
 */
export async function verifyViteWatcherPhase(deps = {}) {
  const fsImpl = deps.fs || fs;
  const createServerFn = deps.createServer;
  if (!createServerFn) {
    throw new Error('createServer function is required for verifyViteWatcherPhase');
  }

  const viteTempDir = deps.tempDir || fsImpl.mkdtempSync(path.join(os.tmpdir(), 'shogi-vite-watch-test-'));
  let viteServer = null;
  let viteWatcherControl = null;
  let vitePrimaryError = null;
  let changedFile = null;

  try {
    fsImpl.writeFileSync(path.join(viteTempDir, 'index.html'), '<html><body>Watcher Test</body></html>', 'utf-8');
    fsImpl.writeFileSync(path.join(viteTempDir, 'test.js'), 'export const a = 1;', 'utf-8');

    viteServer = await createServerFn({
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
      timeoutMs: deps.timeoutMs ?? 6000,
    });

    if (deps.settleDelayMs !== 0) {
      await new Promise((r) => setTimeout(r, deps.settleDelayMs ?? 200));
    }

    // Modify file
    fsImpl.appendFileSync(path.join(viteTempDir, 'test.js'), '\nexport const b = 2;');

    changedFile = await viteWatcherControl.promise;
    return changedFile;
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
          if (fsImpl.existsSync(viteTempDir)) {
            fsImpl.rmSync(viteTempDir, { recursive: true, force: true });
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

  return changedFile;
}
