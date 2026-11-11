const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
const ordersRouter = require('./routes/orders');
const adminRouter = require('./routes/admin');

app.use('/api/orders', ordersRouter);
app.use('/api/admin', adminRouter);

// Fallback to frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`H2WO STORE server running on port ${PORT}`);
});
