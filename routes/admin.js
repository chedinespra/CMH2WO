const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Simple admin middleware placeholder (secured via environment token in production)
const checkAdminAuth = (req, res, next) => {
    const adminToken = req.headers['x-admin-token'];
    if (!adminToken || adminToken !== (process.env.ADMIN_TOKEN || 'h2wo_secure_admin_2026')) {
        return res.status(401).json({ error: 'Unauthorized admin access.' });
    }
    next();
};

// Get all orders for admin review
router.get('/orders', checkAdminAuth, (req, res) => {
    db.all(`SELECT * FROM orders ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Approve order (Generates PAID status & receipt eligibility)
router.post('/orders/:id/approve', checkAdminAuth, (req, res) => {
    const orderId = req.params.id;
    const { adminNotes } = req.body;

    db.run(`UPDATE orders SET status = 'PAID_APPROVED', admin_notes = ? WHERE id = ?`, [adminNotes || 'Approved by Admin', orderId], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: 'Order approved and marked as PAID.' });
    });
});

// Reject order
router.post('/orders/:id/reject', checkAdminAuth, (req, res) => {
    const orderId = req.params.id;
    const { adminNotes } = req.body;

    db.run(`UPDATE orders SET status = 'REJECTED', admin_notes = ? WHERE id = ?`, [adminNotes || 'Rejected by Admin', orderId], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: 'Order rejected.' });
    });
});

module.exports = router;
