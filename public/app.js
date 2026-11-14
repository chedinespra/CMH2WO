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

const selectShadow = document.getElementById("selectShadow");
const selectWartk = document.getElementById("selectWartk");
const startOrder = document.getElementById("startOrder");
const deviceField = document.getElementById("deviceField");

let csrfToken = "";
let currentOrderId = "";
let menuType = "";

const shadowPrices = {
  1: { 1: 200, 7: 400, 15: 500, 30: 600 },
  2: { 1: 400, 7: 600, 15: 800, 30: 1000, 40: 1600 },
  5: { 1: 500, 7: 1000, 15: 1500, 30: 1700, 40: 2800 }
};

const wartkPrices = {
  1: 100,
  7: 250,
  30: 500
};

function showPage(page) {
  homePage.hidden = page !== homePage;
  packagePage.hidden = page !== packagePage;
  paymentPage.hidden = page !== paymentPage;
  confirmationPage.hidden = page !== confirmationPage;

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function peso(amount) {
  return "\u20B1" + Number(amount || 0).toLocaleString("en-PH");
}

function selectMenu(type) {
  menuType = type;

  selectShadow.classList.toggle("selected", type === "SHADOW");
  selectWartk.classList.toggle("selected", type === "WARTK");

  startOrder.disabled = false;
}

selectShadow.addEventListener("click", () => selectMenu("SHADOW"));
selectWartk.addEventListener("click", () => selectMenu("WARTK"));

function updateDays() {
  const availableDays = menuType === "WARTK"
    ? [1, 7, 30]
    : menuType === "SHADOW"
      ? Object.keys(shadowPrices[Number(devices.value)] || {}).map(Number)
      : [];

  const previousValue = Number(days.value);

  days.replaceChildren();

  availableDays.forEach(duration => {
    const option = document.createElement("option");
    option.value = String(duration);
    option.textContent = duration + (duration === 1 ? " Day" : " Days");
    days.appendChild(option);
  });

  if (availableDays.includes(previousValue)) {
    days.value = String(previousValue);
  }

  updatePrice();
}

function updatePrice() {
  let amount = null;

  if (menuType === "WARTK") {
    amount = wartkPrices[Number(days.value)];
  } else if (menuType === "SHADOW") {
    amount = shadowPrices[Number(devices.value)]?.[Number(days.value)];
  }

  priceDisplay.textContent =
    amount == null ? "Unavailable" : peso(amount);
}

function enterSelectedMenu() {
  if (!menuType) {
    alert("Please select SHADOW MENU or WARTK MENU.");
    return;
  }

  const isWartk = menuType === "WARTK";

  document.getElementById("menuTitle").textContent =
    menuType + " MENU PACKAGES";

  document.getElementById("menuDescription").textContent =
    isWartk
      ? "Choose your WARTK duration."
      : "Choose your device quantity and duration.";

  deviceField.hidden = isWartk;
  devices.disabled = isWartk;

  if (isWartk) {
    devices.value = "1";
  }

  updateDays();
  showPage(packagePage);
}

startOrder.addEventListener("click", enterSelectedMenu);

document.getElementById("backToMenu").addEventListener("click", () => {
  showPage(homePage);
});

devices.addEventListener("change", updateDays);
days.addEventListener("change", updatePrice);

async function getCsrf() {
  const response = await fetch("/api/csrf");

  if (!response.ok) {
    throw new Error("Cannot get security token.");
  }

  const data = await response.json();
  csrfToken = data.csrfToken || data.token || "";

  return csrfToken;
}

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

    if (data.qrUrl) {
      const img = document.createElement("img");
      img.src = data.qrUrl;
      img.alt = "GCash payment QR";
      qrContainer.replaceChildren(img);
    } else {
      qrContainer.textContent = "GCash QR is not yet uploaded by the admin.";
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

document.getElementById("continuePayment").addEventListener("click", () => {
  if (!form.reportValidity()) return;

  const amount = menuType === "WARTK"
    ? wartkPrices[Number(days.value)]
    : shadowPrices[Number(devices.value)]?.[Number(days.value)];

  if (amount == null) {
    alert("This package is currently unavailable.");
    return;
  }

  const username = form.elements.username.value.trim();

  paymentSummary.textContent =
    "Menu: " + menuType +
    " | Username: " + username +
    (menuType === "SHADOW" ? " | Devices: " + devices.value : "") +
    " | Duration: " + days.value + " Days" +
    " | Total: " + peso(amount);

  result.textContent = "";
  showPage(paymentPage);
});

document.getElementById("backToPackage").addEventListener("click", () => {
  showPage(packagePage);
});

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

  const amount = menuType === "WARTK"
    ? wartkPrices[Number(days.value)]
    : shadowPrices[Number(devices.value)]?.[Number(days.value)];

  if (!menuType || amount == null) {
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
    formData.append("menuType", menuType);
    formData.append("devices", menuType === "WARTK" ? "1" : devices.value);
    formData.append("days", days.value);
    formData.append("referenceNumber", referenceNumber);
    formData.append("proof", proof);

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

    currentOrderId = data.orderId || data.id || "";

    if (!currentOrderId) {
      throw new Error("Order submitted, but no Order ID was returned.");
    }

    document.getElementById("confirmationOrderId").textContent = currentOrderId;
    trackId.value = currentOrderId;

    form.reset();
    referenceInput.value = "";
    proofInput.value = "";

    updateDays();
    showPage(confirmationPage);

    const downloadBtn = document.getElementById("downloadReceiptBtn");
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = "DOWNLOAD RECEIPT";
    }

    const copyBtn = document.getElementById("copyOrderIdBtn");
    if (copyBtn) {
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(currentOrderId);
          copyBtn.textContent = "COPIED!";
          setTimeout(() => copyBtn.textContent = "COPY ORDER ID", 1500);
        } catch {
          alert("Copy failed. Please copy your Order ID manually.");
        }
      };
    }

    if (downloadBtn) {
      downloadBtn.onclick = () => downloadOrderReceipt(currentOrderId, downloadBtn);
      downloadOrderReceipt(currentOrderId, downloadBtn);
    }

  } catch (error) {
    result.textContent = error.message;

  } finally {
    button.disabled = false;
    button.textContent = "SUBMIT PAYMENT";
  }
});

