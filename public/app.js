let csrf = "";
let currentOrder = null;
let publicData = null;

const $ = id => document.getElementById(id);

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

async function refreshCsrf() {
  const d = await api("/api/csrf");
  csrf = d.token;
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

/* ===== DEVICE AND DURATION PRICING ===== */

function updateDurations() {
  if (!publicData) return;

  const deviceCount = $("deviceCount").value;
  const prices = publicData.prices[deviceCount];
  const daysSelect = $("days");

  daysSelect.innerHTML = "";

  if (!prices || Object.keys(prices).length === 0) {
    $("price").textContent = "—";
    return;
  }

  for (const [days, price] of Object.entries(prices)) {
    const option = document.createElement("option");

    option.value = days;
    option.textContent =
      ${days} Day${days === "1" ? "" : "s"} — ${money(price)};

    daysSelect.appendChild(option);
  }

  updatePrice();
}

function updatePrice() {
  if (!publicData) return;

  const deviceCount = $("deviceCount").value;
  const days = $("days").value;

  const price = publicData.prices[deviceCount]?.[days];

  $("price").textContent =
    price !== undefined ? money(price) : "—";
}

/* ===== LOAD PUBLIC SETTINGS ===== */

async function loadPublic() {
  publicData = await api("/api/public");

  $("brandName").textContent = publicData.siteName;
  $("footerName").textContent = publicData.siteName;

  document.title = publicData.siteName + " — Payment Portal";

  updateDurations();
  setContact(publicData.contactUrl);

  if (publicData.qrUrl) {
    $("qrFrame").innerHTML =
      <img src="${publicData.qrUrl}" alt="GCash QR code">;

    $("downloadQr").href = publicData.qrUrl;
    $("downloadQr").classList.remove("hidden");
  } else {
    $("qrFrame").innerHTML =
      '<div class="qr-empty">GCash QR code has not been uploaded yet.<br>Contact the administrator.</div>';

    $("downloadQr").classList.add("hidden");
  }
}

$("deviceCount").addEventListener("change", updateDurations);
$("days").addEventListener("change", updatePrice);

$("year").textContent = new Date().getFullYear();

/* ===== CREATE ORDER ===== */

$("orderForm").addEventListener("submit", async e => {
  e.preventDefault();

  const username = $("username").value.trim();
  const deviceCount = $("deviceCount").value;
  const days = $("days").value;

  if (!username) {
    return toast("Enter your in-game username.");
  }

  const price = publicData?.prices[deviceCount]?.[days];

  if (price === undefined) {
    return toast("Invalid device package or duration.");
  }

  currentOrder = {
    username,
    deviceCount,
    days
  };

  $("summary").innerHTML = 
    <span>Username</span><strong></strong>
    <span>Devices</span><strong></strong>
    <span>Duration</span><strong></strong>
    <span>Total payment</span><strong class="total"></strong>
  ;

  const vals = $("summary").querySelectorAll("strong");

  vals[0].textContent = username;
  vals[1].textContent = deviceCount + " device(s)";
  vals[2].textContent = days + " day(s)";
  vals[3].textContent = money(price);

  $("orderPanel").classList.add("hidden");
  $("paymentPanel").classList.remove("hidden");

  window.scrollTo({
    top: $("paymentPanel").offsetTop - 20,
    behavior: "smooth"
  });
});

/* ===== SUBMIT PAYMENT PROOF ===== */

$("proofForm").addEventListener("submit", async e => {
  e.preventDefault();

  if (!currentOrder) {
    return toast("Please create an order first.");
  }

  const file = $("proof").files[0];

  if (!file) {
    return toast("Upload your payment screenshot.");
  }
if (!["image/jpeg", "image/png"].includes(file.type)) {
    return toast("Only JPG and PNG are accepted.");
  }

  if (file.size > 5 * 1024 * 1024) {
    return toast("Image must be 5 MB or smaller.");
  }

  const fd = new FormData();

  fd.append("username", currentOrder.username);
  fd.append("deviceCount", currentOrder.deviceCount);
  fd.append("days", currentOrder.days);
  fd.append("referenceNumber", $("reference").value.trim());
  fd.append("proof", file);

  const button = $("proofForm").querySelector("button");

  button.disabled = true;
  button.textContent = "SUBMITTING…";

  try {
    await refreshCsrf();

    const d = await api("/api/orders", {
      method: "POST",
      headers: {
        "x-csrf-token": csrf
      },
      body: fd
    });

    $("successMessage").textContent =
      d.message + " Order ID: " + d.orderId;

    $("successMessage").classList.remove("hidden");
    $("proofForm").classList.add("hidden");

    rememberOrder(d.orderId);
    showStatus(d.orderId);

  } catch (err) {
    toast(err.message);
    button.disabled = false;
    button.innerHTML = 'SUBMIT PAYMENT PROOF <span>→</span>';
  }
});

/* ===== ADMIN LOGIN ===== */

$("showAdmin").addEventListener("click", () => {
  $("adminLoginPanel").classList.remove("hidden");
  $("adminLoginPanel").scrollIntoView({ behavior: "smooth" });
});

$("closeAdmin").addEventListener("click", () => {
  $("adminLoginPanel").classList.add("hidden");
});

$("adminLoginForm").addEventListener("submit", async e => {
  e.preventDefault();

  try {
    await refreshCsrf();

    const d = await api("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrf
      },
      body: JSON.stringify({
        username: $("adminUser").value,
        password: $("adminPass").value
      })
    });

    csrf = d.token;
    location.href = "/admin.html";

  } catch (err) {
    toast(err.message);
  }
});

