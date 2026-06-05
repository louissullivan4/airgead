const express = require('express');
const userRoutes = require('./routes/userRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const receiptRoutes = require('./routes/receiptRoutes');
const organisationRoutes = require('./routes/organisationRoutes');
const fileRoutes = require('./routes/fileRoutes');
const path = require('path');
const logger = require('./utils/logger');
const pool = require('./utils/db');
const { BRAND } = require('./config/brand');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

app.use(cors());

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use((req, res, next) => {
    req.pool = pool;
    next();
});

app.get('/', (req, res) => {
    res.send(`Hello, welcome to ${BRAND}!`);
    logger.info('Root endpoint was accessed');
});

app.use('/users', userRoutes);
app.use('/expenses', expenseRoutes);
app.use('/receipts', receiptRoutes);
app.use('/organisations', organisationRoutes);
app.use('/files', fileRoutes);

app.use((err, req, res, next) => {
    logger.error('Unhandled error: ', err);
    res.status(500).json({ error: 'Internal server error.' });
});

module.exports = app;
