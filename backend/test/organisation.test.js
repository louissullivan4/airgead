/* eslint-disable no-undef */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const sinon = require('sinon');
const { expect } = require('@jest/globals');

const organisationModel = require('../src/models/organisationModel');
const organisationController = require('../src/controllers/organisationController');
const { getTemplateFor, DEFAULT_TEMPLATE } = require('../src/config/categoryTemplates');

const makeRes = () => ({ status: sinon.stub().returnsThis(), json: sinon.stub(), sendStatus: sinon.stub() });

// Fake pg client whose query() returns the right RETURNING rows based on the
// SQL it receives, so createUserWithOrg's transaction runs end to end.
const makeClient = () => {
    const query = sinon.stub().callsFake((sql) => {
        if (/INSERT INTO organisations/i.test(sql)) return Promise.resolve({ rows: [{ id: 'org-1' }] });
        if (/INSERT INTO users/i.test(sql)) {
            return Promise.resolve({ rows: [{ id: 'user-1', email: 'e@x.ie', org_id: 'org-1', org_role: 'owner' }] });
        }
        return Promise.resolve({ rows: [] });
    });
    return { query, release: sinon.stub() };
};

// Pull the params array passed to the `INSERT INTO organisations` query.
const orgInsertParams = (client) =>
    client.query.getCalls().find((c) => /INSERT INTO organisations/i.test(c.args[0])).args[1];

describe('Organisation signup provisioning', () => {
    afterEach(() => sinon.restore());

    it('creates a described org from the signup payload, deriving a business type and seeding categories', async () => {
        const client = makeClient();
        const pool = { connect: sinon.stub().resolves(client) };

        await organisationModel.createUserWithOrg(pool, {
            mode: 'self',
            inviterId: null,
            user: {
                fname: 'Aoife', sname: 'Byrne', email: 'aoife@x.ie', currency: 'EUR', password: 'hash',
                organisation: {
                    name: 'Galway Equine',
                    description: 'Sport horse yard',
                    country: 'IE',
                    vat_number: 'IE1234567T',
                    org_category: 'sole_trader_equine',
                },
            },
        });

        const [name, type, description, country, vat, slug, categoriesJson] = orgInsertParams(client);
        expect(name).toBe('Galway Equine');
        expect(type).toBe('business'); // non-personal slug => business
        expect(description).toBe('Sport horse yard');
        expect(country).toBe('IE');
        expect(vat).toBe('IE1234567T');
        expect(slug).toBe('sole_trader_equine');
        // categories is seeded from the equine template (jsonb passed as a JSON string)
        expect(JSON.parse(categoriesJson)).toEqual(getTemplateFor('sole_trader_equine'));
    });

    it('still provisions an auto-named personal org with default categories when org is skipped', async () => {
        const client = makeClient();
        const pool = { connect: sinon.stub().resolves(client) };

        await organisationModel.createUserWithOrg(pool, {
            mode: 'self',
            inviterId: null,
            user: { fname: 'Sean', sname: 'Murphy', email: 'sean@x.ie', currency: 'EUR', password: 'hash' },
        });

        const [name, type, description, country, vat, slug, categoriesJson] = orgInsertParams(client);
        expect(name).toBe('Sean Murphy');
        expect(type).toBe('personal');
        expect(description).toBe(null);
        expect(country).toBe('IE');
        expect(vat).toBe(null);
        expect(slug).toBe('personal');
        expect(JSON.parse(categoriesJson)).toEqual(DEFAULT_TEMPLATE);
    });
});

describe('GET /organisations/:id/categories', () => {
    afterEach(() => sinon.restore());

    const reqFor = (orgId, paramId = orgId) => ({
        pool: {},
        params: { id: paramId },
        orgId,
        user: { userId: 'u-1', orgId, platformRole: 'user' },
    });

    it('returns the type template (isCustom:false) when the org has no stored tree', async () => {
        sinon.stub(organisationModel, 'getOrgById').resolves({ org_category: 'consultant', categories: null });
        const res = makeRes();

        await organisationController.getCategories(reqFor('org-A'), res);

        expect(res.status.calledWith(200)).toBe(true);
        const body = res.json.firstCall.args[0];
        expect(body.orgCategory).toBe('consultant');
        expect(body.isCustom).toBe(false);
        expect(body.categories).toEqual(getTemplateFor('consultant'));
        expect(body.defaults).toEqual(getTemplateFor('consultant'));
    });

    it('returns the stored tree (isCustom:true) when the org has customised categories', async () => {
        const stored = { expense: [{ slug: 'x', label: 'X' }], income: [] };
        sinon.stub(organisationModel, 'getOrgById').resolves({ org_category: 'consultant', categories: stored });
        const res = makeRes();

        await organisationController.getCategories(reqFor('org-A'), res);

        const body = res.json.firstCall.args[0];
        expect(body.isCustom).toBe(true);
        expect(body.categories).toEqual(stored);
        expect(body.defaults).toEqual(getTemplateFor('consultant')); // pristine template still offered
    });

    it('returns 403 when the requested org is not the caller\'s org', async () => {
        const getOrg = sinon.stub(organisationModel, 'getOrgById').resolves({});
        const res = makeRes();

        await organisationController.getCategories(reqFor('org-A', 'org-B'), res);

        expect(res.status.calledWith(403)).toBe(true);
        expect(getOrg.notCalled).toBe(true); // blocked before the data layer
    });
});
