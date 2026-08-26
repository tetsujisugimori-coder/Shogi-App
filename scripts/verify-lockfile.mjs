import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Validates lockfile integrity, exact matching dependencies with package.json, and checking forbidden lockfiles.
 * @param {string} [rootDir=process.cwd()]
 * @returns {{ valid: boolean, errors: string[], summary: { lockfileName: string, lockfileVersion: number | string, totalEntries: number, inspected: number, exceptions: number, missingResolved: number, missingIntegrity: number } }}
 */
export function validateLockfile(rootDir = process.cwd()) {
  const errors = [];

  // 1. Prohibited lockfile check
  const prohibitedLockfiles = ['bun.lock', 'bun.lockb', 'yarn.lock', 'pnpm-lock.yaml'];
  for (const file of prohibitedLockfiles) {
    if (fs.existsSync(path.resolve(rootDir, file))) {
      errors.push(`Prohibited lockfile found: ${file}`);
    }
  }

  // 2. package.json existence & parsing
  const pkgPath = path.resolve(rootDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return {
      valid: false,
      errors: ['package.json not found'],
      summary: {
        lockfileName: 'N/A',
        lockfileVersion: 'N/A',
        totalEntries: 0,
        inspected: 0,
        exceptions: 0,
        missingResolved: 0,
        missingIntegrity: 0,
      },
    };
  }
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch (err) {
    return {
      valid: false,
      errors: [`Failed to parse package.json: ${err.message}`],
      summary: {
        lockfileName: 'N/A',
        lockfileVersion: 'N/A',
        totalEntries: 0,
        inspected: 0,
        exceptions: 0,
        missingResolved: 0,
        missingIntegrity: 0,
      },
    };
  }

  // 3. package-lock.json existence & parsing
  const lockPath = path.resolve(rootDir, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    return {
      valid: false,
      errors: ['package-lock.json not found'],
      summary: {
        lockfileName: 'N/A',
        lockfileVersion: 'N/A',
        totalEntries: 0,
        inspected: 0,
        exceptions: 0,
        missingResolved: 0,
        missingIntegrity: 0,
      },
    };
  }
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  } catch (err) {
    return {
      valid: false,
      errors: [`Failed to parse package-lock.json: ${err.message}`],
      summary: {
        lockfileName: 'N/A',
        lockfileVersion: 'N/A',
        totalEntries: 0,
        inspected: 0,
        exceptions: 0,
        missingResolved: 0,
        missingIntegrity: 0,
      },
    };
  }

  // 4. Root name & lockfileVersion validation (Compare with pkg.name)
  if (lock.name !== pkg.name) {
    errors.push(`package-lock.json root name mismatch: expected "${pkg.name}", got "${lock.name}"`);
  }
  if (lock.lockfileVersion !== 3) {
    errors.push(`package-lock.json lockfileVersion mismatch: expected 3, got ${lock.lockfileVersion}`);
  }

  // 5. Exact match comparison for dependencies and devDependencies
  const rootPackage = lock.packages?.[''] || {};

  function compareDeps(field, expectedDeps, actualDeps) {
    const expected = expectedDeps || {};
    const actual = actualDeps || {};

    const expectedKeys = Object.keys(expected);
    const actualKeys = Object.keys(actual);

    // Missing in lockfile or version mismatch
    for (const key of expectedKeys) {
      if (!(key in actual)) {
        errors.push(
          `Missing ${field} in package-lock.json root: "${key}" (expected "${expected[key]}", but was missing)`
        );
      } else if (actual[key] !== expected[key]) {
        errors.push(
          `Version mismatch for ${field} "${key}": expected "${expected[key]}", got "${actual[key]}" in package-lock.json root`
        );
      }
    }

    // Extra in lockfile
    for (const key of actualKeys) {
      if (!(key in expected)) {
        errors.push(
          `Extra ${field} in package-lock.json root: "${key}" (found "${actual[key]}", but not present in package.json)`
        );
      }
    }
  }

  compareDeps('dependencies', pkg.dependencies, rootPackage.dependencies || lock.dependencies);
  compareDeps('devDependencies', pkg.devDependencies, rootPackage.devDependencies || lock.devDependencies);

  // 6. Packages entries inspection (resolved & integrity validation)
  const packages = lock.packages || {};
  const allKeys = Object.keys(packages);
  const totalPackages = allKeys.length;

  let inspectedCount = 0;
  let exceptionCount = 0;
  let missingResolvedCount = 0;
  let missingIntegrityCount = 0;

  for (const [key, pkgInfo] of Object.entries(packages)) {
    if (key === '') {
      continue; // Root project package
    }

    // Legitimate exceptions: symbolic links or workspaces
    if (pkgInfo.link === true || pkgInfo.symlink === true) {
      exceptionCount++;
      continue;
    }

    inspectedCount++;

    if (!pkgInfo.version) {
      errors.push(`Package "${key}" is missing "version" field`);
    }

    if (!pkgInfo.resolved) {
      missingResolvedCount++;
      errors.push(`Package "${key}" is missing "resolved" field`);
    }

    if (!pkgInfo.integrity) {
      missingIntegrityCount++;
      errors.push(`Package "${key}" is missing "integrity" field`);
    }
  }

  const summary = {
    lockfileName: lock.name,
    lockfileVersion: lock.lockfileVersion,
    totalEntries: totalPackages,
    inspected: inspectedCount,
    exceptions: exceptionCount,
    missingResolved: missingResolvedCount,
    missingIntegrity: missingIntegrityCount,
  };

  return {
    valid: errors.length === 0,
    errors,
    summary,
  };
}

export function printSummaryAndExit(result) {
  const { valid, errors, summary } = result;

  console.log('--- Lockfile Verification Summary ---');
  console.log(`Lockfile Name:           ${summary.lockfileName}`);
  console.log(`Lockfile Version:        ${summary.lockfileVersion}`);
  console.log(`Total Package Entries:   ${summary.totalEntries}`);
  console.log(`Inspected Registry Pkgs: ${summary.inspected}`);
  console.log(`Valid Exceptions:        ${summary.exceptions}`);
  console.log(`Missing "resolved":      ${summary.missingResolved}`);
  console.log(`Missing "integrity":     ${summary.missingIntegrity}`);

  if (!valid) {
    console.error(`\n[verify:lock] FAILED with ${errors.length} error(s):`);
    for (const err of errors.slice(0, 10)) {
      console.error(` - ${err}`);
    }
    if (errors.length > 10) {
      console.error(` ... and ${errors.length - 10} more errors`);
    }
    process.exit(1);
  }

  console.log('\n[verify:lock] SUCCESS: package-lock.json is valid and complete.\n');
  process.exit(0);
}

// Run if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = validateLockfile();
  printSummaryAndExit(result);
}
