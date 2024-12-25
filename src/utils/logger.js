const { createLogger, format, transports } = require('winston');
const path = require('path');
const kleur = require('kleur');

const logDirectory = path.join(__dirname, '..', 'logs');

const logger = createLogger({
    level: 'silly',
    format: format.combine(
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
    defaultMeta: { service: 'equiledger-service' },
    transports: [
        new transports.Console(),
        new transports.File({ filename: path.join(logDirectory, 'error.log'), level: 'error' }),
        new transports.File({ filename: path.join(logDirectory, 'combined.log') }),
    ],
});

module.exports = logger;
