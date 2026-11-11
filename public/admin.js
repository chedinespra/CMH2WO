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
  return "₱" + Number(n || 0).toLocaleString("en-PH", {
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

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short"
  });
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

  $("total").textContent = stats.total ?? 0;
  $("pending").textContent = stats.pending ?? 0;
  $("approved").textContent = stats.approved ?? 0;
  $("rejected").textContent = stats.rejected ?? 0;
  $("revenue").textContent = money(stats.revenue);

  $("siteName").value = pub.siteName || "";
  $("contactUrl").value = pub.contactUrl || "";

  /* ===== ORDER TABLE ===== */

  $("ordersBody").innerHTML = Array.isArray(orders) && orders.length
    ? orders.map(o => {
        const deviceCount = Number(o.deviceCount || 1);
        const days = Number(o.days || 0);
        const statusClass = String(o.status || "PENDING").toLowerCase();

        return 
          <tr>
            <td>
              <strong>${esc(o.transactionId || String(o.id).slice(0, 8))}</strong>
              <br>
              <small>${esc(formatDate(o.createdAt))}</small>
            </td>

            <td>${esc(o.username)}</td>

            <td>
              <strong>${esc(deviceCount)} DEVICE(S)</strong>
              <br>
              <small>${esc(days)} DAY(S)</small>
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
              <span class="status ${esc(statusClass)}">
                ${esc(o.status || "PENDING")}
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
        ;
      }).join("")
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
      const order = orders.find(o => String(o.id) === view.dataset.view);
if (!order || !order.proofUrl) {
        toast("Payment proof not found.");
        return;
      }

      $("proofImage").src = order.proofUrl;
      $("proofModal").classList.remove("hidden");
      return;
    }

    if (status) {
      const newStatus = status.dataset.status;

      if (!confirm(Mark this payment ${newStatus.toLowerCase()}?)) {
        return;
      }

      await api(/api/admin/orders/${encodeURIComponent(status.dataset.id)}/status, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrf
        },
        body: JSON.stringify({
          status: newStatus
        })
      });

      toast("Payment status updated.");
      await load();
      return;
    }

    if (del) {
      if (!confirm("Permanently delete this order and its uploaded proof?")) {
        return;
      }

      await api(/api/admin/orders/${encodeURIComponent(del.dataset.delete)}, {
        method: "DELETE",
        headers: {
          "x-csrf-token": csrf
        }
      });

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
  $("proofImage").removeAttribute("src");
});

$("proofModal").addEventListener("click", e => {
  if (e.target === $("proofModal")) {
    $("proofModal").classList.add("hidden");
    $("proofImage").removeAttribute("src");
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

load().catch(err => {
  console.error("Admin dashboard error:", err);
  toast(err.message);
  if (err.message) {
    setTimeout(() => {
      if (!csrf) location.href = "/";
    }, 1500);
  }
});
