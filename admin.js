
let csrf = "";
const $ = id => document.getElementById(id);

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...options
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  return data;
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3000);
}

function money(amount) {
  return "\u20B1" + Number(amount).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// GET CSRF TOKEN
async function getCsrf() {
  const data = await api("/api/csrf");
  csrf = data.token;
  return csrf;
}

// SHOW LOGIN OR DASHBOARD
function showLogin() {
  $("proofModal").classList.add("hidden");
  $("proofImage").removeAttribute("src");
  $("loginPanel").hidden = false;
  $("adminContent").hidden = true;
  $("logout").hidden = true;
}

function showDashboard() {
  $("loginPanel").hidden = true;
  $("adminContent").hidden = false;
  $("logout").hidden = false;
}

// ADMIN LOGIN
$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("loginButton");
  const error = $("loginError");

  button.disabled = true;
  button.textContent = "PLEASE WAIT...";
  error.textContent = "";

  try {
    await getCsrf();

    const result = await api("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf
      },
      body: JSON.stringify({
        username: $("loginUsername").value.trim(),
        password: $("loginPassword").value
      })
    });

    csrf = result.token;
    $("loginPassword").value = "";

    showDashboard();
    await loadDashboard();

    toast("Admin login successful.");

  } catch (err) {
    error.textContent = err.message;
    showLogin();
  } finally {
    button.disabled = false;
    button.textContent = "LOGIN TO DASHBOARD \u2192";
  }
});

// LOAD DASHBOARD DATA
async function loadDashboard() {
  const [stats, orders, pub] = await Promise.all([
    api("/api/admin/stats"),
    api("/api/admin/orders"),
    api("/api/public")
  ]);

  $("total").textContent = stats.total;
  $("pending").textContent = stats.pending;
  $("approved").textContent = stats.approved;
  $("rejected").textContent = stats.rejected;
  $("revenue").textContent = money(stats.revenue);

  $("siteName").value = pub.siteName;
  $("price1").value = pub.prices[1];
  $("price7").value = pub.prices[7];
  $("price30").value = pub.prices[30];
  $("contactUrl").value = pub.contactUrl || "";
  $("gcashName").value = pub.gcashName || "";
  $("gcashNumber").value = pub.gcashNumber || "";

  $("ordersBody").innerHTML = orders.length
    ? orders.map(order => `
      <tr>
        <td>
          <strong>${esc(order.transactionId || String(order.id).slice(0, 8))}</strong>
          <br>
          <small>${esc(new Date(order.createdAt + "Z").toLocaleString())}</small>
        </td>
        <td>${esc(order.username)}</td>
        <td><strong>${esc(order.menuType || "SHADOW")} MENU</strong><br><small>${esc(order.devices)} device(s) · ${esc(order.days)} day(s)</small></td>
        <td>${money(order.amount)}</td>
        <td>${esc(order.referenceNumber || "\u2014")}</td>
        <td>
          <button class="action" data-view="${esc(order.id)}">VIEW</button>
        </td>
        <td>
          <span class="status ${esc(order.status)}">${esc(order.status)}</span>
        </td>
        <td>
          <div class="actions">
            <button class="action approve"
              data-status="APPROVED"
              data-id="${esc(order.id)}"
              ${order.status === "APPROVED" ? "disabled" : ""}>
              APPROVE
            </button>

            <button class="action reject"
              data-status="REJECTED"
              data-id="${esc(order.id)}"
              ${order.status === "REJECTED" ? "disabled" : ""}>
              REJECT
            </button>

            <button class="action" data-delete="${esc(order.id)}">
              DELETE
            </button>
          </div>
        </td>
      </tr>
    `).join("")
    : '<tr><td colspan="8" class="empty">No customer orders yet.</td></tr>';
}

// REFRESH
$("refresh").addEventListener("click", async () => {
  try {
    await loadDashboard();
    toast("Dashboard refreshed.");
  } catch (err) {
    toast(err.message);
  }
});


// ORDER ACTIONS
$("ordersBody").addEventListener("click", async event => {
  const view = event.target.closest("[data-view]");
  const status = event.target.closest("[data-status]");
  const del = event.target.closest("[data-delete]");

  try {
    if (view) {
      const orders = await api("/api/admin/orders");
      const order = orders.find(
        item => String(item.id) === view.dataset.view
      );

      if (!order || !order.proofUrl) {
        toast("Payment proof not found.");
        return;
      }

      const proofImage = $("proofImage");
      const proofModal = $("proofModal");

      proofImage.onload = () => {
        toast("Payment proof loaded.");
      };

      proofImage.onerror = () => {
        toast("Unable to load payment proof.");
      };

      proofImage.src = order.proofUrl;
      proofModal.classList.remove("hidden");
      return;
    }

    if (del) {
      if (!confirm("Are you sure you want to permanently delete this order?")) return;

      await api(`/api/admin/orders/${del.dataset.delete}`, {
        method: "DELETE",
        headers: {
          "X-CSRF-Token": csrf
        }
      });

      toast("Order deleted successfully.");
      await loadDashboard();
      return;
    }

    if (status) {
      const newStatus = status.dataset.status;

      if (!confirm(`Mark this payment ${newStatus.toLowerCase()}?`)) return;

      await api(`/api/admin/orders/${status.dataset.id}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf
        },
        body: JSON.stringify({ status: newStatus })
      });

      toast("Payment status updated.");
      await loadDashboard();
    }
  } catch (err) {
    toast(err.message);
  }
});

// CLOSE PAYMENT PROOF
$("closeModal").addEventListener("click", () => {
  $("proofModal").classList.add("hidden");
});

$("proofModal").addEventListener("click", event => {
  if (event.target === $("proofModal")) {
    $("proofModal").classList.add("hidden");
  }
});

// SAVE WEBSITE SETTINGS
$("settingsForm").addEventListener("submit", async event => {
  event.preventDefault();

  const formData = new FormData(event.currentTarget);

  try {
    await api("/api/admin/settings", {
      method: "POST",
      headers: {
        "X-CSRF-Token": csrf
      },
      body: formData
    });

    toast("Website settings saved.");
    await loadDashboard();
  } catch (err) {
    toast(err.message);
  }
});

// CHANGE PASSWORD
$("passwordForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    await api("/api/admin/change-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf
      },
      body: JSON.stringify({
        currentPassword: $("currentPassword").value,
        newPassword: $("newPassword").value
      })
    });

    toast("Password changed. Please log in again.");

    setTimeout(async () => {
      try {
        await api("/api/admin/logout", {
          method: "POST",
          headers: { "X-CSRF-Token": csrf }
        });
      } catch (_) {}

      location.reload();
    }, 1200);

  } catch (err) {
    toast(err.message);
  }
});

// LOGOUT
$("logout").addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", {
      method: "POST",
      headers: {
        "X-CSRF-Token": csrf
      }
    });

    csrf = "";
    showLogin();
    await getCsrf();
    toast("Logged out successfully.");

  } catch (err) {
    toast(err.message);
  }
});

// INITIAL CHECK
async function initialize() {
  showLogin();

  try {
    const me = await api("/api/admin/me");
    csrf = me.token;

    showDashboard();
    await loadDashboard();

  } catch (err) {
    if (err.message === "Admin login required.") {
      try {
        await getCsrf();
      } catch (csrfError) {
        $("loginError").textContent = csrfError.message;
      }

      showLogin();
    } else {
      $("loginError").textContent = err.message;
    }
  }
}

initialize();
