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

let csrfToken = "";
let currentOrderId = "";

// SHADOW MENU PRICE LIST
const prices = {
  1: {
    1: 200,
    7: 400,
    15: 500,
    30: 600
  },
  2: {
    1: 400,
    7: 600,
    15: 800,
    30: 1000,
    40: 1600
  },
  5: {
    1: 500,
    7: 1000,
    15: 1500,
    30: 1700,
    40: 2800
  }
};

function showPage(page) {
  homePage.hidden = page !== homePage;
  packagePage.hidden = page !== packagePage;
  paymentPage.hidden = page !== paymentPage;
  confirmationPage.hidden = page !== confirmationPage;

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function peso(amount) {
  return "₱" + Number(amount || 0).toLocaleString("en-PH");
}

// GET CSRF TOKEN
async function getCsrf() {
  const response = await fetch("/api/csrf");

  if (!response.ok) {
    throw new Error("Cannot get security token.");
  }

  const data = await response.json();

  csrfToken = data.csrfToken || data.token || "";

  return csrfToken;
}

// GET CORRECT PRICE
function updatePrice() {
  const amount = prices[devices.value]?.[days.value];

  priceDisplay.textContent =
    amount == null ? "Unavailable" : peso(amount);
}

// LOAD STORE SETTINGS AND GCASH QR
async function loadStore() {
  try {
    const response = await fetch("/api/public");

    if (!response.ok) {
      throw new Error("Cannot load store settings.");
    }

    const data = await response.json();

    const gcashNameEl = document.getElementById("gcashName");
    const gcashNumberEl = document.getElementById("gcashNumber");
    const copyNameBtn = document.getElementById("copyGcashName");
    const copyNumberBtn = document.getElementById("copyGcashNumber");
    const downloadQr = document.getElementById("downloadQr");

    if (gcashNameEl) gcashNameEl.textContent = data.gcashName || "Not set";
    if (gcashNumberEl) gcashNumberEl.textContent = data.gcashNumber || "Not set";

    async function copyGcash(value, button) {
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        const original = button.textContent;
        button.textContent = "COPIED!";
        setTimeout(() => button.textContent = original, 1500);
      } catch {
        alert("Copy failed. Please copy manually.");
      }
    }

    if (copyNameBtn) {
      copyNameBtn.onclick = () => copyGcash(data.gcashName, copyNameBtn);
    }
    if (copyNumberBtn) {
      copyNumberBtn.onclick = () => copyGcash(data.gcashNumber, copyNumberBtn);
    }
    if (downloadQr && data.qrUrl) {
      downloadQr.href = data.qrUrl;
      downloadQr.hidden = false;
    }

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

    if (groupLink) {
      groupLink.href = data.telegramUrl || "https://t.me/+jomXsgOkv9NkMTBl";
    }

    const contactAdminBtn = document.getElementById("contactAdminBtn");
    if (contactAdminBtn) {
      contactAdminBtn.href = data.contactUrl || "#";
    }
    if (data.siteName) {
      document.title = data.siteName;
    }

  } catch (error) {
    qrContainer.textContent = error.message;
  }
}

// HOME â†’ PACKAGE
document.getElementById("startOrder").addEventListener("click", () => {
  showPage(packagePage);
});

// UPDATE PRICE WHEN DEVICE OR DURATION CHANGES
devices.addEventListener("change", updatePrice);
days.addEventListener("change", updatePrice);

// PACKAGE â†’ PAYMENT
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

// PAYMENT â†’ PACKAGE
document.getElementById("backToPackage").addEventListener("click", () => {
  showPage(packagePage);
});

// SUBMIT PAYMENT
document.getElementById("submitBtn").addEventListener("click", async () => {

  const referenceNumber = referenceInput.value.trim();
  const proof = proofInput.files[0];

  if (!proof) {
    result.textContent = "Please upload your payment screenshot.";
    return;
  }

  if (!proof.type.startsWith("image/")) {
    result.textContent = "Please upload an image file.";
    return;
  }

  if (proof.size > 5 * 1024 * 1024) {
    result.textContent = "Image must be 5 MB or smaller.";
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

    formData.append(
      "username",
      form.elements.username.value.trim()
    );

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

    const gcashNameEl = document.getElementById("gcashName");
    const gcashNumberEl = document.getElementById("gcashNumber");
    const copyNameBtn = document.getElementById("copyGcashName");
    const copyNumberBtn = document.getElementById("copyGcashNumber");
    const downloadQr = document.getElementById("downloadQr");

    if (gcashNameEl) gcashNameEl.textContent = data.gcashName || "Not set";
    if (gcashNumberEl) gcashNumberEl.textContent = data.gcashNumber || "Not set";

    async function copyGcash(value, button) {
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        const original = button.textContent;
        button.textContent = "COPIED!";
        setTimeout(() => button.textContent = original, 1500);
      } catch {
        alert("Copy failed. Please copy manually.");
      }
    }

    if (copyNameBtn) {
      copyNameBtn.onclick = () => copyGcash(data.gcashName, copyNameBtn);
    }
    if (copyNumberBtn) {
      copyNumberBtn.onclick = () => copyGcash(data.gcashNumber, copyNumberBtn);
    }
    if (downloadQr && data.qrUrl) {
      downloadQr.href = data.qrUrl;
      downloadQr.hidden = false;
    }

    if (!response.ok) {
      throw new Error(data.error || "Order submission failed.");
    }

    currentOrderId = data.orderId || data.id || "";

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

    trackResult.replaceChildren();

    const statusText = document.createElement("p");
    statusText.textContent = "Order Status: " + (data.status || "UNKNOWN");
    trackResult.appendChild(statusText);

    if (String(data.status).toUpperCase() === "APPROVED") {
      const receiptButton = document.createElement("button");
      receiptButton.type = "button";
      receiptButton.textContent = "DOWNLOAD RECEIPT";
      trackResult.appendChild(receiptButton);

      receiptButton.addEventListener("click", async () => {
        receiptButton.disabled = true;
        receiptButton.textContent = "PREPARING RECEIPT...";

        try {
          const receiptResponse = await fetch(
            "/api/orders/" + encodeURIComponent(id) + "/receipt"
          );

          const receiptData = await receiptResponse.json();

          if (!receiptResponse.ok) {
            throw new Error(receiptData.error || "Cannot generate receipt.");
          }

          if (!window.H2WOReceipt) {
            throw new Error("Receipt generator not loaded.");
          }

          const canvas = document.createElement("canvas");
          await window.H2WOReceipt.render(receiptData, canvas);
          window.H2WOReceipt.download(canvas, receiptData);

          receiptButton.textContent = "DOWNLOAD RECEIPT";
        } catch (error) {
          alert(error.message);
          receiptButton.textContent = "TRY AGAIN";
        } finally {
          receiptButton.disabled = false;
        }
      });
    }

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

// LOAD DATA
getCsrf().catch(error => console.error(error));
loadStore();
