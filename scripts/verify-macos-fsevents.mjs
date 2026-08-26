import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * Verifies fsevents loading, native watching, and Vite file watcher functionality on macOS (darwin).
 * If executed on non-darwin platforms (e.g. Linux CI/container), performs static inspection and logs platform info.
 */
export async function verifyMacOsFsevents(options = {}) {
  const isDarwin = process.platform === 'darwin';
  console.log(`[verify:macos-fsevents] Running on platform: ${process.platform} (${os.type()} ${os.release()})`);

  if (!isDarwin) {
    console.log('[verify:macos-fsevents] Current platform is not darwin (macOS).');
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
    console.log('[verify:macos-fsevents] Non-darwin platform check passed.');
    return { success: true, platform: process.platform, isDarwin: false };
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
  try {
    let eventReceived = false;
    let stopWatcher = null;

    const eventPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!eventReceived) {
          reject(new Error('Timeout waiting for fsevents native event'));
        }
      }, 5000);

      try {
        stopWatcher = fsevents.watch(tempDir, (filepath, flags) => {
          eventReceived = true;
          clearTimeout(timer);
          resolve({ filepath, flags, info: fsevents.getInfo(filepath, flags) });
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });

    // Allow fsevents to start listening
    await new Promise((r) => setTimeout(r, 100));

    // Create a temporary file to trigger native event
    const triggerFile = path.join(tempDir, 'watch-trigger.txt');
    fs.writeFileSync(triggerFile, 'test content for fsevents', 'utf-8');

    const eventData = await eventPromise;
    console.log(`       fsevents native event received successfully: ${path.basename(eventData.filepath)}`);

    if (stopWatcher) {
      await stopWatcher();
    }
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  // 3. Test Vite watcher in an isolated directory
  console.log(' [3/3] Testing Vite dev watcher integration...');
  const viteTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shogi-vite-watch-test-'));
  let viteServer = null;
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

    let viteChangeDetected = false;
    const vitePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!viteChangeDetected) {
          reject(new Error('Timeout waiting for Vite file watcher event'));
        }
      }, 6000);

      viteServer.watcher.on('change', (changedPath) => {
        viteChangeDetected = true;
        clearTimeout(timer);
        resolve(changedPath);
      });
    });

    // Allow watcher to initialize
    await new Promise((r) => setTimeout(r, 200));

    // Modify file
    fs.appendFileSync(path.join(viteTempDir, 'test.js'), '\nexport const b = 2;');

    const changedFile = await vitePromise;
    console.log(`       Vite watcher detected file change successfully: ${path.basename(changedFile)}`);
  } finally {
    if (viteServer) {
      await viteServer.close();
    }
    if (fs.existsSync(viteTempDir)) {
      fs.rmSync(viteTempDir, { recursive: true, force: true });
    }
  }

  console.log('[verify:macos-fsevents] All macOS fsevents & Vite watcher tests PASSED successfully.\n');
  return { success: true, platform: 'darwin', isDarwin: true };
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
