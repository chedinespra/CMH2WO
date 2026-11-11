let csrf = "";

const $ = id => document.getElementById(id);

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) location.href = "/";
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3000);
}

function money(n) {
  return "₱" + Number(n).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

/* ===== LOAD ADMIN DASHBOARD ===== */

async function load() {
  const me = await api("/api/admin/me");
  csrf = me.token;

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
  $("contactUrl").value = pub.contactUrl || "";

  /* ===== ORDER TABLE ===== */

  $("ordersBody").innerHTML = orders.length
    ? orders.map(o => 
      <tr>
        <td>
          <strong>${esc(o.transactionId || o.id.slice(0, 8))}</strong>
          <br>
          <small>${esc(new Date(o.createdAt + "Z").toLocaleString())}</small>
        </td>

        <td>${esc(o.username)}</td>

        <td>
          <strong>${esc(o.deviceCount || 1)} DEVICE(S)</strong>
          <br>
          <small>${esc(o.days)} DAY(S)</small>
        </td>

        <td>
          <strong>${money(o.amount)}</strong>
        </td>

        <td>${esc(o.referenceNumber || "—")}</td>

        <td>
          <button class="action" data-view="${esc(o.id)}">
            VIEW
          </button>
        </td>

        <td>
          <span class="status ${esc(o.status)}">
            ${esc(o.status)}
          </span>
        </td>

        <td>
          <div class="actions">
            <button
              class="action approve"
              data-status="APPROVED"
              data-id="${esc(o.id)}"
              ${o.status === "APPROVED" ? "disabled" : ""}
            >APPROVE</button>

            <button
              class="action reject"
              data-status="REJECTED"
              data-id="${esc(o.id)}"
              ${o.status === "REJECTED" ? "disabled" : ""}
            >REJECT</button>

            <button
              class="action"
              data-delete="${esc(o.id)}"
            >DELETE</button>
          </div>
        </td>
      </tr>
    ).join("")
    : '<tr><td colspan="8" class="empty">No customer orders yet.</td></tr>';
}

/* ===== ORDER ACTIONS ===== */

$("ordersBody").addEventListener("click", async e => {
  const view = e.target.closest("[data-view]");
  const status = e.target.closest("[data-status]");
  const del = e.target.closest("[data-delete]");

  try {
    if (view) {
      const orders = await api("/api/admin/orders");
      const order = orders.find(o => o.id === view.dataset.view);

      if (!order) return;

      $("proofImage").src = order.proofUrl;
      $("proofModal").classList.remove("hidden");
    }

    if (status) {
      if (!confirm(
        Mark this payment ${status.dataset.status.toLowerCase()}?
      )) return;

      await api(
        /api/admin/orders/${status.dataset.id}/status,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrf
          },
          body: JSON.stringify({
            status: status.dataset.status
          })
        }
      );

      toast("Payment status updated.");
      await load();
    }
if (del) {
      if (!confirm(
        "Permanently delete this order and its uploaded proof?"
      )) return;

      await api(
        /api/admin/orders/${del.dataset.delete},
        {
          method: "DELETE",
          headers: {
            "x-csrf-token": csrf
          }
        }
      );

      toast("Order deleted.");
      await load();
    }

  } catch (err) {
    toast(err.message);
  }
});

/* ===== REFRESH ===== */

$("refresh").addEventListener("click", () => {
  load().catch(err => toast(err.message));
});

/* ===== PAYMENT PROOF MODAL ===== */

$("closeModal").addEventListener("click", () => {
  $("proofModal").classList.add("hidden");
});

$("proofModal").addEventListener("click", e => {
  if (e.target === $("proofModal")) {
    $("proofModal").classList.add("hidden");
  }
});

/* ===== WEBSITE SETTINGS ===== */

$("settingsForm").addEventListener("submit", async e => {
  e.preventDefault();

  const fd = new FormData(e.currentTarget);

  try {
    await api("/api/admin/settings", {
      method: "PUT",
      headers: {
        "x-csrf-token": csrf
      },
      body: fd
    });

    toast("Website settings saved.");
    await load();

  } catch (err) {
    toast(err.message);
  }
});

/* ===== CHANGE ADMIN PASSWORD ===== */

$("passwordForm").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    await api("/api/admin/change-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrf
      },
      body: JSON.stringify({
        currentPassword: $("currentPassword").value,
        newPassword: $("newPassword").value
      })
    });

    toast("Password changed. Log in again.");

    setTimeout(() => {
      location.href = "/";
    }, 1200);

  } catch (err) {
    toast(err.message);
  }
});

/* ===== LOG OUT ===== */

$("logout").addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", {
      method: "POST",
      headers: {
        "x-csrf-token": csrf
      }
    });

    location.href = "/";

  } catch (err) {
    toast(err.message);
  }
});

/* ===== INITIALIZE ===== */

load().catch(() => {
  location.href = "/";
});
