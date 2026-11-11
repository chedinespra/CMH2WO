let csrf = "";
let currentOrder = null;
const $ = id => document.getElementById(id);
async function api(url, options={}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
async function refreshCsrf() { const d = await api("/api/csrf"); csrf = d.token; }
function toast(message) { const el=$("toast"); el.textContent=message; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),3000); }
function money(n) { return "₱"+Number(n).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2}); }
async function loadPublic() {
  const d=await api("/api/public");
  $("brandName").textContent=d.siteName; $("footerName").textContent=d.siteName; document.title=d.siteName+" — Payment Portal";
  for (const [day,price] of Object.entries(d.prices)) $("days").querySelector(`option[value="${day}"]`).textContent=`${day} Day${day==="1"?"":"s"} — ${money(price)}`;
  updatePrice();
  if (d.qrUrl) {
    $("qrFrame").innerHTML=`<img src="${d.qrUrl}" alt="GCash QR code">`;
    $("downloadQr").href=d.qrUrl; $("downloadQr").classList.remove("hidden");
  } else {
    $("qrFrame").innerHTML='<div class="qr-empty">GCash QR code has not been uploaded yet.<br>Contact the administrator.</div>';
    $("downloadQr").classList.add("hidden");
  }
}
function updatePrice() {
  const opt=$("days").selectedOptions[0];
  const match=opt.textContent.match(/₱[\d,.]+/);
  $("price").textContent=match?match[0]:"—";
}
$("days").addEventListener("change",updatePrice);
$("year").textContent=new Date().getFullYear();
$("orderForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const username=$("username").value.trim();
  if (!username) return toast("Enter your in-game username.");
  currentOrder={username,days:$("days").value};
  const d=await api("/api/public");
  const amount=d.prices[currentOrder.days];
  $("summary").innerHTML=`<span>Username</span><strong></strong><span>Duration</span><strong></strong><span>Total payment</span><strong class="total"></strong>`;
  const vals=$("summary").querySelectorAll("strong");
  vals[0].textContent=username; vals[1].textContent=currentOrder.days+" day(s)"; vals[2].textContent=money(amount);
  $("orderPanel").classList.add("hidden"); $("paymentPanel").classList.remove("hidden");
  window.scrollTo({top:$("paymentPanel").offsetTop-20,behavior:"smooth"});
});
$("proofForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if (!currentOrder) return toast("Please create an order first.");
  const file=$("proof").files[0];
  if (!file) return toast("Upload your payment screenshot.");
  if (!["image/jpeg","image/png"].includes(file.type)) return toast("Only JPG and PNG are accepted.");
  if (file.size>5*1024*1024) return toast("Image must be 5 MB or smaller.");
  const fd=new FormData(); fd.append("username",currentOrder.username); fd.append("days",currentOrder.days);
  fd.append("referenceNumber",$("reference").value.trim()); fd.append("proof",file);
  const button=$("proofForm").querySelector("button"); button.disabled=true; button.textContent="SUBMITTING…";
  try {
    await refreshCsrf();
    const d=await api("/api/orders",{method:"POST",headers:{"x-csrf-token":csrf},body:fd});
    $("successMessage").textContent=d.message+" Order ID: "+d.orderId;
    $("successMessage").classList.remove("hidden"); $("proofForm").classList.add("hidden");
  } catch(err) { toast(err.message); button.disabled=false; button.innerHTML='SUBMIT PAYMENT PROOF <span>→</span>'; }
});
$("showAdmin").addEventListener("click",()=>{$("adminLoginPanel").classList.remove("hidden");$("adminLoginPanel").scrollIntoView({behavior:"smooth"});});
$("closeAdmin").addEventListener("click",()=>$("adminLoginPanel").classList.add("hidden"));
$("adminLoginForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try {
    await refreshCsrf();
    const d=await api("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json","x-csrf-token":csrf},body:JSON.stringify({username:$("adminUser").value,password:$("adminPass").value})});
    csrf=d.token; location.href="/admin.html";
  } catch(err){toast(err.message);}
});
loadPublic().catch(e=>toast(e.message));