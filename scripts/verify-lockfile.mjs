import fs from 'node:fs';
import path from 'node:path';

/**
 * Validates package-lock.json integrity, schema consistency, and lockfile exclusivity.
 */
function verifyLockfile() {
  const rootDir = process.cwd();
  const errors = [];
  const warnings = [];

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
    console.error('[verify:lock] package.json not found');
    process.exit(1);
  }
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch (err) {
    console.error('[verify:lock] Failed to parse package.json:', err.message);
    process.exit(1);
  }

  // 3. package-lock.json existence & parsing
  const lockPath = path.resolve(rootDir, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    console.error('[verify:lock] package-lock.json not found');
    process.exit(1);
  }
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  } catch (err) {
    console.error('[verify:lock] Failed to parse package-lock.json:', err.message);
    process.exit(1);
  }

  // 4. Root name & lockfileVersion validation
  if (lock.name !== 'shogi-app') {
    errors.push(`package-lock.json root name mismatch: expected "shogi-app", got "${lock.name}"`);
  }
  if (lock.lockfileVersion !== 3) {
    errors.push(`package-lock.json lockfileVersion mismatch: expected 3, got ${lock.lockfileVersion}`);
  }

  // 5. Root dependencies & devDependencies consistency with package.json
  const rootPackage = lock.packages?.[''] || {};
  const pkgDeps = pkg.dependencies || {};
  const lockDeps = rootPackage.dependencies || lock.dependencies || {};
  for (const [dep, ver] of Object.entries(pkgDeps)) {
    if (!lockDeps[dep]) {
      errors.push(`Missing dependency "${dep}" in package-lock.json root`);
    }
  }

  const pkgDevDeps = pkg.devDependencies || {};
  const lockDevDeps = rootPackage.devDependencies || lock.devDependencies || {};
  for (const [dep, ver] of Object.entries(pkgDevDeps)) {
    if (!lockDevDeps[dep]) {
      errors.push(`Missing devDependency "${dep}" in package-lock.json root`);
    }
  }

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

  console.log('--- Lockfile Verification Summary ---');
  console.log(`Lockfile Name:           ${lock.name}`);
  console.log(`Lockfile Version:        ${lock.lockfileVersion}`);
  console.log(`Total Package Entries:   ${totalPackages}`);
  console.log(`Inspected Registry Pkgs: ${inspectedCount}`);
  console.log(`Valid Exceptions:        ${exceptionCount}`);
  console.log(`Missing "resolved":      ${missingResolvedCount}`);
  console.log(`Missing "integrity":     ${missingIntegrityCount}`);

  if (errors.length > 0) {
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

verifyLockfile();
