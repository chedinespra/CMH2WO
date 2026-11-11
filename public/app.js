const form = document.getElementById("orderForm");
const devices = document.getElementById("devices");
const days = document.getElementById("days");
const priceDisplay = document.getElementById("price");
const qrContainer = document.getElementById("qrContainer");
const result = document.getElementById("result");

let prices = {};
let csrfToken = "";

async function getCsrf() {
  const response = await fetch("/api/csrf");
  if (!response.ok) throw new Error("Cannot get security token.");

  const data = await response.json();
  csrfToken = data.csrfToken  data.token  "";

  return csrfToken;
}

function peso(amount) {
  return "₱" + Number(amount || 0).toLocaleString("en-PH");
}

function updatePrice() {
  const amount = prices[devices.value]?.[days.value];

  priceDisplay.textContent =
    amount == null ? "Unavailable" : peso(amount);
}

async function loadStore() {
  try {
    const response = await fetch("/api/public");

    if (!response.ok) {
      throw new Error("Cannot load store settings.");
    }

    const data = await response.json();

    prices = data.prices || {};
    updatePrice();

    if (data.qrUrl) {
      const img = document.createElement("img");
      img.src = data.qrUrl;
      img.alt = "GCash payment QR";
      qrContainer.replaceChildren(img);
    } else {
      qrContainer.textContent =
        "GCash QR is not yet uploaded by the admin.";
    }

    if (data.groupUrl) {
      document.getElementById("groupLink").href = data.groupUrl;
    }

    if (data.siteName) {
      document.title = data.siteName;
    }
  } catch (error) {
    qrContainer.textContent = error.message;
  }
}

devices.addEventListener("change", updatePrice);
days.addEventListener("change", updatePrice);

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const amount = prices[devices.value]?.[days.value];

  if (amount == null) {
    result.textContent = "This package is unavailable.";
    return;
  }

  const button = document.getElementById("submitBtn");
  button.disabled = true;
  button.textContent = "SUBMITTING...";
  result.textContent = "";

  try {
    if (!csrfToken) await getCsrf();

    const formData = new FormData(form);

    let response = await fetch("/api/orders", {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
      body: formData
    });

    if (response.status === 403) {
      await getCsrf();

      response = await fetch("/api/orders", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
        body: formData
      });
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Order submission failed.");
    }

    const orderId = data.orderId || data.id;
    const transactionId = data.transactionId || "";

    result.innerHTML = 
      <div class="price-box">
        <div>
          <strong>ORDER SUBMITTED</strong>
          <p>Save your Order ID:</p>
          <p>${escapeHTML(orderId || "Not provided")}</p>
          <p>Transaction: ${escapeHTML(transactionId)}</p>
          <p>Status: PENDING</p>
        </div>
      </div>
    ;

    if (orderId) {
      document.getElementById("trackId").value = orderId;
    }

    form.reset();
    updatePrice();

  } catch (error) {
    result.textContent = error.message;

  } finally {
    button.disabled = false;
    button.textContent = "SUBMIT ORDER";
  }
});

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

document.getElementById("trackBtn").addEventListener("click", async () => {
  const id = document.getElementById("trackId").value.trim();
  const output = document.getElementById("trackResult");

  if (!id) {
    output.textContent = "Enter your Order ID.";
    return;
  }

  output.textContent = "Checking order...";

  try {
    const response = await fetch(
      "/api/orders/" + encodeURIComponent(id) + "/status"
    );

    const data = await response.json();
if (!response.ok) {
      throw new Error(data.error || "Order not found.");
    }

    output.textContent =
      "Order Status: " + (data.status || "UNKNOWN");

  } catch (error) {
    output.textContent = error.message;
  }
});

getCsrf().catch(error => console.error(error));
loadStore();
