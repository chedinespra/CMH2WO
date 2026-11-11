const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'store.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the H2WO STORE SQLite database.');
        // Run migrations
        require('./migrations/001_initial_schema').run(db);
    }
});

module.exports = db;
