const { createLogger, format, transports } = require('winston');
const path = require('path');
const kleur = require('kleur');
const { BRAND } = require('../config/brand');
const { currentRequestId } = require('../middlewares/requestContext');

const logDirectory = path.join(__dirname, '..', 'logs');

// Stamp every line written inside a request's async chain with its request id
// (set by middlewares/requestContext). Lines outside a request are untouched.
const withRequestId = format((info) => {
    const requestId = currentRequestId();
    if (requestId) info.requestId = requestId;
    return info;
});

const logger = createLogger({
    level: 'silly',
    // Keep jest output readable: suppress all log lines under the test runner.
    silent: process.env.NODE_ENV === 'test',
    format: format.combine(
        withRequestId(),
        // util.format-style interpolation: without this, every '%s'/'%o'
        // placeholder prints literally instead of the value passed for it.
        format.splat(),
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.printf(({ timestamp, level, message, ...meta }) => {
            let log = `[${timestamp}] [${level}]: ${message}`;
            if (Object.keys(meta).length) {
                log += ` ${JSON.stringify(meta)}`;
            }

            switch (level) {
                case 'error':
                    return kleur.red(log);
                case 'warn':
                    return kleur.yellow(log);
                case 'info':
                    return kleur.green(log);
                case 'verbose':
                    return kleur.cyan(log);
                case 'debug':
                    return kleur.blue(log);
                case 'silly':
                    return kleur.magenta(log);
                default:
                    return log;
            }
        })
    ),
    defaultMeta: { service: `${BRAND}-service` },
    transports: [
        new transports.Console(),
        new transports.File({ filename: path.join(logDirectory, 'error.log'), level: 'error' }),
        new transports.File({ filename: path.join(logDirectory, 'combined.log') }),
    ],
});

module.exports = logger;
