exports.run = function(db) {
    db.serialize(() => {
        // Orders Table with GCash workflow and Admin Approval tracking
        db.run(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id TEXT UNIQUE NOT NULL,
            game TEXT NOT NULL,
            item_name TEXT NOT NULL,
            amount REAL NOT NULL,
            player_id TEXT NOT NULL,
            server_id TEXT,
            payment_method TEXT DEFAULT 'GCash',
            reference_number TEXT,
            status TEXT DEFAULT 'PENDING_APPROVAL',
            admin_notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Admin Credentials / Audit log table
        db.run(`CREATE TABLE IF NOT EXISTS admin_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            details TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    });
};
