#!/usr/bin/env node
// Brand regression check (Task 0.4): fail if the legacy product name still
// appears anywhere outside the small set of allowed locations.
//
// Allowed remaining references:
//   - docs/rename-runbook.md            (documents the rename itself)
//   - src/config/brand.js / lib/brand.ts (BRAND_LEGACY constant)
//   - backend/migrations/*.sql          (historical migration comments)
//   - infra / DB-name references        (Postgres DB name + URLs are out of
//                                         scope for Phase 0 - see Task 0.3)
//
// Run from the repo root or backend/: `npm run check:brand`.

const { execSync } = require('child_process');
const path = require('path');

// Resolve repo root regardless of where the script is invoked from.
const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

const ALLOWED = [
    'docs/rename-runbook.md',
    'backend/src/config/brand.js',
    'frontend/src/lib/brand.ts',
    'README.md',                 // single "formerly EquiLedger" note
];

const ALLOWED_PREFIXES = [
    'backend/migrations/',       // historical migration comments
];

// Infra / DB-name files: the Postgres database name "equiledger" is left as-is
// in Phase 0 (Task 0.3), so lowercase references in these are expected.
const INFRA_FILES = [
    'backend/.env.example',
    'frontend/.env.local.example',
    'docker-compose.yml',
];

function isAllowed(file) {
    if (ALLOWED.includes(file)) return true;
    if (INFRA_FILES.includes(file)) return true;
    return ALLOWED_PREFIXES.some((p) => file.startsWith(p));
}

let matches = '';
try {
    // -I skip binary, -n line numbers, -i case-insensitive. Exits 1 if none found.
    matches = execSync('git grep -Ini equiledger -- . ":(exclude)node_modules"', {
        cwd: repoRoot,
        encoding: 'utf8',
    });
} catch (e) {
    if (e.status === 1) {
        console.log('check:brand - no references to the legacy name found.');
        process.exit(0);
    }
    throw e;
}

const violations = matches
    .split('\n')
    .filter(Boolean)
    .filter((line) => {
        const file = line.split(':')[0];
        return !isAllowed(file);
    });

if (violations.length > 0) {
    console.error('check:brand FAILED - legacy brand name found outside allowed locations:\n');
    console.error(violations.join('\n'));
    console.error(`\n${violations.length} disallowed reference(s). Replace with the BRAND constant or add to the allow-list in ${path.relative(repoRoot, __filename)} if intentional.`);
    process.exit(1);
}

console.log('check:brand - OK. Remaining references are all in allowed locations.');
process.exit(0);