async function downloadOrderReceipt(id, button) {
  if (!id) return;

  button.disabled = true;
  button.textContent = "PREPARING RECEIPT...";

  try {
    const response = await fetch(
      "/api/orders/" + encodeURIComponent(id) + "/receipt"
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Cannot generate receipt.");
    }

    if (!window.H2WOReceipt) {
      throw new Error("Receipt generator not loaded.");
    }

    const canvas = document.createElement("canvas");
    await window.H2WOReceipt.render(data, canvas);
    window.H2WOReceipt.download(canvas, data);
    button.textContent = "DOWNLOAD RECEIPT";
  } catch (error) {
    alert(error.message);
    button.textContent = "TRY AGAIN";
  } finally {
    button.disabled = false;
  }
}

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
    statusText.textContent = "ORDER STATUS: " + (data.status || "UNKNOWN");
    trackResult.appendChild(statusText);

    const paymentText = document.createElement("p");
    paymentText.textContent = data.paid
      ? "PAYMENT STATUS: VERIFIED"
      : "PAYMENT STATUS: NOT YET VERIFIED";
    trackResult.appendChild(paymentText);

    const receiptButton = document.createElement("button");
    receiptButton.type = "button";
    receiptButton.textContent = "DOWNLOAD RECEIPT";
    trackResult.appendChild(receiptButton);

    receiptButton.addEventListener("click", () => {
      downloadOrderReceipt(id, receiptButton);
    });

  } catch (error) {
    trackResult.textContent = error.message;
  }
}

document.getElementById("homeTrackOrderBtn").addEventListener("click", () => {
  showPage(homePage);
  trackingPanel.hidden = false;
  trackId.value = "";
  trackResult.textContent = "";
  trackingPanel.scrollIntoView({ behavior: "smooth", block: "center" });
});

document.getElementById("trackBtn").addEventListener("click", () => {
  checkOrder(trackId.value.trim());
});

trackingPanel.hidden = true;
showPage(homePage);

getCsrf().catch(error => console.error(error));
loadStore();
