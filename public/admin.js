let adminToken = '';

function loginAdmin() {
    adminToken = document.getElementById('adminTokenInput').value.trim();
    if (!adminToken) {
        alert('Please enter admin token.');
        return;
    }
    // Test token
    fetch('/api/admin/orders', {
        headers: { 'x-admin-token': adminToken }
    }).then(res => {
        if (res.ok) {
            document.getElementById('auth-section').classList.add('hidden');
            document.getElementById('dashboard-section').classList.remove('hidden');
            loadAdminOrders();
        } else {
            alert('Invalid Admin Token.');
        }
    }).catch(err => {
        alert('Login connection error.');
    });
}

async function loadAdminOrders() {
    try {
        const response = await fetch('/api/admin/orders', {
            headers: { 'x-admin-token': adminToken }
        });
        const orders = await response.json();
        if (response.ok) {
            const tbody = document.getElementById('ordersBody');
            tbody.innerHTML = '';
            orders.forEach(order => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${order.transaction_id}</td>
                    <td>${order.game}</td>
                    <td>${order.item_name}</td>
                    <td>₱${order.amount}</td>
                    <td>${order.player_id}</td>
                    <td>${order.reference_number}</td>
                    <td><strong>${order.status}</strong></td>
                    <td>
                        ${order.status === 'PENDING_APPROVAL' ? `
                            <button onclick="approveOrder(${order.id})" class="btn-secondary" style="background: #16a34a; margin-right: 5px;">Approve</button>
                            <button onclick="rejectOrder(${order.id})" class="btn-secondary" style="background: #dc2626;">Reject</button>
                        ` : 'Processed'}
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } else {
            alert('Failed to load orders.');
        }
    } catch (err) {
        console.error(err);
    }
}

async function approveOrder(id) {
    const notes = prompt('Enter approval notes / receipt confirmation:', 'Payment verified via GCash');
    if (notes === null) return;

    try {
        const res = await fetch(`/api/admin/orders/${id}/approve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-token': adminToken
            },
            body: JSON.stringify({ adminNotes: notes })
        });
        const data = await res.json();
        if (res.ok) {
            alert(data.message);
            loadAdminOrders();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        console.error(err);
    }
}

async function rejectOrder(id) {
    const notes = prompt('Enter rejection reason:', 'Invalid GCash Reference Number');
    if (notes === null) return;

    try {
        const res = await fetch(`/api/admin/orders/${id}/reject`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-token': adminToken
            },
            body: JSON.stringify({ adminNotes: notes })
        });
        const data = await res.json();
        if (res.ok) {
            alert(data.message);
            loadAdminOrders();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        console.error(err);
    }
}
