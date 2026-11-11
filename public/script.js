function selectGame(game, itemName, amount) {
    document.getElementById('selectedGame').value = game;
    document.getElementById('selectedItem').value = itemName;
    document.getElementById('selectedAmount').value = amount;
    document.getElementById('displayItem').innerText = `${game} - ${itemName} (₱${amount}.00)`;
    
    document.getElementById('checkout-section').classList.remove('hidden');
    document.getElementById('checkout-section').scrollIntoView({ behavior: 'smooth' });
}

document.getElementById('orderForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const game = document.getElementById('selectedGame').value;
    const itemName = document.getElementById('selectedItem').value;
    const amount = document.getElementById('selectedAmount').value;
    const playerId = document.getElementById('playerId').value;
    const serverId = document.getElementById('serverId').value;
    const referenceNumber = document.getElementById('referenceNumber').value;

    try {
        const response = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ game, itemName, amount, playerId, serverId, referenceNumber })
        });
        const data = await response.json();
        if (response.ok) {
            alert(`Order submitted successfully! Your Transaction ID is: ${data.transactionId}\nStatus: Awaiting Admin Approval for PAID Receipt.`);
            document.getElementById('orderForm').reset();
            document.getElementById('checkout-section').classList.add('hidden');
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        console.error(err);
        alert('Network error submitting order.');
    }
});

async function trackOrder() {
    const txId = document.getElementById('trackTxId').value.trim();
    if (!txId) {
        alert('Please enter a Transaction ID.');
        return;
    }
    const resultDiv = document.getElementById('trackResult');
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = '<p>Searching transaction...</p>';

    try {
        const response = await fetch(`/api/orders/${txId}`);
        const data = await response.json();
        if (response.ok) {
            let statusBadge = data.status === 'PAID_APPROVED' ? '<span style="color: #4ade80; font-weight: bold;">PAID & APPROVED ✓</span>' : '<span style="color: #facc15; font-weight: bold;">PENDING ADMIN APPROVAL</span>';
            resultDiv.innerHTML = `
                <h3>Transaction Details</h3>
                <p><strong>Transaction ID:</strong> ${data.transaction_id}</p>
                <p><strong>Game:</strong> ${data.game} - ${data.item_name}</p>
                <p><strong>Amount:</strong> ₱${data.amount}</p>
                <p><strong>Player ID:</strong> ${data.player_id}</p>
                <p><strong>GCash Ref No:</strong> ${data.reference_number}</p>
                <p><strong>Status:</strong> ${statusBadge}</p>
                <p><strong>Admin Notes:</strong> ${data.admin_notes || 'None'}</p>
            `;
        } else {
            resultDiv.innerHTML = `<p style="color: #f87171;">${data.error}</p>`;
        }
    } catch (err) {
        resultDiv.innerHTML = `<p style="color: #f87171;">Error fetching transaction status.</p>`;
    }
}
