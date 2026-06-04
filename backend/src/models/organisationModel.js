const logger = require('../utils/logger');

// Phase 1 signup provisioning. A new account must belong to an organisation or
// its JWT will lack orgId and be rejected by authMiddleware (the Phase 0 gap).
//
// Two modes, both run in a single transaction:
//   - 'self'   : create a new personal org; the new user becomes its owner.
//   - 'invite' : join the inviter's existing org as a member.
//
// `user` carries the already-validated profile fields (password is the bcrypt
// hash). Returns the created users row (RETURNING *), including org_id/org_role/
// platform_role so a token can be issued from it.
const createUserWithOrg = async (pool, { user, mode, inviterId }) => {
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
            const orgName = `${user.fname || ''} ${user.sname || ''}`.trim() || user.email;
            const org = await client.query(
                `INSERT INTO organisations (name, type) VALUES ($1, 'personal') RETURNING id`,
                [orgName]
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

module.exports = { createUserWithOrg };
