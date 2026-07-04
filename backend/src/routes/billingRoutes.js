const express = require('express');
const billingController = require('../controllers/billingController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { scopeToOrg, requireOrgRole } = require('../middlewares/tenantScope');
const injectPool = require('../middlewares/poolMiddleware');

const router = express.Router();

// NOTE: POST /billing/webhook is NOT here - it is mounted directly in
// src/index.js before the JSON body parser (Stripe signature verification
// needs the raw body) and carries no auth (the signature is the auth).

router.use(injectPool);

// PUBLIC: the marketing pricing + landing pages render from this (enforcement
// flag, trial length, live Stripe prices). No auth - it exposes nothing org-
// specific. Must sit ABOVE the auth middleware below.
router.get('/plans', billingController.getPlans);

// Billing routes are authenticated and scoped - and deliberately NEVER behind
// the subscription gate: an expired org must always be able to see its status
// and pay.
router.use(authenticateToken, scopeToOrg);

router.get('/status', billingController.getStatus);
// Money moves are owner-only.
router.post('/checkout-session', requireOrgRole('owner'), billingController.createCheckoutSession);
router.post('/portal-session', requireOrgRole('owner'), billingController.createPortalSession);

module.exports = router;
