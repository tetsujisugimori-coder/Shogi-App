import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Cross-platform clean script using Node.js standard fs/promises.
 * Deletes only 'dist' and 'server.js' (if exists).
 * Works reliably on Windows (cmd/PowerShell), macOS, and Linux without external shell dependencies.
 */
async function clean() {
  const rootDir = process.cwd();
  const targets = ['dist', 'server.js'];

  for (const target of targets) {
    const targetPath = resolve(rootDir, target);
    try {
      await rm(targetPath, { recursive: true, force: true });
      console.log(`[clean] Successfully removed: ${target}`);
    } catch (error) {
      console.error(`[clean] Failed to remove ${target}:`, error);
      process.exit(1);
    }
  }
}

clean();