/* ===== PAYMENT STATUS + RECEIPT ===== */

let pollTimer = null;
let activeOrderId = null;

const ORDER_KEY = "h2wo_last_order";

function rememberOrder(id) {
  try {
    localStorage.setItem(
      ORDER_KEY,
      JSON.stringify({ id, t: Date.now() })
    );
  } catch (_) {}
}

function forgetOrder() {
  try {
    localStorage.removeItem(ORDER_KEY);
  } catch (_) {}
}

function setContact(url) {
  document.querySelectorAll(".contact-admin").forEach(a => {
    if (url) {
      a.href = url;
      a.classList.remove("hidden");
    } else {
      a.classList.add("hidden");
    }
  });
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function showBox(id) {
  ["statusPending", "statusSuccess", "statusRejected"].forEach(b => {
    $(b).classList.toggle("hidden", b !== id);
  });
}

async function fetchReceipt() {
  return api(
    /api/orders/${encodeURIComponent(activeOrderId)}/receipt
  );
}

async function refreshStatus() {
  if (!activeOrderId) return;

  let s;

  try {
    s = await api(
      /api/orders/${encodeURIComponent(activeOrderId)}/status
    );
  } catch (err) {
    if (/order not found/i.test(err.message)) {
      stopPolling();
      forgetOrder();
      resetToOrder();
    } else {
      console.warn("Status check failed:", err.message);
    }

    return;
  }

  if (s.paid) {
    stopPolling();
    showBox("statusSuccess");

    try {
      const r = await fetchReceipt();
      await H2WOReceipt.render(r, $("receiptCanvas"));
    } catch (err) {
      toast(err.message);
    }

  } else if (s.status === "REJECTED") {
    stopPolling();
    $("rejectedTx").textContent = s.transactionId || "";
    showBox("statusRejected");

  } else {
    $("pendingTx").textContent = s.transactionId || "";
    showBox("statusPending");
  }
}

function showStatus(orderId) {
  activeOrderId = orderId;
  stopPolling();

  $("orderPanel").classList.add("hidden");
  $("paymentPanel").classList.add("hidden");
  $("statusPanel").classList.remove("hidden");

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
showBox("statusPending");

  refreshStatus();
  pollTimer = setInterval(refreshStatus, 8000);
}

function resetToOrder() {
  stopPolling();
  activeOrderId = null;
  currentOrder = null;

  $("statusPanel").classList.add("hidden");
  $("paymentPanel").classList.add("hidden");
  $("orderPanel").classList.remove("hidden");

  $("proofForm").reset();
  $("proofForm").classList.remove("hidden");
  $("successMessage").classList.add("hidden");

  const b = $("proofForm").querySelector("button");

  b.disabled = false;
  b.innerHTML = 'SUBMIT PAYMENT PROOF <span>→</span>';

  $("orderForm").reset();
  $("deviceCount").value = "1";
  updateDurations();
}

/* ===== DOWNLOAD RECEIPT ===== */

$("downloadReceipt").addEventListener("click", async () => {
  const btn = $("downloadReceipt");
  btn.disabled = true;

  try {
    const r = await fetchReceipt();
    const canvas = await H2WOReceipt.render(
      r,
      $("receiptCanvas")
    );

    H2WOReceipt.download(canvas, r);

  } catch (err) {
    toast(err.message);

  } finally {
    btn.disabled = false;
  }
});

/* ===== NEW ORDER ===== */

$("newOrder").addEventListener("click", () => {
  forgetOrder();
  resetToOrder();
});

/* ===== INITIALIZE ===== */

loadPublic().catch(err => toast(err.message));

try {
  const saved = JSON.parse(
    localStorage.getItem(ORDER_KEY) || "null"
  );

  if (
    saved &&
    saved.id &&
    Date.now() - saved.t < 7 * 24 * 3600 * 1000
  ) {
    showStatus(saved.id);
  }
} catch (_) {}
