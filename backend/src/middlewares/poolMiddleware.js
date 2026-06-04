const pool = require('../utils/db');

const injectPool = (req, res, next) => {
    req.pool = pool;
    next();
};

module.exports = injectPool;