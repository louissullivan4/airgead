const logger = require('../utils/logger');
const { ORG_CATEGORY_SLUGS, getTemplateFor } = require('../config/categoryTemplates');

// Columns an owner may edit via PATCH /organisations/:id. `categories` is
// handled specially (jsonb).
const ORG_UPDATABLE_FIELDS = ['name', 'description', 'country', 'vat_number', 'type', 'org_category', 'categories', 'status', 'vat_status'];

// Phase 1 signup provisioning. A new account must belong to an organisation or
// its JWT will lack orgId and be rejected by authMiddleware (the Phase 0 gap).
//
// Two modes, both run in a single transaction:
//   - 'self'   : create a new org; the new user becomes its owner.
//   - 'invite' : join the inviter's existing org as a member.
//
// Phase 3: a CLIENT invite is a 'self' signup (the client gets their own,
// isolated org) PLUS `accountantOrgId` set — in which case we also write an
// *active* accountant_org_links row in the same transaction so the inviting
// practice gains read access. The accountant never joins the client org.
// `createdBy` is the inviting accountant's user id (from the signed invite
// token). These are optional fields on the options object, so existing callers
// are unaffected (no positional param change).
//
// `user` carries the already-validated profile fields (password is the bcrypt
// hash). Returns the created users row (RETURNING *), including org_id/org_role/
// platform_role so a token can be issued from it.
const createUserWithOrg = async (pool, { user, mode, inviterId, accountantOrgId, createdBy }) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let orgId;
        let orgRole;

        if (mode === 'invite') {
            const inviter = await client.query('SELECT org_id FROM users WHERE id = $1', [inviterId]);
            if (!inviter.rows[0] || !inviter.rows[0].org_id) {
                throw new Error('Inviter has no organisation to join.');
            }
            orgId = inviter.rows[0].org_id;
            orgRole = 'member';
        } else {
            // Optional org-creation step. When the signup payload carries an
            // `organisation` object we create a described org with the chosen
            // type; otherwise we keep the historical behaviour of a silent,
            // auto-named personal org. Either way the new user owns it and gets
            // a category template seeded into `categories` so the app is usable
            // immediately.
            const provided = user.organisation && typeof user.organisation === 'object'
                ? user.organisation
                : null;

            // Clamp the slug to the known set; unknown/absent => personal.
            let orgCategory = provided && provided.org_category;
            if (!ORG_CATEGORY_SLUGS.includes(orgCategory)) {
                orgCategory = 'personal';
            }
            // Self-serve accountancy firm signup: flags the org so it unlocks the
            // Clients workspace and may invite clients. A firm is always a
            // business. (Phase 3 kept this flag DB-only; Phase 3.1 lets a firm
            // self-provision at signup — the signer becomes the admin/owner.)
            const isPractice = Boolean(provided && provided.is_accountant_practice === true);

            // A non-personal category (or a firm) implies a business; else
            // honour an explicit business type, else personal.
            const orgType = (orgCategory !== 'personal' || isPractice)
                ? 'business'
                : (provided && provided.type === 'business' ? 'business' : 'personal');

            const defaultName = `${user.fname || ''} ${user.sname || ''}`.trim() || user.email;
            const orgName = (provided && provided.name && provided.name.trim()) || defaultName;
            const categories = getTemplateFor(orgCategory);

            const org = await client.query(
                `INSERT INTO organisations
                    (name, type, description, country, vat_number, org_category, categories, is_accountant_practice)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
                 RETURNING id`,
                [
                    orgName,
                    orgType,
                    (provided && provided.description) || null,
                    (provided && provided.country) || 'IE',
                    (provided && provided.vat_number) || null,
                    orgCategory,
                    JSON.stringify(categories),
                    isPractice,
                ]
            );
            orgId = org.rows[0].id;
            orgRole = 'owner';
        }

        const inserted = await client.query(
            `INSERT INTO users (
                fname, mname, sname, email, phone_number, date_of_birth, ppsno,
                address_line1, address_line2, city, county, country, tax_status,
                marital_status, postal_code, occupation, currency, password_hash,
                inviter_id, id_image_url, org_id, org_role, platform_role
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
            ) RETURNING *`,
            [
                user.fname,
                user.mname || '',
                user.sname,
                user.email,
                user.phone_number || '',
                user.date_of_birth || null,
                user.ppsno || '',
                user.address_line1 || '',
                user.address_line2 || '',
                user.city || '',
                user.county || '',
                user.country || '',
                user.tax_status || '',
                user.marital_status || '',
                user.postal_code || '',
                user.occupation || '',
                user.currency,
                user.password,
                mode === 'invite' ? inviterId : null,
                null,
                orgId,
                orgRole,
                'user',
            ]
        );

        const newUser = inserted.rows[0];

        if (mode !== 'invite') {
            await client.query(
                'UPDATE organisations SET owner_account_id = $1 WHERE id = $2',
                [newUser.id, orgId]
            );
        }

        // Client invite: grant the inviting practice active read access over the
        // brand-new client org. Only valid on a 'self' signup (the client owns a
        // separate org); never when joining as a member.
        if (mode !== 'invite' && accountantOrgId) {
            await client.query(
                `INSERT INTO accountant_org_links (accountant_org_id, client_org_id, created_by, status)
                 VALUES ($1, $2, $3, 'active')`,
                [accountantOrgId, orgId, createdBy || null]
            );
            logger.info('Linked client org to accountant practice', { accountantOrgId, clientOrgId: orgId });
        }

        await client.query('COMMIT');
        logger.info('Provisioned account with org', { email: user.email, mode, orgId });
        return newUser;
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error provisioning account with org', { email: user.email, error: error.message });
        throw error;
    } finally {
        client.release();
    }
};

// Fetch a single organisation by id (org-scoping is enforced in the controller).
const getOrgById = async (pool, orgId) => {
    try {
        const result = await pool.query('SELECT * FROM organisations WHERE id = $1', [orgId]);
        return result.rows[0] || null;
    } catch (error) {
        logger.error('Error fetching organisation by id', { orgId, error: error.message });
        throw error;
    }
};

// Partial update over a whitelist of columns. `categories` is serialised and
// cast to jsonb; everything else is passed through. Returns the updated row, or
// null when nothing updatable was supplied / the org does not exist.
const updateOrg = async (pool, orgId, fields) => {
    const keys = Object.keys(fields).filter((k) => ORG_UPDATABLE_FIELDS.includes(k));
    if (keys.length === 0) {
        return null;
    }

    const setClauses = keys.map((key, index) => {
        const param = `$${index + 2}`;
        return key === 'categories' ? `categories = ${param}::jsonb` : `${key} = ${param}`;
    });
    setClauses.push('updated_at = now()');

    const values = [
        orgId,
        ...keys.map((k) => (k === 'categories' ? JSON.stringify(fields[k]) : fields[k])),
    ];

    const query = `UPDATE organisations SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`;

    try {
        const result = await pool.query(query, values);
        if (result.rows.length > 0) {
            logger.info('Organisation updated', { orgId });
            return result.rows[0];
        }
        logger.warn('Organisation not found for update', { orgId });
        return null;
    } catch (error) {
        logger.error('Error updating organisation', { orgId, error: error.message });
        throw error;
    }
};

module.exports = { createUserWithOrg, getOrgById, updateOrg };
