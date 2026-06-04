#!/usr/bin/env node
/*
 * Task 6 — one-time, MANUAL bucket lockdown.
 *
 * After migration 004_receipt_path rewrites DB values to object paths and the
 * app starts serving receipts via signed URLs, existing objects in the bucket
 * are still PUBLIC. This script removes public access from every object so
 * receipts can only be reached through short-lived signed URLs.
 *
 * Run manually, never automatically:
 *   GOOGLE_CLOUD_STORAGE_BUCKET=<bucket> \
 *   GOOGLE_CLOUD_PROJECT_ID=<project> \
 *   GOOGLE_APPLICATION_CREDENTIALS=<sa-key.json> \
 *   node scripts/lockdown-bucket.js [--dry-run]
 *
 * --dry-run lists what would change without modifying anything.
 */
require('dotenv').config();
const { getBucket } = require('../src/utils/gcs');

const dryRun = process.argv.includes('--dry-run');

async function main() {
    const bucket = getBucket();
    console.log(`${dryRun ? '[dry-run] ' : ''}Locking down bucket: ${bucket.name}`);

    const [files] = await bucket.getFiles();
    console.log(`Found ${files.length} object(s).`);

    let changed = 0;
    for (const file of files) {
        try {
            if (dryRun) {
                console.log(`[dry-run] would makePrivate: ${file.name}`);
                changed++;
                continue;
            }
            await file.makePrivate();
            changed++;
            if (changed % 100 === 0) console.log(`  ...${changed} processed`);
        } catch (err) {
            console.error(`  failed for ${file.name}: ${err.message}`);
        }
    }

    console.log(`${dryRun ? '[dry-run] ' : ''}Done. ${changed}/${files.length} object(s) ${dryRun ? 'would be' : 'were'} made private.`);
}

main().catch((err) => {
    console.error('lockdown-bucket failed:', err);
    process.exit(1);
});
