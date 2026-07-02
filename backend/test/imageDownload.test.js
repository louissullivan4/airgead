/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { Readable } = require('stream');
const sinon = require('sinon');
const { expect } = require('@jest/globals');

const storage = require('../src/utils/storage');
const { downloadImages } = require('../src/middlewares/imageDownload');

// Regression suite for the "exported zip had no receipt" bug: Phase 2 camera
// captures store the image on the receipts row (surfaced to exports as
// receipt_object_path), not in the legacy expenses.receipt_image_url column.

describe('downloadImages', () => {
    let imagesDir;

    beforeEach(async () => {
        imagesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'airgead-imgdl-'));
    });

    afterEach(async () => {
        sinon.restore();
        await fs.remove(imagesDir);
    });

    const stubStorage = () => {
        sinon.stub(storage, 'exists').resolves(true);
        sinon.stub(storage, 'createReadStream').callsFake(() => Readable.from(['fake-jpeg-bytes']));
    };

    it('downloads the image of a RECEIPT-linked expense (the Phase 2 capture flow)', async () => {
        stubStorage();
        const expense = {
            id: 'e1',
            receipt_id: 'r1',
            receipt_object_path: 'org_1/2026/r1.jpg',
            receipt_image_url: null,
        };

        await downloadImages([expense], imagesDir);

        expect(expense.local_image_path).toBeTruthy();
        expect(await fs.pathExists(expense.local_image_path)).toBe(true);
        expect(storage.exists.calledWith('org_1/2026/r1.jpg')).toBe(true);
    });

    it('still downloads legacy expenses that only carry receipt_image_url', async () => {
        stubStorage();
        const expense = { id: 'e2', receipt_object_path: null, receipt_image_url: 'ids/old.jpg' };

        await downloadImages([expense], imagesDir);

        expect(expense.local_image_path).toBeTruthy();
        expect(storage.exists.calledWith('ids/old.jpg')).toBe(true);
    });

    it('prefers the receipts-row path when both exist', async () => {
        stubStorage();
        const expense = {
            id: 'e3',
            receipt_object_path: 'org_1/2026/new.jpg',
            receipt_image_url: 'ids/stale.jpg',
        };

        await downloadImages([expense], imagesDir);

        expect(storage.exists.calledWith('org_1/2026/new.jpg')).toBe(true);
        expect(storage.exists.calledWith('ids/stale.jpg')).toBe(false);
    });

    it('downloads a shared receipt ONCE and points every line item at the same file', async () => {
        stubStorage();
        const lineA = { id: 'a', receipt_object_path: 'org_1/2026/shared.jpg' };
        const lineB = { id: 'b', receipt_object_path: 'org_1/2026/shared.jpg' };

        await downloadImages([lineA, lineB], imagesDir);

        expect(storage.createReadStream.calledOnce).toBe(true);
        expect(lineA.local_image_path).toBeTruthy();
        expect(lineA.local_image_path).toBe(lineB.local_image_path);
    });

    it('leaves expenses without any image source untouched and never hits storage', async () => {
        const exists = sinon.stub(storage, 'exists');
        const expense = { id: 'e4', receipt_object_path: null, receipt_image_url: null };

        await downloadImages([expense], imagesDir);

        expect(expense.local_image_path).toBeUndefined();
        expect(exists.notCalled).toBe(true);
    });

    it('a missing storage object is skipped (null path), not fatal to the export', async () => {
        sinon.stub(storage, 'exists').resolves(false);
        const expense = { id: 'e5', receipt_object_path: 'org_1/2026/gone.jpg' };

        await downloadImages([expense], imagesDir);

        expect(expense.local_image_path).toBeNull();
    });
});
