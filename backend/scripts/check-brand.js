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
    'plan.md',                   // historical phased-plan doc (legacy title)
    'backend/scripts/check-brand.js', // this checker necessarily contains the term
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
    'backend/scripts/seed.js',   // DB_URL default uses the retained DB name
];

function isAllowed(file) {
    if (ALLOWED.includes(file)) return true;
    if (INFRA_FILES.includes(file)) return true;
    return ALLOWED_PREFIXES.some((p) => file.startsWith(p));
}

// Repo-relative path of this script (POSIX slashes), so it can exclude itself
// from its own scans - it necessarily contains both search terms.
const selfRel = path.relative(repoRoot, __filename).split(path.sep).join('/');

// --- Scan 1: the legacy brand name outside its allow-listed locations ---------
let legacyViolations = [];
try {
    // -I skip binary, -n line numbers, -i case-insensitive. Exits 1 if none found.
    const matches = execSync('git grep -Ini equiledger -- . ":(exclude)node_modules"', {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    legacyViolations = matches
        .split('\n')
        .filter(Boolean)
        .filter((line) => !isAllowed(line.split(':')[0]));
} catch (e) {
    if (e.status !== 1) throw e; // status 1 = no matches (the good case)
}

// --- Scan 2: rename-corruption guard ------------------------------------------
// A blind find-replace of the brand (see commit 932089c) glued the new name
// into real words - class-va<x>ce, va<x>t, AlertT<x>gle, Eques<x>. Every
// legitimate brand token sits next to a separator or word boundary, so a LETTER
// glued directly onto either side of "airgead" is the corruption signature.
// Scoped to source files; generated/vendor files and this script are excluded.
let corruptionViolations = [];
try {
    const glued = execSync(
        'git grep -nIE "[A-Za-z][Aa]irgead|[Aa]irgead[A-Za-z]" -- '
        + '"*.js" "*.mjs" "*.ts" "*.tsx" "*.jsx" "*.sql" "*.json" '
        + '":(exclude)*package-lock.json" ":(exclude)*.tsbuildinfo" '
        + `":(exclude)${selfRel}"`,
        { cwd: repoRoot, encoding: 'utf8' },
    );
    corruptionViolations = glued.split('\n').filter(Boolean);
} catch (e) {
    if (e.status !== 1) throw e;
}

let failed = false;
if (legacyViolations.length > 0) {
    failed = true;
    console.error('check:brand FAILED - legacy brand name found outside allowed locations:\n');
    console.error(legacyViolations.join('\n'));
    console.error(`\n${legacyViolations.length} disallowed legacy reference(s). Replace with the BRAND constant or add to the allow-list in ${selfRel}.`);
}
if (corruptionViolations.length > 0) {
    failed = true;
    console.error('\ncheck:brand FAILED - rename corruption ("airgead" glued inside a word):\n');
    console.error(corruptionViolations.join('\n'));
    console.error('\nA find-replace hit real words (variance/variant/Triangle/Equestrian). Restore the original spelling.');
}
if (failed) process.exit(1);

console.log('check:brand - OK. No legacy references and no rename corruption.');
process.exit(0);
