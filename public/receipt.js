/* H2WO STORE — receipt image generator (no dependencies).
   Draws a receipt from server-verified order data onto a <canvas> and downloads it as PNG. */
(function () {
  const W = 1080, S = 2; // logical width, pixel scale (2x = sharp on phones)
  const FONT = '"Segoe UI","Helvetica Neue",Roboto,Arial,sans-serif';
  const MONO = '"SF Mono",Consolas,Menlo,"Courier New",monospace';
  const C = { bg: "#eceef1", paper: "#ffffff", ink: "#14171c", muted: "#6b7280", line: "#e5e7eb",
    red: "#e0253a", green: "#15803d", greenBg: "#e6f7ed", blue: "#1d4ed8", blueBg: "#e8f0ff" };

  let logoPromise = null;
  function loadLogo() {
    if (!logoPromise) logoPromise = new Promise(res => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = "/logo.jpg";
    });
    return logoPromise;
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function spaced(ctx, v) { if ("letterSpacing" in ctx) ctx.letterSpacing = v; }

  function wrap(ctx, text, maxW) {
    const out = []; let line = "";
    for (const word of String(text).split(/\s+/)) {
      let w = word;
      while (ctx.measureText(w).width > maxW) { // break very long tokens (e.g. reference numbers)
        let i = w.length;
        while (i > 1 && ctx.measureText(w.slice(0, i)).width > maxW) i--;
        if (line) { out.push(line); line = ""; }
        out.push(w.slice(0, i)); w = w.slice(i);
      }
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width <= maxW) line = test; else { out.push(line); line = w; }
    }
    if (line) out.push(line);
    return out.length ? out : [""];
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "2-digit",
      hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).format(d) + " (PHT)";
  }
  function money(n) {
    return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function paint(ctx, d, logo) {
    ctx.setTransform(S, 0, 0, S, 0, 0);
    const H = ctx.canvas.height / S;
    const cx = 40, cw = W - 80, cy = 40, ch = H - 80, pad = 56, mid = cx + cw / 2;

    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.14)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 8;
    ctx.fillStyle = C.paper; rr(ctx, cx, cy, cw, ch, 28); ctx.fill(); ctx.restore();

    // ---- header (brand) ----
    const hh = 250;
    ctx.save(); rr(ctx, cx, cy, cw, ch, 28); ctx.clip();
    const g = ctx.createLinearGradient(cx, cy, cx + cw, cy + hh);
    g.addColorStop(0, "#080808"); g.addColorStop(1, "#32060b");
    ctx.fillStyle = g; ctx.fillRect(cx, cy, cw, hh);
    ctx.fillStyle = C.red; ctx.fillRect(cx, cy + hh, cw, 10);
    const ls = 160, lx = cx + pad, ly = cy + (hh - ls) / 2;
    ctx.save(); ctx.beginPath(); ctx.arc(lx + ls / 2, ly + ls / 2, ls / 2, 0, Math.PI * 2); ctx.clip();
    if (logo) ctx.drawImage(logo, lx, ly, ls, ls);
    else { ctx.fillStyle = "#1b1b1b"; ctx.fillRect(lx, ly, ls, ls); ctx.fillStyle = "#fff"; ctx.font = `900 64px ${FONT}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("H2", lx + ls / 2, ly + ls / 2); }
    ctx.restore();
    ctx.beginPath(); ctx.arc(lx + ls / 2, ly + ls / 2, ls / 2, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = C.red; ctx.stroke();
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const tx = lx + ls + 36;
    ctx.fillStyle = "#fff"; ctx.font = `900 62px ${FONT}`; spaced(ctx, "2px"); ctx.fillText("H2WO STORE", tx, cy + hh / 2 + 6);
    ctx.fillStyle = "#ff6573"; ctx.font = `700 24px ${FONT}`; spaced(ctx, "5px"); ctx.fillText("CHEAP • SAFE • TRUSTED", tx, cy + hh / 2 + 52);
    spaced(ctx, "0px");
    ctx.restore();

    // ---- title, SUBMITTED badge, amount ----
    let y = cy + hh + 10 + 84;
    ctx.textAlign = "center"; ctx.fillStyle = C.ink; ctx.font = `800 52px ${FONT}`; spaced(ctx, "4px");
    ctx.fillText("ORDER SUBMISSION RECEIPT", mid, y); spaced(ctx, "0px");
    y += 40;
    const pw = 300, ph = 62; ctx.fillStyle = C.blueBg; rr(ctx, mid - pw / 2, y, pw, ph, ph / 2); ctx.fill();
    ctx.strokeStyle = C.blue; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(mid - 105, y + 31, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = C.blue; ctx.font = `800 32px ${FONT}`; ctx.textAlign = "left"; spaced(ctx, "3px");
    ctx.fillText("SUBMITTED", mid - 75, y + 43); spaced(ctx, "0px");
    y += ph + 58;
    ctx.textAlign = "center"; ctx.fillStyle = C.muted; ctx.font = `700 22px ${FONT}`; spaced(ctx, "3px");
    ctx.fillText("ORDER AMOUNT", mid, y); spaced(ctx, "0px");
    y += 84; ctx.fillStyle = C.ink; ctx.font = `900 84px ${FONT}`; ctx.fillText(money(d.amount), mid, y);
    y += 50;

    // ---- detail rows ----
    const rows = [
      ["TRANSACTION ID", d.transactionId, { mono: true }],
      ["CUSTOMER NAME", d.customerName],
      ["ACCOUNT / USERNAME", d.account],
      ["PRODUCT", d.productName],
      ["QUANTITY", String(d.quantity)],
      ["PAYMENT METHOD", d.paymentMethod],
      ["REFERENCE NO.", d.referenceNumber || "Not provided"],
      ["SUBMITTED DATE & TIME", fmtDate(d.submittedAt || d.issuedAt)],
      ["PAYMENT STATUS", String(d.paymentStatus || "NOT VERIFIED").toUpperCase()],
      ["RECEIPT ISSUED", fmtDate(d.issuedAt)]
    ];
    const left = cx + pad, right = cx + cw - pad, labelW = 300, valW = right - left - labelW - 20, lh = 38;
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    for (const [label, value, o = {}] of rows) {
      ctx.font = o.mono ? `700 26px ${MONO}` : `700 28px ${FONT}`;
      const lines = wrap(ctx, value, valW);
      const rh = Math.max(1, lines.length) * lh + 38;
      ctx.textAlign = "left"; ctx.fillStyle = C.muted; ctx.font = `700 20px ${FONT}`; spaced(ctx, "1.5px");
      ctx.fillText(label, left, y + 19 + 28); spaced(ctx, "0px");
      ctx.textAlign = "right"; ctx.fillStyle = o.green ? C.green : C.ink; ctx.font = o.mono ? `700 26px ${MONO}` : `700 28px ${FONT}`;
      lines.forEach((ln, i) => ctx.fillText(ln, right, y + 19 + 28 + i * lh));
      y += rh;
      ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    }

    // ---- footer ----
    y += 50; ctx.textAlign = "center";
    ctx.fillStyle = C.muted; ctx.font = `500 24px ${FONT}`;
    for (const ln of wrap(ctx, "This confirms your order and payment proof were submitted. Payment is NOT YET VERIFIED. Please send this receipt to the admin.", cw - pad * 2)) { ctx.fillText(ln, mid, y); y += 34; }
    if (d.contactUrl) { y += 6; ctx.fillStyle = C.ink; ctx.font = `700 24px ${FONT}`; ctx.fillText("Admin: " + String(d.contactUrl).replace(/^https?:\/\//, ""), mid, y); y += 34; }
    y += 18; ctx.fillStyle = C.red; ctx.font = `800 24px ${FONT}`; spaced(ctx, "3px");
    ctx.fillText("THANK YOU FOR SHOPPING AT H2WO STORE", mid, y); spaced(ctx, "0px");
    y += 48;
    return y + 40; // card bottom + outer margin
  }

  async function render(data, canvas) {
    const logo = await loadLogo();
    const probe = document.createElement("canvas"); probe.width = W * S; probe.height = 10;
    const total = Math.ceil(paint(probe.getContext("2d"), data, logo));
    canvas.width = W * S; canvas.height = total * S;
    paint(canvas.getContext("2d"), data, logo);
    return canvas;
  }

  function download(canvas, data) {
    const name = `H2WO-Receipt-${data.transactionId}.png`;
    const save = href => { const a = document.createElement("a"); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
    if (canvas.toBlob) {
      canvas.toBlob(blob => {
        if (!blob) return save(canvas.toDataURL("image/png"));
        const url = URL.createObjectURL(blob); save(url); setTimeout(() => URL.revokeObjectURL(url), 5000);
      }, "image/png");
    } else save(canvas.toDataURL("image/png"));
  }

  window.H2WOReceipt = { render, download };
})();
