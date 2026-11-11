/* H2WO STORE — Receipt Image Generator */
(function () {
  const W = 1080;
  const S = 2;

  const FONT = '"Segoe UI","Helvetica Neue",Roboto,Arial,sans-serif';
  const MONO = '"SF Mono",Consolas,Menlo,"Courier New",monospace';

  const C = {
    bg: "#eceef1",
    paper: "#ffffff",
    ink: "#14171c",
    muted: "#6b7280",
    line: "#e5e7eb",
    red: "#e0253a",
    green: "#15803d",
    greenBg: "#e6f7ed"
  };

  let logoPromise = null;

  function loadLogo() {
    if (!logoPromise) {
      logoPromise = new Promise(resolve => {
        const img = new Image();

        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = "/logo.jpg";
      });
    }

    return logoPromise;
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function spaced(ctx, value) {
    if ("letterSpacing" in ctx) {
      ctx.letterSpacing = value;
    }
  }

  function wrap(ctx, text, maxW) {
    const out = [];
    let line = "";

    for (const word of String(text ?? "—").split(/\s+/)) {
      let w = word;

      while (ctx.measureText(w).width > maxW) {
        let i = w.length;

        while (
          i > 1 &&
          ctx.measureText(w.slice(0, i)).width > maxW
        ) {
          i--;
        }

        if (line) {
          out.push(line);
          line = "";
        }

        out.push(w.slice(0, i));
        w = w.slice(i);
      }

      const test = line ? line + " " + w : w;

      if (ctx.measureText(test).width <= maxW) {
        line = test;
      } else {
        if (line) out.push(line);
        line = w;
      }
    }

    if (line) out.push(line);

    return out.length ? out : [""];
  }

  function fmtDate(iso) {
    if (!iso) return "—";

    const d = new Date(iso);

    if (isNaN(d.getTime())) return "—";

    return new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }).format(d) + " (PHT)";
  }

  function money(n) {
    return "₱" + Number(n).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function paint(ctx, d, logo) {
    ctx.setTransform(S, 0, 0, S, 0, 0);

    const H = ctx.canvas.height / S;

    const cx = 40;
    const cw = W - 80;
    const cy = 40;
    const ch = H - 80;
    const pad = 56;
    const mid = cx + cw / 2;

    const status = String(d.status || "UNVERIFIED").toUpperCase();

    const deviceCount = Number(d.deviceCount || 1);
    const days = Number(d.days || 0);

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.14)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = C.paper;
    rr(ctx, cx, cy, cw, ch, 28);
    ctx.fill();
    ctx.restore();

    /* HEADER */

    const hh = 250;

    ctx.save();
    rr(ctx, cx, cy, cw, ch, 28);
    ctx.clip();

    const gradient = ctx.createLinearGradient(
      cx, cy, cx + cw, cy + hh
    );

    gradient.addColorStop(0, "#080808");
    gradient.addColorStop(1, "#32060b");

    ctx.fillStyle = gradient;
    ctx.fillRect(cx, cy, cw, hh);

    ctx.fillStyle = C.red;
    ctx.fillRect(cx, cy + hh, cw, 10);

    const ls = 160;
    const lx = cx + pad;
    const ly = cy + (hh - ls) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(
      lx + ls / 2,
      ly + ls / 2,
      ls / 2,
      0,
      Math.PI * 2
    );
    ctx.clip();

    if (logo) {
      ctx.drawImage(logo, lx, ly, ls, ls);
    } else {
      ctx.fillStyle = "#1b1b1b";
      ctx.fillRect(lx, ly, ls, ls);

      ctx.fillStyle = "#fff";
      ctx.font = 900 64px ${FONT};
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("H2", lx + ls / 2, ly + ls / 2);
    }

    ctx.restore();
ctx.beginPath();
    ctx.arc(
      lx + ls / 2,
      ly + ls / 2,
      ls / 2,
      0,
      Math.PI * 2
    );

    ctx.lineWidth = 4;
    ctx.strokeStyle = C.red;
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    const tx = lx + ls + 36;

    ctx.fillStyle = "#fff";
    ctx.font = 900 62px ${FONT};
    spaced(ctx, "2px");
    ctx.fillText("H2WO STORE", tx, cy + hh / 2 + 6);

    ctx.fillStyle = "#ff6573";
    ctx.font = 700 24px ${FONT};
    spaced(ctx, "5px");
    ctx.fillText(
      "CHEAP • SAFE • TRUSTED",
      tx,
      cy + hh / 2 + 52
    );

    spaced(ctx, "0px");
    ctx.restore();

    /* RECEIPT TITLE */

    let y = cy + hh + 94;

    ctx.textAlign = "center";
    ctx.fillStyle = C.ink;
    ctx.font = 800 52px ${FONT};
    spaced(ctx, "4px");
    ctx.fillText("PAYMENT RECEIPT", mid, y);
    spaced(ctx, "0px");

    y += 40;

    const pw = 230;
    const ph = 62;

    ctx.fillStyle = C.greenBg;
    rr(ctx, mid - pw / 2, y, pw, ph, ph / 2);
    ctx.fill();

    ctx.strokeStyle = C.green;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(mid - 80, y + 32);
    ctx.lineTo(mid - 68, y + 44);
    ctx.lineTo(mid - 46, y + 20);
    ctx.stroke();

    ctx.fillStyle = C.green;
    ctx.font = 800 32px ${FONT};
    ctx.textAlign = "left";
    spaced(ctx, "3px");
    ctx.fillText(status, mid - 28, y + 43);
    spaced(ctx, "0px");

    y += ph + 58;

    /* AMOUNT */

    ctx.textAlign = "center";
    ctx.fillStyle = C.muted;
    ctx.font = 700 22px ${FONT};
    spaced(ctx, "3px");
    ctx.fillText("TOTAL AMOUNT PAID", mid, y);
    spaced(ctx, "0px");

    y += 84;

    ctx.fillStyle = C.ink;
    ctx.font = 900 84px ${FONT};
    ctx.fillText(money(d.amount), mid, y);

    y += 50;

    /* ORDER DETAILS */

    const rows = [
      ["TRANSACTION ID", d.transactionId, { mono: true }],
      ["CUSTOMER NAME", d.customerName],
      ["ACCOUNT / USERNAME", d.account],
      ["PRODUCT", d.productName],
      ["DEVICE PACKAGE", ${deviceCount} DEVICE(S)],
      ["DURATION", days ? ${days} DAY(S) : "—"],
      ["QUANTITY", String(d.quantity ?? deviceCount)],
      ["PAYMENT METHOD", d.paymentMethod],
      ["REFERENCE NO.", d.referenceNumber || "Not provided"],
      ["PAYMENT DATE & TIME", fmtDate(d.paidAt)],
      ["PAYMENT STATUS", status, { green: true }],
      ["RECEIPT ISSUED", fmtDate(d.issuedAt)]
    ];

    const left = cx + pad;
    const right = cx + cw - pad;
    const labelW = 300;
    const valW = right - left - labelW - 20;
    const lh = 38;

    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();

    for (const [label, value, options = {}] of rows) {
      const displayValue = String(value ?? "—");

      ctx.font = options.mono
        ? 700 26px ${MONO}
        : 700 28px ${FONT};

      const lines = wrap(ctx, displayValue, valW);
      const rh = Math.max(1, lines.length) * lh + 38;

      ctx.textAlign = "left";
      ctx.fillStyle = C.muted;
      ctx.font = 700 20px ${FONT};
      spaced(ctx, "1.5px");

      ctx.fillText(label, left, y + 47);
      spaced(ctx, "0px");

      ctx.textAlign = "right";
      ctx.fillStyle = options.green ? C.green : C.ink;

      ctx.font = options.mono
        ? 700 26px ${MONO}
        : 700 28px ${FONT};

      lines.forEach((line, i) => {
        ctx.fillText(line, right, y + 47 + i * lh);
      });

      y += rh;

      ctx.strokeStyle = C.line;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    /* FOOTER */

    y += 50;

    ctx.textAlign = "center";
    ctx.fillStyle = C.muted;
    ctx.font = 500 24px ${FONT};

    const footerLines = wrap(
      ctx,
      "Please send this receipt to the admin for verification and approval of your order.",
      cw - pad * 2
    );

    for (const line of footerLines) {
      ctx.fillText(line, mid, y);
      y += 34;
    }
if (d.contactUrl) {
      y += 6;
      ctx.fillStyle = C.ink;
      ctx.font = 700 24px ${FONT};

      ctx.fillText(
        "Admin: " + String(d.contactUrl).replace(/^https?:\/\//, ""),
        mid,
        y
      );

      y += 34;
    }

    y += 18;

    ctx.fillStyle = C.red;
    ctx.font = 800 24px ${FONT};
    spaced(ctx, "3px");

    ctx.fillText(
      "THANK YOU FOR SHOPPING AT H2WO STORE",
      mid,
      y
    );

    spaced(ctx, "0px");

    y += 48;

    return y + 40;
  }

  async function render(data, canvas) {
    const logo = await loadLogo();

    const probe = document.createElement("canvas");
    probe.width = W * S;
    probe.height = 10;

    const total = Math.ceil(
      paint(probe.getContext("2d"), data, logo)
    );

    canvas.width = W * S;
    canvas.height = total * S;

    paint(canvas.getContext("2d"), data, logo);

    return canvas;
  }

  function download(canvas, data) {
    const safeId = String(
      data.transactionId || "H2WO"
    ).replace(/[^a-zA-Z0-9_-]/g, "");

    const name = H2WO-Receipt-${safeId}.png;

    const save = href => {
      const a = document.createElement("a");
      a.href = href;
      a.download = name;

      document.body.appendChild(a);
      a.click();
      a.remove();
    };

    if (canvas.toBlob) {
      canvas.toBlob(blob => {
        if (!blob) {
          return save(canvas.toDataURL("image/png"));
        }

        const url = URL.createObjectURL(blob);

        save(url);

        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 5000);

      }, "image/png");

    } else {
      save(canvas.toDataURL("image/png"));
    }
  }

  window.H2WOReceipt = {
    render,
    download
  };
})();
