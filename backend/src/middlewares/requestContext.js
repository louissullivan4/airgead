const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

// Request-id plumbing (Phase 6 ops). Accepts an inbound x-request-id (from a
// load balancer / the frontend proxy) or generates one, echoes it on the
// response, and holds it in AsyncLocalStorage so the winston format can stamp
// every log line written anywhere in that request's async chain - no
// per-callsite threading.

const store = new AsyncLocalStorage();

const currentRequestId = () => {
    const ctx = store.getStore();
    return ctx ? ctx.requestId : undefined;
};

const requestContext = (req, res, next) => {
    const inbound = (req.headers['x-request-id'] || '').toString().slice(0, 64);
    const requestId = inbound || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    store.run({ requestId }, next);
};

module.exports = { requestContext, currentRequestId };
