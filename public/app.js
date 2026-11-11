const form = document.getElementById("orderForm");
const devices = document.getElementById("devices");
const days = document.getElementById("days");
const priceDisplay = document.getElementById("price");

const homePage = document.getElementById("homePage");
const packagePage = document.getElementById("packagePage");
const paymentPage = document.getElementById("paymentPage");
const confirmationPage = document.getElementById("confirmationPage");

const qrContainer = document.getElementById("qrContainer");
const paymentSummary = document.getElementById("paymentSummary");
const referenceInput = document.getElementById("referenceNumber");
const proofInput = document.getElementById("proof");
const result = document.getElementById("result");

const trackId = document.getElementById("trackId");
const trackResult = document.getElementById("trackResult");
const trackingPanel = document.getElementById("trackBtn").closest(".panel");

let prices = {};
let csrfToken = "";
let currentOrderId = "";

function showPage(page) {
  homePage.hidden = page !== homePage;
  packagePage.hidden = page !== packagePage;
  paymentPage.hidden = page !== paymentPage;
  confirmationPage.hidden = page !== confirmationPage;

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function peso(amount) {
  return "₱" + Number(amount || 0).toLocaleString("en-PH");
}

async function getCsrf() {
  const response = await fetch("/api/csrf");

  if (!response.ok) {
    throw new Error("Cannot get security token.");
  }

  const data = await response.json();
  csrfToken = data.csrfToken  data.token  "";

  return csrfToken;
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

    const groupLink = document.getElementById("groupLink");

    if (groupLink && data.groupUrl) {
      groupLink.href = data.groupUrl;
    }

    if (data.siteName) {
      document.title = data.siteName;
    }

  } catch (error) {
    qrContainer.textContent = error.message;
  }
}

// HOME PAGE → PACKAGE PAGE
document.getElementById("startOrder").addEventListener("click", () => {
  showPage(packagePage);
});

// UPDATE PACKAGE PRICE
devices.addEventListener("change", updatePrice);
days.addEventListener("change", updatePrice);

// PACKAGE PAGE → PAYMENT PAGE
document.getElementById("continuePayment").addEventListener("click", () => {
  if (!form.reportValidity()) {
    return;
  }

  const amount = prices[devices.value]?.[days.value];

  if (amount == null) {
    alert("This package is currently unavailable.");
    return;
  }

  paymentSummary.textContent =
    "Username: " + form.elements.username.value +
    " | Devices: " + devices.value +
    " | Duration: " + days.value + " Days" +
    " | Total: " + peso(amount);

  result.textContent = "";
  showPage(paymentPage);
});

// PAYMENT PAGE → PACKAGE PAGE
document.getElementById("backToPackage").addEventListener("click", () => {
  showPage(packagePage);
});

// SUBMIT PAYMENT AND CREATE ORDER
document.getElementById("submitBtn").addEventListener("click", async () => {
  const referenceNumber = referenceInput.value.trim();
  const proof = proofInput.files[0];

  if (!referenceNumber) {
    result.textContent = "Enter your GCash reference number.";
    return;
  }

  if (!proof) {
    result.textContent = "Please upload your payment screenshot.";
    return;
  }

  if (!proof.type.startsWith("image/")) {
    result.textContent = "Please upload an image file.";
    return;
  }
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
    if (!csrfToken) {
      await getCsrf();
    }

    const formData = new FormData();

    formData.append("username", form.elements.username.value.trim());
    formData.append("devices", devices.value);
    formData.append("days", days.value);
    formData.append("referenceNumber", referenceNumber);
    formData.append("proof", proof);

    let response = await fetch("/api/orders", {
      method: "POST",
      headers: {
        "x-csrf-token": csrfToken
      },
      body: formData
    });

    if (response.status === 403) {
      await getCsrf();

      response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "x-csrf-token": csrfToken
        },
        body: formData
      });
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Order submission failed.");
    }

    currentOrderId = data.orderId  data.id  "";

    if (!currentOrderId) {
      throw new Error(
        "Order submitted, but no Order ID was returned."
      );
    }

    document.getElementById("confirmationOrderId").textContent =
      currentOrderId;

    trackId.value = currentOrderId;

    form.reset();
    referenceInput.value = "";
    proofInput.value = "";

    updatePrice();
    showPage(confirmationPage);

  } catch (error) {
    result.textContent = error.message;

  } finally {
    button.disabled = false;
    button.textContent = "SUBMIT PAYMENT";
  }
});

// OPEN ORDER TRACKING
document.getElementById("trackOrderBtn").addEventListener("click", () => {
  trackingPanel.hidden = false;
  trackId.value = currentOrderId;

  trackingPanel.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  if (currentOrderId) {
    checkOrder(currentOrderId);
  }
});

// CHECK ORDER STATUS
async function checkOrder(id) {
  if (!id) {
    trackResult.textContent = "Enter your Order ID.";
    return;
  }

  trackResult.textContent = "Checking order...";

  try {
    const response = await fetch(
      "/api/orders/" + encodeURIComponent(id) + "/status"
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Order not found.");
    }

    trackResult.textContent =
      "Order Status: " + (data.status || "UNKNOWN");

  } catch (error) {
    trackResult.textContent = error.message;
  }
}

// TRACK ORDER BUTTON
document.getElementById("trackBtn").addEventListener("click", () => {
  checkOrder(trackId.value.trim());
});

// INITIAL PAGE
trackingPanel.hidden = true;
showPage(homePage);

// LOAD STORE DATA
getCsrf().catch(error => console.error(error));
loadStore();
