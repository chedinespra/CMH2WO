const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Create a new order with GCash payment reference
router.post('/', (req, res) => {
    const { game, itemName, amount, playerId, serverId, referenceNumber } = req.body;
    
    if (!game || !itemName || !amount || !playerId || !referenceNumber) {
        return res.status(400).json({ error: 'Missing required order fields.' });
    }

    const transactionId = 'H2WO-' + Math.floor(100000 + Math.random() * 900000);

    const query = `INSERT INTO orders (transaction_id, game, item_name, amount, player_id, server_id, reference_number, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL')`;
    
    db.run(query, [transactionId, game, itemName, amount, playerId, serverId || '', referenceNumber], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({
            success: true,
            message: 'Order submitted successfully. Awaiting admin approval for PAID receipt generation.',
            transactionId,
            orderId: this.lastID
        });
    });
});

// Check order status by Transaction ID
router.get('/:txId', (req, res) => {
    const txId = req.params.txId;
    db.get(`SELECT * FROM orders WHERE transaction_id = ?`, [txId], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'Transaction not found.' });
        }
        res.json(row);
    });
});

module.exports = router;
