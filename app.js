import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  getAdditionalUserInfo,
  reauthenticateWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBmVv0d5rsBOF5tUau3LuRF-LasmgYNbXE",
  authDomain: "sppg-tanjung-pering-2.firebaseapp.com",
  projectId: "sppg-tanjung-pering-2",
  storageBucket: "sppg-tanjung-pering-2.firebasestorage.app",
  messagingSenderId: "871982906822",
  appId: "1:871982906822:web:0cefb8dc71c1e09d5706c7",
  measurementId: "G-9RLD44C7HZ",
};
window.firebaseConfigInfo = { ...firebaseConfig };

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("https://www.googleapis.com/auth/drive");

const legacyDummyBarangIds = new Set(["b1", "b2", "b3", "b4"]);

window.appState = {
  barang: [],
  barangOperasional: [],
  barangOperasionalLoaded: false,
  barangOperasionalError: "",
  barangPage: 1,
  barangPageSize: 10,
  barangFilterKey: "",
  masterBarang: [],
  masterBarangLoaded: false,
  masterBarangError: "",
  masterBarangPage: 1,
  masterBarangPageSize: 10,
  masterBarangFilterKey: "",
  inventoryItems: [],
  inventoryLoaded: false,
  kitchenSettings: null,
  suppliers: [],
  suppliersLoaded: false,
  menus: [],
  menusLoaded: false,
  limbah: [],
  limbahLoaded: false,
  limbahPage: 1,
  limbahPageSize: 10,
  sppLetters: [],
  sppLettersLoaded: false,
  menuPage: 1,
  menuPageSize: 10,
  users: [],
  usersLoaded: false,
  userPage: 1,
  userPageSize: 10,
  access: null,
  pms: [],
  pmsLoaded: false,
  pmDailyHistory: [],
  pmDailyHistoryLoaded: false,
  dokumen: [],
  user: null,
  pendingDelete: null,
  dashboardChart: null,
  statusChart: null,
  pmMap: null,
  pmMapMarkers: null,
  pmRouteMetrics: null,
  pmRouteLoadingKey: null,
  driveAccessToken: null,
  driveQuota: null,
  pendingDriveDelete: null,
  drivePage: 1,
  drivePageSize: 10,
  driveLayout: "list",
  drivePreviewUrl: null,
  driveLoaded: false,
  dashboardLoaded: false,
};

let deferredPrompt = null;
let adminArrivalPhotoPreviewUrl = null;
let menuPhotoDataUrl = "";
let menuPhotoSizeBytes = 0;
let menuPhotoRemoved = false;
let menuPhotoRequestVersion = 0;
let limbahPhotos = [];
let limbahPhotoRequestVersion = 0;
let sppProductPhotoLayouts = [];
let sppInvoicePhotos = [];
let sppProductPhotoLayout = 1;
let sppDatabaseProductPhotos = [];
let sppDatabasePhotoLoadVersion = 0;
let sppEditingLetterId = "";
const ADMIN_ARRIVAL_PAGE_SIZE = 10;
let adminArrivalVisibleCount = ADMIN_ARRIVAL_PAGE_SIZE;
let adminArrivalFilterKey = "";
let adminArrivalObserver = null;
let firestoreListenersStarted = false;
let authValidationVersion = 0;
let accessDeniedNotice = false;
let accountMonitorUnsubscribe = null;

const USER_ROLES = {
  SUPER_ADMIN: "super_admin",
  LOGISTICS: "admin_logistik",
};
const DESIGNATED_SUPER_ADMIN_EMAIL = "rahmatdev09@gmail.com";

function isOperationalPage() {
  return new URLSearchParams(location.search).get("jenis") === "operasional";
}

function isMasterBarangPage() {
  return (location.pathname.split("/").pop() || "") === "master-barang.html";
}

function getCurrentBarangItems() {
  return isOperationalPage()
    ? window.appState.barangOperasional
    : window.appState.barang;
}

function getCurrentBarangCollection() {
  return isOperationalPage() ? "operational_items" : "mbg_items";
}

function normalizeAccountEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

async function getAccountAccess(email) {
  const normalizedEmail = normalizeAccountEmail(email);
  if (!normalizedEmail) return null;
  const accountSnapshot = await getDoc(doc(db, "app_users", normalizedEmail));
  if (!accountSnapshot.exists()) {
    return normalizedEmail === DESIGNATED_SUPER_ADMIN_EMAIL
      ? {
          email: normalizedEmail,
          displayName: "Super Admin",
          role: USER_ROLES.SUPER_ADMIN,
          active: true,
        }
      : null;
  }
  const account = { email: normalizedEmail, ...accountSnapshot.data() };
  return normalizedEmail === DESIGNATED_SUPER_ADMIN_EMAIL
    ? { ...account, role: USER_ROLES.SUPER_ADMIN, active: true }
    : account;
}

function isSuperAdmin() {
  return (
    window.appState.access?.role === USER_ROLES.SUPER_ADMIN &&
    window.appState.access?.active === true
  );
}

function canUseCurrentPage(role) {
  if (role === USER_ROLES.SUPER_ADMIN) return true;
  if (window.appState.access?.plan !== "premium") return false;
  const page = location.pathname.split("/").pop() || "index.html";
  return !["pm.html", "dokumen.html", "setting.html", "user.html"].includes(
    page,
  );
}

function renderAccessGate({
  checking = false,
  denied = false,
  restricted = false,
  premiumRequired = false,
} = {}) {
  let gate = document.getElementById("accountAccessGate");
  if (!gate) {
    gate = document.createElement("div");
    gate.id = "accountAccessGate";
    gate.className =
      "fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-5";
    document.body.appendChild(gate);
  }
  gate.classList.remove("hidden");
  gate.innerHTML = `
    <section class="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl text-center">
      <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${denied || restricted ? "bg-rose-100 text-rose-600" : "bg-sky-100 text-sky-600"}">
        <i class="fa-solid ${checking ? "fa-spinner fa-spin" : denied || restricted || premiumRequired ? "fa-lock" : "fa-utensils"} text-xl"></i>
      </div>
      <h1 class="text-lg font-bold text-slate-800">${checking ? "Memeriksa akses akun" : premiumRequired ? "Paket Premium diperlukan" : restricted ? "Fitur ini dibatasi" : denied ? "Akun belum diizinkan" : "Masuk ke MBG System"}</h1>
      <p class="mt-2 text-sm leading-6 text-slate-500">${checking ? "Mohon tunggu sebentar." : premiumRequired ? "Paket Gratis hanya dapat membuka profil. Upgrade paket untuk menggunakan seluruh fitur pengelolaan SPPG." : restricted ? "Halaman ini hanya dapat dibuka oleh Super Admin. Tautan fitur ini disembunyikan dari sidebar untuk role Anda." : denied ? "Minta Super Admin mendaftarkan email Google Anda sebelum login." : "Hanya akun Google yang didaftarkan oleh Super Admin yang dapat menggunakan aplikasi."}</p>
      ${premiumRequired ? `<a href="./landing-page/console.html" class="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-700">Lihat profil &amp; paket</a>` : checking || restricted ? "" : `<button onclick="handleLoginClick()" class="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-700"><i class="fa-brands fa-google"></i> Login dengan Google</button>`}
    </section>`;
}

function hideAccessGate() {
  document.getElementById("accountAccessGate")?.classList.add("hidden");
}

function updateRoleNavigation() {
  const superAdmin = isSuperAdmin();
  document
    .querySelectorAll(
      '#nav-users, a[href="./pm.html"], a[href="./dokumen.html"], a[href="./setting.html"]',
    )
    .forEach((link) => {
      link.classList.toggle("hidden", !superAdmin);
    });
  const nav = document.querySelector("#sidebar nav");
  if (nav && !nav.querySelector("#nav-limbah")) {
    const link = document.createElement("a");
    const active =
      (location.pathname.split("/").pop() || "index.html") === "limbah.html";
    link.id = "nav-limbah";
    link.href = "./limbah.html";
    link.className = `nav-item flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${active ? "bg-sky-600 text-white shadow-md shadow-sky-600/30" : "hover:bg-slate-800 hover:text-white"}`;
    link.innerHTML =
      '<i class="fa-solid fa-recycle w-5 text-center"></i><span>Limbah</span>';
    const after = nav.querySelector('#nav-menu, a[href="./menu.html"]');
    const anchor =
      after?.parentElement === nav
        ? after
        : nav.querySelector('#nav-barang, a[href="./barang.html"]');
    if (anchor?.parentElement === nav) anchor.after(link);
    else nav.appendChild(link);
  }
  if (nav && !nav.querySelector("#nav-operasional")) {
    const link = document.createElement("a");
    link.id = "nav-operasional";
    link.href = "./barang.html?jenis=operasional";
    link.className =
      "nav-item flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200";
    link.innerHTML =
      '<i class="fa-solid fa-toolbox w-5 text-center"></i><span>Kelola Operasional</span>';
    const barangLink = nav.querySelector(
      '#nav-barang, a[href="./barang.html"]',
    );
    if (barangLink?.parentElement === nav) barangLink.after(link);
    else nav.appendChild(link);
  }
  if (nav && !nav.querySelector("#nav-master-barang")) {
    const link = document.createElement("a");
    link.id = "nav-master-barang";
    link.href = "./master-barang.html";
    link.className =
      "nav-item flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200";
    link.innerHTML =
      '<i class="fa-solid fa-list-check w-5 text-center"></i><span>Master Barang</span>';
    const after = nav.querySelector("#nav-operasional");
    if (after?.parentElement === nav) after.after(link);
    else nav.appendChild(link);
  }
  const barangLink = nav?.querySelector('#nav-barang, a[href="./barang.html"]');
  const operationalLink = nav?.querySelector("#nav-operasional");
  const masterBarangLink = nav?.querySelector("#nav-master-barang");
  const currentPage = location.pathname.split("/").pop() || "index.html";
  [
    [barangLink, currentPage === "barang.html" && !isOperationalPage()],
    [operationalLink, isOperationalPage()],
    [masterBarangLink, isMasterBarangPage()],
  ].forEach(([link, active]) => {
    if (!link) return;
    link.classList.toggle("bg-sky-600", active);
    link.classList.toggle("text-white", active);
    link.classList.toggle("shadow-md", active);
    link.classList.toggle("shadow-sky-600/30", active);
    link.classList.toggle("hover:bg-slate-800", !active);
    link.classList.toggle("hover:text-white", !active);
  });
  if (nav && !nav.querySelector("#nav-surat")) {
    const link = document.createElement("a");
    const active =
      (location.pathname.split("/").pop() || "index.html") === "surat.html";
    link.id = "nav-surat";
    link.href = "./surat.html";
    link.className = `nav-item flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${active ? "bg-sky-600 text-white shadow-md shadow-sky-600/30" : "hover:bg-slate-800 hover:text-white"}`;
    link.innerHTML =
      '<i class="fa-solid fa-envelope-open-text w-5 text-center"></i><span>Surat Menyurat</span>';
    const after = nav.querySelector('#nav-dokumen, a[href="./dokumen.html"]');
    if (after?.parentElement === nav) after.after(link);
    else nav.appendChild(link);
  }
}

function setupInstallPrompt() {
  const installButton = document.getElementById("installAppBtn");
  if (!installButton) return;

  const showInstallButton = () => {
    installButton.classList.remove("hidden");
    installButton.classList.add("inline-flex");
  };
  const markInstalled = () => {
    try {
      localStorage.setItem("mbgPwaInstalled", "true");
    } catch {}
    showInstallButton();
    installButton.disabled = true;
    installButton.classList.remove(
      "hover:bg-emerald-500/20",
      "text-emerald-300",
    );
    installButton.classList.add("cursor-default", "text-emerald-200");
    installButton.innerHTML =
      '<i class="fa-solid fa-circle-check"></i><span>Terinstal</span>';
  };
  const installedPreviously =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true ||
    localStorage.getItem("mbgPwaInstalled") === "true";
  if (installedPreviously) {
    markInstalled();
    return;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    showInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    markInstalled();
    showToast("MBG berhasil dipasang sebagai aplikasi", "success");
  });

  installButton.addEventListener("click", async () => {
    if (!deferredPrompt) {
      showToast(
        "Browser belum menyediakan proses pemasangan aplikasi.",
        "info",
      );
      return;
    }

    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      markInstalled();
      showToast("Proses pemasangan dimulai", "success");
    } else {
      showToast("Pemasangan dibatalkan", "info");
    }
    deferredPrompt = null;
  });
}

window.showToast = function (msg, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  container.style.zIndex = "120";

  const toast = document.createElement("div");
  const bg =
    type === "success"
      ? "bg-emerald-600"
      : type === "error"
        ? "bg-red-600"
        : "bg-slate-800";
  toast.className = `${bg} text-white text-xs px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 transition-all duration-300 pointer-events-auto transform translate-y-2 opacity-0`;
  toast.innerHTML = `<i class="fa-solid ${type === "success" ? "fa-circle-check" : "fa-circle-info"}"></i> <span>${msg}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove("translate-y-2", "opacity-0");
  }, 10);
  setTimeout(() => {
    toast.classList.add("opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
};

function setButtonLoading(button, loading, loadingText) {
  if (!button) return;
  if (loading) {
    button.dataset.originalContent = button.innerHTML;
    button.disabled = true;
    button.classList.add("opacity-70", "cursor-wait");
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>${loadingText}</span>`;
  } else {
    button.disabled = false;
    button.classList.remove("opacity-70", "cursor-wait");
    button.innerHTML = button.dataset.originalContent || button.innerHTML;
  }
}

function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return "-";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length - 1; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${unit}`;
}

function getDocumentSizeBytes(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const match = String(value || "")
    .trim()
    .match(/^([\d.,]+)\s*(B|KB|MB|GB|TB)$/i);
  if (!match) return 0;
  const amount = Number(match[1].replace(",", "."));
  const unitIndex = ["B", "KB", "MB", "GB", "TB"].indexOf(
    match[2].toUpperCase(),
  );
  return amount * 1024 ** Math.max(unitIndex, 0);
}

function formatDocumentSize(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (!Number.isFinite(Number(value))) return escapeHtml(value);
  return formatFileSize(Number(value));
}

function showDriveApiError(error) {
  const message = String(error?.message || "");
  const errorCode = String(error?.code || "");
  if (errorCode === "auth/unauthorized-domain") {
    showToast(
      `Domain ${location.hostname} belum diizinkan di Firebase Authentication. Tambahkan domain ini pada Authorized domains.`,
      "error",
    );
    return;
  }
  if (errorCode === "auth/popup-blocked") {
    showToast(
      "Popup login diblokir browser. Izinkan pop-up untuk situs ini lalu coba login lagi.",
      "error",
    );
    return;
  }
  const setupNotice = document.getElementById("driveApiSetupNotice");
  const isApiDisabled =
    /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(
      message,
    );
  if (setupNotice) setupNotice.classList.toggle("hidden", !isApiDisabled);
  if (isApiDisabled) {
    showDriveReconnectButton(false);
    const storageStatus = document.getElementById("driveStorageStatus");
    const storageUsed = document.getElementById("driveStorageUsed");
    const storageTotal = document.getElementById("driveStorageTotal");
    if (storageStatus) storageStatus.textContent = "Drive API belum aktif";
    if (storageUsed) storageUsed.textContent = "Tidak tersedia";
    if (storageTotal)
      storageTotal.textContent = "Aktifkan Drive API lalu muat ulang halaman";
    showToast(
      "Google Drive API belum aktif. Aktifkan melalui petunjuk di panel storage.",
      "error",
    );
    return;
  }
  if (/popup-closed-by-user|cancelled-popup-request/i.test(message)) return;
  if (/auth\/popup-blocked|popup-blocked/i.test(message)) {
    window.appState.driveLoaded = false;
    showDriveReconnectButton(true);
    renderDokumenTable();
  }
  showToast(message || "Koneksi Google Drive gagal", "error");
  window.appState.driveLoaded = false;
  renderDokumenTable();
}

function renderDriveQuota() {
  const usedElement = document.getElementById("driveStorageUsed");
  const totalElement = document.getElementById("driveStorageTotal");
  const bar = document.getElementById("driveStorageBar");
  const status = document.getElementById("driveStorageStatus");
  const reconnectButton = document.getElementById("driveReconnectButton");
  const documentsTotal = document.getElementById("driveDocumentsTotal");
  const documentBytes = window.appState.dokumen.reduce(
    (total, item) => total + getDocumentSizeBytes(item.size),
    0,
  );
  if (documentsTotal)
    documentsTotal.textContent = formatFileSize(documentBytes);
  if (!usedElement || !totalElement || !bar || !status) return;

  const quota = window.appState.driveQuota;
  if (!quota) {
    const hasWebLogin = Boolean(window.appState.user);
    const needsLoginRefresh = Boolean(
      hasWebLogin &&
      !window.appState.driveAccessToken &&
      !readDrivePermission(window.appState.user.uid),
    );
    const needsDriveReconnect = Boolean(
      hasWebLogin &&
      !window.appState.driveAccessToken &&
      readDrivePermission(window.appState.user.uid),
    );
    const isConnecting = Boolean(
      window.appState.user && window.appState.driveAccessToken,
    );
    usedElement.textContent = needsLoginRefresh
      ? "Izin Drive belum diberikan"
      : needsDriveReconnect
        ? "Web login aktif Â· sesi Drive berakhir"
        : isConnecting
          ? "Sedang memuat..."
          : "Belum login";
    totalElement.textContent = needsLoginRefresh
      ? "Sambungkan Google Drive untuk mengizinkan akses"
      : needsDriveReconnect
        ? "Sambungkan Drive lagi tanpa keluar dari akun web"
        : isConnecting
          ? "Mengambil kapasitas Google Drive..."
          : "Login Google untuk melihat storage";
    status.textContent = needsLoginRefresh
      ? "Izin Drive diperlukan"
      : needsDriveReconnect
        ? "Perlu sambungkan Drive"
        : isConnecting
          ? "Menghubungkan otomatis..."
          : "Belum login";
    reconnectButton?.classList.toggle(
      "hidden",
      !(window.appState.user && !window.appState.driveAccessToken),
    );
    if (reconnectButton && hasWebLogin)
      reconnectButton.innerHTML =
        '<i class="fa-brands fa-google mr-1"></i>Sambungkan Drive';
    bar.style.width = "0%";
    return;
  }

  const used = Number(quota.usage || 0);
  const limit = Number(quota.limit || 0);
  const percent = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  usedElement.textContent = formatFileSize(used);
  totalElement.textContent =
    limit > 0
      ? `dari ${formatFileSize(limit)}`
      : "Kuota total tidak dilaporkan Google";
  status.textContent =
    limit > 0
      ? `${percent.toLocaleString("id-ID", { maximumFractionDigits: 1 })}% terpakai`
      : "Pemakaian Drive";
  reconnectButton?.classList.add("hidden");
  bar.style.width = `${percent}%`;
}

async function authorizeGoogleDrive() {
  if (!window.appState.user)
    throw new Error("Silakan login Google terlebih dahulu.");
  const cachedToken = readDriveToken(window.appState.user.uid);
  if (cachedToken) {
    window.appState.driveAccessToken = cachedToken;
    return cachedToken;
  }
  try {
    const result = await reauthenticateWithPopup(
      window.appState.user,
      googleProvider,
    );
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      saveDriveToken(credential.accessToken, result.user.uid);
      saveDrivePermission(result.user.uid);
      setDriveLoadingState(true, "Menyambungkan kembali ke Google Drive...");
      return credential.accessToken;
    }
    throw new Error("Google belum memberikan akses Drive.");
  } catch (error) {
    throw new Error(error?.message || "Penyegaran akses Google Drive gagal.");
  }
}

function setDriveLoadingState(
  isLoading,
  message = "Menghubungkan ke Google Drive...",
) {
  const tbody = document.getElementById("dokumenTableBody");
  const count = document.getElementById("driveFilesCount");
  const status = document.getElementById("driveStorageStatus");
  const reconnectButton = document.getElementById("driveReconnectButton");
  if (isLoading) {
    reconnectButton?.classList.add("hidden");
    if (count)
      count.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Memuat file...';
    if (status)
      status.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Menghubungkan...';
    if (tbody)
      tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-sm font-medium text-sky-700"><i class="fa-solid fa-spinner fa-spin mr-2"></i>${escapeHtml(message)}</td></tr>`;
  }
}

function showDriveReconnectButton(visible) {
  const button = document.getElementById("driveReconnectButton");
  button?.classList.toggle("hidden", !visible);
}

function readDrivePermission(userId) {
  try {
    const saved = JSON.parse(
      localStorage.getItem("mbgDrivePermission") || "null",
    );
    return saved?.userId === userId && saved.scopeVersion === 4;
  } catch {
    return false;
  }
}

function saveDrivePermission(userId) {
  try {
    localStorage.setItem(
      "mbgDrivePermission",
      JSON.stringify({ userId, scopeVersion: 4 }),
    );
  } catch {}
}

function saveDrivePermissionFromUser(user) {
  if (!user) return;
  const provider = user.providerData?.find(
    (entry) => entry.providerId === "google.com",
  );
  if (provider) saveDrivePermission(user.uid);
}

function readDriveToken(userId) {
  try {
    const saved = JSON.parse(
      localStorage.getItem("mbgDriveSession") ||
        sessionStorage.getItem("mbgDriveSession") ||
        "null",
    );
    if (
      !saved ||
      saved.userId !== userId ||
      saved.scopeVersion !== 4 ||
      saved.expiresAt <= Date.now()
    ) {
      if (saved?.expiresAt <= Date.now()) {
        sessionStorage.removeItem("mbgDriveSession");
        localStorage.removeItem("mbgDriveSession");
      }
      return null;
    }
    return saved.accessToken;
  } catch {
    return null;
  }
}

function saveDriveToken(accessToken, userId) {
  window.appState.driveAccessToken = accessToken;
  try {
    sessionStorage.setItem(
      "mbgDriveSession",
      JSON.stringify({
        accessToken,
        userId,
        scopeVersion: 4,
        expiresAt: Date.now() + 50 * 60 * 1000,
      }),
    );
    localStorage.setItem(
      "mbgDriveSession",
      JSON.stringify({
        accessToken,
        userId,
        scopeVersion: 4,
        expiresAt: Date.now() + 50 * 60 * 1000,
      }),
    );
  } catch {}
}

function clearDriveToken() {
  window.appState.driveAccessToken = null;
  window.appState.driveQuota = null;
  window.appState.dokumen = [];
  window.appState.driveLoaded = false;
  try {
    sessionStorage.removeItem("mbgDriveSession");
    localStorage.removeItem("mbgDriveSession");
  } catch {}
  renderDriveQuota();
  renderDokumenTable();
  renderGoogleDriveInfo();
}

async function loadDriveQuota(accessToken) {
  const response = await fetch(
    "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress),storageQuota",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const result = await response.json();
  if (response.status === 401) {
    clearDriveToken();
    window.appState.driveLoaded = false;
    showDriveReconnectButton(true);
  }
  if (!response.ok)
    throw new Error(
      result.error?.message || "Tidak dapat membaca kapasitas Google Drive.",
    );
  window.appState.driveQuota = result.storageQuota || {};
  showDriveReconnectButton(false);
  renderDriveQuota();
  renderGoogleDriveInfo();
  return result;
}

async function refreshDriveConnection(accessToken) {
  window.appState.driveLoaded = false;
  setDriveLoadingState(
    true,
    "Memuat penyimpanan dan daftar file Google Drive...",
  );
  const account = await loadDriveQuota(accessToken);
  const accountLabel = document.getElementById("driveAccountLabel");
  if (accountLabel) {
    accountLabel.textContent =
      account.user?.emailAddress || "Google Drive terhubung";
  }
  await loadDriveFiles(accessToken);
}

function getDriveCategory(file) {
  return (
    file.description?.match(/Dokumen MBG\s*[-:]\s*(.+)/i)?.[1]?.trim() ||
    "Google Drive"
  );
}

async function loadDriveFiles(accessToken = window.appState.driveAccessToken) {
  if (!accessToken) return;
  window.appState.driveLoaded = false;
  setDriveLoadingState(true, "Memuat file dari Google Drive...");
  const files = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
      pageSize: "100",
      orderBy: "modifiedTime desc",
      fields:
        "nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,description,owners(displayName,emailAddress))",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const result = await response.json();
    if (response.status === 401) {
      clearDriveToken();
      window.appState.driveLoaded = false;
      showDriveReconnectButton(true);
    }
    if (!response.ok) {
      throw new Error(
        result.error?.message || "Gagal mengambil daftar file Google Drive.",
      );
    }
    files.push(...(result.files || []));
    pageToken = result.nextPageToken || "";
  } while (pageToken);

  window.appState.dokumen = files.map((file) => ({
    ...file,
    category: getDriveCategory(file),
  }));
  window.appState.driveLoaded = true;
  showDriveReconnectButton(false);
  renderDokumenTable();
  updateDashboardMetrics();
}

function formatDriveDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function getShortFileType(file) {
  const mime = file.mimeType || "";
  const extension = file.name?.match(/\.([^.]+)$/)?.[1];
  const knownTypes = {
    "application/pdf": "PDF",
    "image/jpeg": "JPG",
    "image/png": "PNG",
    "image/gif": "GIF",
    "image/webp": "WEBP",
    "application/vnd.google-apps.document": "DOC",
    "application/vnd.google-apps.spreadsheet": "SHEET",
    "application/vnd.google-apps.presentation": "SLIDE",
  };
  return knownTypes[mime] || extension?.toUpperCase().slice(0, 6) || "FILE";
}

function isDriveImage(file) {
  return (file.mimeType || "").startsWith("image/");
}

window.downloadDriveFile = async function (fileId, button) {
  const file = window.appState.dokumen.find((item) => item.id === fileId);
  if (!file) return;
  setButtonLoading(button, true, "Mengambil...");
  try {
    const exportOptions = {
      "application/vnd.google-apps.document": {
        mimeType: "application/pdf",
        extension: ".pdf",
      },
      "application/vnd.google-apps.spreadsheet": {
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        extension: ".xlsx",
      },
      "application/vnd.google-apps.presentation": {
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        extension: ".pptx",
      },
    };
    const exportOption = exportOptions[file.mimeType];
    const isGoogleDoc = Boolean(exportOption);
    const url = isGoogleDoc
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportOption.mimeType)}`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${window.appState.driveAccessToken}` },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 401) clearDriveToken();
      throw new Error(error.error?.message || "Gagal mengunduh file Drive.");
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download =
      isGoogleDoc && !file.name.toLowerCase().endsWith(exportOption.extension)
        ? `${file.name}${exportOption.extension}`
        : file.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    showDriveApiError(error);
  } finally {
    setButtonLoading(button, false);
  }
};

window.showDriveFileDetails = async function (fileId) {
  const file = window.appState.dokumen.find((item) => item.id === fileId);
  if (!file) return;
  if (window.appState.drivePreviewUrl) {
    URL.revokeObjectURL(window.appState.drivePreviewUrl);
    window.appState.drivePreviewUrl = null;
  }
  document.getElementById("driveDetailName").textContent = file.name || "-";
  document.getElementById("driveDetailCategory").textContent =
    getDriveCategory(file);
  document.getElementById("driveDetailCreated").textContent = formatDriveDate(
    file.createdTime,
  );
  document.getElementById("driveDetailModified").textContent = formatDriveDate(
    file.modifiedTime,
  );
  document.getElementById("driveDetailSize").textContent = formatFileSize(
    file.size,
  );
  document.getElementById("driveDetailType").textContent = file.mimeType || "-";
  document.getElementById("driveDetailOwner").textContent =
    file.owners?.[0]?.emailAddress || "-";
  const openLink = document.getElementById("driveDetailOpenLink");
  openLink.href =
    file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
  document.getElementById("modalDriveDetail").classList.remove("hidden");
  document.getElementById("driveDetailDownload").onclick = (event) =>
    window.downloadDriveFile(file.id, event.currentTarget);
  const previewPanel = document.getElementById("driveImagePreviewPanel");
  const previewImage = document.getElementById("driveImagePreview");
  const previewMessage = document.getElementById("driveImagePreviewMessage");
  const showPreviewMessage = (message, loading = false) => {
    previewMessage.innerHTML = loading
      ? '<i class="fa-solid fa-spinner fa-spin mr-2" aria-hidden="true"></i>'
      : "";
    previewMessage.append(document.createTextNode(message));
    previewMessage.classList.remove("hidden");
  };
  if (isDriveImage(file)) {
    previewPanel.classList.remove("hidden");
    showPreviewMessage("Memuat pratinjau gambar...", true);
    previewImage.classList.add("hidden");
    previewImage.removeAttribute("src");
    try {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
        {
          headers: {
            Authorization: `Bearer ${window.appState.driveAccessToken}`,
          },
        },
      );
      if (!response.ok) {
        if (response.status === 401) clearDriveToken();
        throw new Error("Pratinjau gambar tidak dapat dimuat.");
      }
      const previewUrl = URL.createObjectURL(await response.blob());
      window.appState.drivePreviewUrl = previewUrl;
      await new Promise((resolve, reject) => {
        previewImage.onload = () => resolve();
        previewImage.onerror = () =>
          reject(new Error("Gambar tidak dapat ditampilkan."));
        previewImage.src = previewUrl;
      });
      previewImage.classList.remove("hidden");
      previewMessage.classList.add("hidden");
    } catch (error) {
      showPreviewMessage(error.message);
      showDriveApiError(error);
    }
  } else {
    previewPanel.classList.add("hidden");
    previewImage.removeAttribute("src");
  }
};

window.closeDriveDetail = function () {
  document.getElementById("modalDriveDetail")?.classList.add("hidden");
  const previewImage = document.getElementById("driveImagePreview");
  previewImage?.removeAttribute("src");
  previewImage?.classList.add("hidden");
  document.getElementById("driveImagePreviewPanel")?.classList.add("hidden");
  if (window.appState.drivePreviewUrl) {
    URL.revokeObjectURL(window.appState.drivePreviewUrl);
    window.appState.drivePreviewUrl = null;
  }
};

window.openEditDriveFile = function (fileId) {
  const file = window.appState.dokumen.find((item) => item.id === fileId);
  if (!file) return;
  document.getElementById("driveEditFileId").value = file.id;
  document.getElementById("driveEditName").value = file.name || "";
  document.getElementById("driveEditCategory").value = getDriveCategory(file);
  document.getElementById("modalEditDriveFile").classList.remove("hidden");
};

window.closeEditDriveFile = function () {
  document.getElementById("modalEditDriveFile")?.classList.add("hidden");
};

window.saveDriveFileChanges = async function (event) {
  event.preventDefault();
  const fileId = document.getElementById("driveEditFileId").value;
  const file = window.appState.dokumen.find((item) => item.id === fileId);
  const button = event.submitter;
  if (!file) return;
  setButtonLoading(button, true, "Menyimpan...");
  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,createdTime,modifiedTime,webViewLink,description,owners(displayName,emailAddress)`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${window.appState.driveAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: document.getElementById("driveEditName").value.trim(),
          description: `Dokumen MBG - ${document.getElementById("driveEditCategory").value.trim()}`,
        }),
      },
    );
    const updatedFile = await response.json();
    if (!response.ok)
      throw new Error(
        updatedFile.error?.message || "Gagal mengubah file di Drive.",
      );
    await loadDriveFiles();
    closeEditDriveFile();
    showToast("Detail file berhasil diperbarui", "success");
  } catch (error) {
    showDriveApiError(error);
  } finally {
    setButtonLoading(button, false);
  }
};

window.promptDeleteDriveFile = function (fileId) {
  const file = window.appState.dokumen.find((item) => item.id === fileId);
  if (!file) return;
  window.appState.pendingDriveDelete = fileId;
  document.getElementById("driveDeleteConfirmText").textContent =
    `"${file.name}" akan dipindahkan ke Sampah dan dapat dipulihkan dari Google Drive.`;
  document.getElementById("modalConfirmDriveDelete").classList.remove("hidden");
};

window.closeDriveDeleteConfirm = function () {
  window.appState.pendingDriveDelete = null;
  document.getElementById("modalConfirmDriveDelete")?.classList.add("hidden");
};

window.deleteDriveFile = async function (event) {
  const fileId = window.appState.pendingDriveDelete;
  if (!fileId) return;
  const button = event.currentTarget;
  setButtonLoading(button, true, "Menghapus...");
  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${window.appState.driveAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trashed: true }),
      },
    );
    if (!response.ok && response.status !== 204) {
      const result = await response.json().catch(() => ({}));
      throw new Error(
        result.error?.message || "Gagal menghapus file dari Drive.",
      );
    }
    closeDriveDeleteConfirm();
    await Promise.all([
      loadDriveFiles(),
      loadDriveQuota(window.appState.driveAccessToken),
    ]);
    showToast("File dipindahkan ke Sampah Google Drive", "success");
  } catch (error) {
    showDriveApiError(error);
  } finally {
    setButtonLoading(button, false);
  }
};

window.handleDriveFileAction = function (action, fileId) {
  if (action === "edit") window.openEditDriveFile(fileId);
  if (action === "delete") window.promptDeleteDriveFile(fileId);
};

window.handleUploadDokumen = function () {
  const form = document.getElementById("formUploadDokumen");
  if (!form) return;
  form.reset();
  document.getElementById("modalUploadDokumen").classList.remove("hidden");
};

window.closeModalUploadDokumen = function () {
  document.getElementById("modalUploadDokumen")?.classList.add("hidden");
};

window.submitUploadDokumen = async function (event) {
  event.preventDefault();
  const file = document.getElementById("inputFileDokumen")?.files?.[0];
  if (!file) {
    showToast("Pilih file yang akan diunggah", "error");
    return;
  }

  const submitButton = event.submitter;
  setButtonLoading(submitButton, true, "Mengunggah...");
  try {
    const accessToken =
      window.appState.driveAccessToken || (await authorizeGoogleDrive());
    const metadata = {
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      description: `Dokumen MBG - ${document.getElementById("inputKategoriDokumen").value}`,
    };
    const initiate = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink,createdTime",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": metadata.mimeType,
          "X-Upload-Content-Length": String(file.size),
        },
        body: JSON.stringify(metadata),
      },
    );
    if (!initiate.ok) {
      const error = await initiate.json().catch(() => ({}));
      if (initiate.status === 401) clearDriveToken();
      throw new Error(
        error.error?.message ||
          "Gagal memulai upload. Pastikan Google Drive API aktif di Google Cloud.",
      );
    }

    const uploadUrl = initiate.headers.get("Location");
    if (!uploadUrl)
      throw new Error("Google Drive tidak mengembalikan alamat upload.");
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": metadata.mimeType },
      body: file,
    });
    const driveFile = await uploadResponse.json().catch(() => ({}));
    if (uploadResponse.status === 401) clearDriveToken();
    if (!uploadResponse.ok)
      throw new Error(
        driveFile.error?.message || "Upload ke Google Drive gagal.",
      );

    window.appState.drivePage = 1;
    await loadDriveFiles(accessToken);
    try {
      await loadDriveQuota(accessToken);
    } catch (error) {
      console.warn("Google Drive quota refresh failed:", error);
    }
    showToast("Dokumen berhasil diunggah ke Google Drive", "success");
    closeModalUploadDokumen();
  } catch (error) {
    showDriveApiError(error);
  } finally {
    setButtonLoading(submitButton, false);
  }
};

function setupFirestoreListeners() {
  window.appState.barangLoaded = false;
  window.appState.inventoryLoaded = false;
  window.appState.suppliersLoaded = false;
  window.appState.pmsLoaded = false;
  window.appState.pmDailyHistoryLoaded = false;
  window.appState.menusLoaded = false;
  window.appState.limbahLoaded = false;
  window.appState.sppLettersLoaded = false;
  renderMasterBarangTable();
  renderBarangTable();
  renderSupplierTable();
  renderPMCards();
  renderMenuTable();
  renderLimbahTable();
  renderAdminPwaDashboard();
  renderAdminPwaStock();
  renderSppLetters();
  if (isMasterBarangPage() || document.getElementById("formBarang")) {
    window.appState.masterBarangLoaded = false;
    window.appState.masterBarangError = "";
    onSnapshot(
      collection(db, "master_items"),
      (snapshot) => {
        window.appState.masterBarang = snapshot.docs.map((itemDoc) => ({
          id: itemDoc.id,
          ...itemDoc.data(),
        }));
        window.appState.masterBarangLoaded = true;
        window.appState.masterBarangError = "";
        renderMasterBarangTable();
        window.refreshMasterBarangOptions?.();
      },
      (error) => {
        console.warn("Master barang listener warning:", error);
        window.appState.masterBarang = [];
        window.appState.masterBarangLoaded = true;
        window.appState.masterBarangError =
          error.code === "permission-denied"
            ? "Akses ditolak. Publikasikan Firestore Rules untuk koleksi master_items."
            : "Master barang gagal dimuat. Periksa koneksi lalu muat ulang halaman.";
        renderMasterBarangTable();
        window.refreshMasterBarangOptions?.();
      },
    );
  }
  onSnapshot(
    doc(db, "app_settings", "organization"),
    async (snapshot) => {
      if (snapshot.exists()) {
        const settings = snapshot.data();
        window.appState.kitchenSettings = settings;
        try {
          localStorage.setItem("mbgKitchenSettings", JSON.stringify(settings));
        } catch {}
        window.dispatchEvent(new Event("mbg-kitchen-settings-updated"));
        return;
      }

      // Migrate existing per-device settings once if the shared document does not exist yet.
      try {
        const cached = JSON.parse(
          localStorage.getItem("mbgKitchenSettings") || "{}",
        );
        const hasSavedValues = Object.entries(cached).some(
          ([key, value]) =>
            key !== "updatedAt" &&
            key !== "updatedBy" &&
            Boolean(String(value || "").trim()),
        );
        if (hasSavedValues) {
          await setDoc(
            doc(db, "app_settings", "organization"),
            {
              ...cached,
              updatedAt: new Date().toISOString(),
              updatedBy: normalizeAccountEmail(window.appState.user?.email),
            },
            { merge: true },
          );
        } else {
          window.appState.kitchenSettings = {};
          window.dispatchEvent(new Event("mbg-kitchen-settings-updated"));
        }
      } catch (error) {
        console.warn("Kitchen settings migration warning:", error);
        window.appState.kitchenSettings = null;
        window.dispatchEvent(new Event("mbg-kitchen-settings-updated"));
      }
    },
    (error) => {
      console.warn("Kitchen settings listener warning:", error);
      window.appState.kitchenSettings = null;
      window.dispatchEvent(new Event("mbg-kitchen-settings-updated"));
    },
  );
  onSnapshot(
    collection(db, "mbg_items"),
    (snapshot) => {
      const items = [];
      snapshot.forEach((itemDoc) => {
        if (legacyDummyBarangIds.has(itemDoc.id)) {
          deleteDoc(itemDoc.ref).catch(() => {});
          return;
        }
        items.push({ id: itemDoc.id, ...itemDoc.data() });
      });
      window.appState.barang = items;
      window.appState.barangLoaded = true;
      ensureInventorySeededFromPlanningItems(items);
      window.refreshSppDatabaseOptions?.();
      renderBarangTable();
      renderStockTable();
      renderAdminArrivalPage();
      renderAdminPwaDashboard();
      renderAdminPwaStock();
      updateDashboardMetrics();
    },
    (err) => {
      console.warn("Firestore listener warning:", err);
      window.appState.barang = [];
      window.appState.barangLoaded = true;
      window.refreshSppDatabaseOptions?.();
      renderBarangTable();
      renderStockTable();
      renderAdminArrivalPage();
      renderAdminPwaDashboard();
      renderAdminPwaStock();
      updateDashboardMetrics();
    },
  );

  if (
    isOperationalPage() ||
    document.getElementById("adminArrivalList") ||
    document.getElementById("sppSupplierRows")
  ) {
    window.appState.barangOperasionalLoaded = false;
    window.appState.barangOperasionalError = "";
    onSnapshot(
      collection(db, "operational_items"),
      (snapshot) => {
        window.appState.barangOperasional = snapshot.docs.map((itemDoc) => ({
          id: itemDoc.id,
          ...itemDoc.data(),
        }));
        window.appState.barangOperasionalLoaded = true;
        window.appState.barangOperasionalError = "";
        renderBarangTable();
        renderAdminArrivalPage();
        window.refreshSppDatabaseOptions?.();
        const sppFormModal = document.getElementById("sppFormModal");
        if (sppFormModal && !sppFormModal.classList.contains("hidden"))
          window.loadSppDatabaseProductPhotos?.();
      },
      (error) => {
        console.warn("Operational items listener warning:", error);
        window.appState.barangOperasional = [];
        window.appState.barangOperasionalLoaded = true;
        window.appState.barangOperasionalError =
          error.code === "permission-denied"
            ? "Akses ditolak. Pastikan aturan Firestore operational_items sudah dipublikasikan dan akun Anda aktif."
            : "Data operasional gagal dimuat. Periksa koneksi lalu muat ulang halaman.";
        renderBarangTable();
        renderAdminArrivalPage();
        window.refreshSppDatabaseOptions?.();
      },
    );
  }

  onSnapshot(
    collection(db, "suppliers"),
    (snapshot) => {
      const items = [];
      snapshot.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
      window.appState.suppliers = items;
      window.appState.suppliersLoaded = true;
      window.refreshSppDatabaseOptions?.();
      renderSupplierTable();
      updateDashboardMetrics();
    },
    (err) => {
      console.warn("Supplier Firestore listener warning:", err);
      window.appState.suppliers = [];
      window.appState.suppliersLoaded = true;
      window.refreshSppDatabaseOptions?.();
      renderSupplierTable();
      updateDashboardMetrics();
    },
  );

  onSnapshot(
    collection(db, "inventory_items"),
    (snapshot) => {
      window.appState.inventoryItems = snapshot.docs.map((itemDoc) => ({
        id: itemDoc.id,
        ...itemDoc.data(),
      }));
      window.appState.inventoryLoaded = true;
      renderStockTable();
      renderAdminPwaStock();
      renderAdminPwaDashboard();
    },
    (error) => {
      console.warn("Inventory listener warning:", error);
      window.appState.inventoryItems = [];
      window.appState.inventoryLoaded = true;
      renderStockTable();
      renderAdminPwaStock();
      renderAdminPwaDashboard();
    },
  );

  onSnapshot(
    collection(db, "menus"),
    (snapshot) => {
      window.appState.menus = snapshot.docs.map((menuDoc) => ({
        id: menuDoc.id,
        ...menuDoc.data(),
      }));
      window.appState.menusLoaded = true;
      renderMenuTable();
    },
    (err) => {
      console.warn("Menu Firestore listener warning:", err);
      window.appState.menus = [];
      window.appState.menusLoaded = true;
      renderMenuTable();
      showToast("Data menu gagal dimuat dari Firebase", "error");
    },
  );

  onSnapshot(
    collection(db, "limbah"),
    (snapshot) => {
      window.appState.limbah = snapshot.docs.map((limbahDoc) => ({
        id: limbahDoc.id,
        ...limbahDoc.data(),
      }));
      window.appState.limbahLoaded = true;
      renderLimbahTable();
    },
    (error) => {
      console.warn("Limbah Firestore listener warning:", error);
      window.appState.limbah = [];
      window.appState.limbahLoaded = true;
      renderLimbahTable();
      showToast("Data limbah gagal dimuat dari Firebase", "error");
    },
  );

  onSnapshot(
    collection(db, "payment_letters"),
    (snapshot) => {
      window.appState.sppLetters = snapshot.docs.map((letterDoc) => ({
        id: letterDoc.id,
        ...letterDoc.data(),
      }));
      window.appState.sppLettersLoaded = true;
      renderSppLetters();
    },
    (error) => {
      console.warn("Payment letter Firestore listener warning:", error);
      window.appState.sppLetters = [];
      window.appState.sppLettersLoaded = true;
      renderSppLetters(error);
    },
  );

  onSnapshot(
    collection(db, "pms"),
    (snapshot) => {
      const items = [];
      snapshot.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
      window.appState.pms = items;
      window.appState.pmsLoaded = true;
      renderPMCards();
      updateDashboardMetrics();
    },
    () => {
      window.appState.pms = [];
      window.appState.pmsLoaded = true;
      renderPMCards();
      updateDashboardMetrics();
    },
  );

  onSnapshot(
    collection(db, "pm_daily_history"),
    (snapshot) => {
      window.appState.pmDailyHistory = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));
      window.appState.pmDailyHistoryLoaded = true;
      renderPMHistory();
    },
    (error) => {
      console.warn("PM daily history listener warning:", error);
      window.appState.pmDailyHistory = [];
      window.appState.pmDailyHistoryLoaded = true;
      renderPMHistory(error);
    },
  );
}

async function ensureInventorySeededFromPlanningItems(items) {
  const migrationRef = doc(db, "app_metadata", "inventory_seed_v1");
  try {
    const migration = await getDoc(migrationRef);
    if (migration.exists()) return;
    const groupedItems = new Map();
    items
      .filter(
        (item) =>
          Number(item.datang || 0) > 0 ||
          (Array.isArray(item.stockHistory) && item.stockHistory.length > 0),
      )
      .forEach((item) => {
        const key = `${String(item.nama || item.name || "Barang")
          .trim()
          .toLocaleLowerCase("id-ID")}::${String(item.satuan || "unit")
          .trim()
          .toLocaleLowerCase("id-ID")}`;
        groupedItems.set(key, [...(groupedItems.get(key) || []), item]);
      });
    for (const group of groupedItems.values()) {
      const first = group[0];
      const inventoryId = getInventoryDocumentId(
        first.nama || first.name || "Barang",
        first.satuan || "unit",
      );
      const inventoryRef = doc(db, "inventory_items", inventoryId);
      const existing = await getDoc(inventoryRef);
      if (existing.exists()) continue;
      const sourceEvents = group
        .flatMap((item) => {
          const history = Array.isArray(item.stockHistory)
            ? [...item.stockHistory]
            : [];
          if (!history.length) return [];
          history.sort((a, b) =>
            String(a.createdAt || a.date || "").localeCompare(
              String(b.createdAt || b.date || ""),
            ),
          );
          const firstEntry = history[0];
          const inferredOpening =
            firstEntry.stockBefore != null
              ? Number(firstEntry.stockBefore)
              : firstEntry.type === "masuk"
                ? Number(firstEntry.stockAfter || 0) -
                  Number(firstEntry.quantity || 0)
                : firstEntry.type === "keluar"
                  ? Number(firstEntry.stockAfter || 0) +
                    Number(firstEntry.quantity || 0)
                  : Number(firstEntry.stockAfter || 0) -
                    Number(firstEntry.difference || 0);
          return history.map((entry, index) => ({
            ...entry,
            _sourceOpening: index === 0 ? inferredOpening : 0,
          }));
        })
        .sort((a, b) =>
          String(a.createdAt || a.date || "").localeCompare(
            String(b.createdAt || b.date || ""),
          ),
        );
      let balance =
        group.reduce(
          (sum, item) =>
            sum +
            (Array.isArray(item.stockHistory) && item.stockHistory.length
              ? 0
              : Number(item.datang || 0)),
          0,
        ) +
        sourceEvents.reduce(
          (sum, entry) => sum + Number(entry._sourceOpening || 0),
          0,
        );
      const stockHistory = [];
      for (const sourceEvent of sourceEvents) {
        const { _sourceOpening, ...entry } = sourceEvent;
        const before = balance;
        const delta =
          entry.type === "masuk"
            ? Number(entry.quantity || 0)
            : entry.type === "keluar"
              ? -Number(entry.quantity || 0)
              : Number(entry.difference || 0);
        balance += delta;
        stockHistory.push({
          ...entry,
          stockBefore: before,
          stockAfter: balance,
          ...(entry.type === "opname" ? { physicalStock: balance } : {}),
        });
      }
      const currentBalance = group.reduce(
        (sum, item) => sum + Number(item.datang || 0),
        0,
      );
      if (!stockHistory.length && currentBalance > 0) {
        const date = getLocalDateString();
        stockHistory.push({
          type: "masuk",
          quantity: currentBalance,
          stockBefore: 0,
          stockAfter: currentBalance,
          date,
          note: "Saldo awal hasil pemisahan stok",
          createdAt: new Date().toISOString(),
        });
      } else if (Math.abs(balance - currentBalance) > 0.000001) {
        const difference = currentBalance - balance;
        const date = getLocalDateString();
        stockHistory.push({
          type: "opname",
          quantity: Math.abs(difference),
          difference,
          physicalStock: currentBalance,
          stockBefore: balance,
          stockAfter: currentBalance,
          date,
          note: "Penyesuaian saldo saat pemisahan data stok",
          createdAt: new Date().toISOString(),
        });
      }
      await setDoc(inventoryRef, {
        nama: first.nama || first.name || "Barang",
        tipe: first.tipe || "Umum",
        satuan: first.satuan || "unit",
        datang: currentBalance,
        stockHistory,
        sourcePlanningItemIds: group.map((item) => String(item.id)),
      });
    }
    await setDoc(migrationRef, {
      complete: true,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn("Initial stock catalog copy failed:", error);
  }
}

auth.onAuthStateChanged((user) => {
  const validationId = ++authValidationVersion;
  if (!user) {
    accountMonitorUnsubscribe?.();
    accountMonitorUnsubscribe = null;
    window.appState.user = null;
    window.appState.access = null;
    window.appState.driveAccessToken = null;
    window.appState.driveLoaded = false;
    renderAuthHeader();
    renderGoogleDriveInfo();
    renderAdminArrivalPage();
    renderAccessGate({ denied: accessDeniedNotice });
    accessDeniedNotice = false;
    updateRoleNavigation();
    return;
  }

  window.appState.user = null;
  window.appState.access = null;
  renderAccessGate({ checking: true });
  getAccountAccess(user.email)
    .then(async (access) => {
      if (validationId !== authValidationVersion) return;
      if (
        !access ||
        access.active !== true ||
        ![USER_ROLES.SUPER_ADMIN, USER_ROLES.LOGISTICS].includes(access.role)
      ) {
        clearDriveToken();
        window.appState.access = null;
        accessDeniedNotice = true;
        showToast(
          "Akun Google ini belum terdaftar atau sedang dinonaktifkan",
          "error",
        );
        renderAccessGate({ denied: true });
        await signOut(auth);
        return;
      }
      window.appState.user = user;
      window.appState.access = access;
      accountMonitorUnsubscribe?.();
      accountMonitorUnsubscribe =
        normalizeAccountEmail(user.email) === DESIGNATED_SUPER_ADMIN_EMAIL
          ? null
          : onSnapshot(
              doc(db, "app_users", normalizeAccountEmail(user.email)),
              async (accountDoc) => {
                if (
                  !accountDoc.exists() ||
                  accountDoc.data().active !== true ||
                  ![USER_ROLES.SUPER_ADMIN, USER_ROLES.LOGISTICS].includes(
                    accountDoc.data().role,
                  )
                ) {
                  accessDeniedNotice = true;
                  clearDriveToken();
                  showToast("Akses akun Anda telah dicabut", "error");
                  await signOut(auth);
                  return;
                }
                window.appState.access = {
                  email: normalizeAccountEmail(user.email),
                  ...accountDoc.data(),
                };
                updateRoleNavigation();
                if (!canUseCurrentPage(window.appState.access.role))
                  renderAccessGate({
                    restricted: true,
                    premiumRequired: window.appState.access?.plan !== "premium",
                  });
              },
              async (error) => {
                console.error("Pemantauan akses akun gagal:", error);
                accessDeniedNotice = true;
                await signOut(auth);
              },
            );
      renderAuthHeader();
      if (!canUseCurrentPage(access.role)) {
        updateRoleNavigation();
        renderAccessGate({
          restricted: true,
          premiumRequired: window.appState.access?.plan !== "premium",
        });
        return;
      }
      hideAccessGate();
      updateRoleNavigation();
      if (!firestoreListenersStarted) {
        firestoreListenersStarted = true;
        setupFirestoreListeners();
      }
      if (isSuperAdmin() && document.getElementById("usersTableBody"))
        setupUsersListener();
      window.appState.driveAccessToken = readDriveToken(user.uid);
      if (document.getElementById("driveStorageStatus")) {
        if (window.appState.driveAccessToken) {
          refreshDriveConnection(window.appState.driveAccessToken).catch(
            showDriveApiError,
          );
        } else {
          window.appState.dokumen = [];
          window.appState.driveLoaded = false;
          renderDriveQuota();
          renderDokumenTable();
        }
      } else {
        window.appState.dokumen = [];
        renderDriveQuota();
        renderDokumenTable();
      }
      renderGoogleDriveInfo();
      renderAdminArrivalPage();
    })
    .catch(async (error) => {
      if (validationId !== authValidationVersion) return;
      console.error("Gagal memeriksa akses akun:", error);
      accessDeniedNotice = true;
      renderAccessGate({ denied: true });
      showToast(
        "Akses akun gagal diperiksa. Pastikan Firebase Firestore Rules sudah diterapkan.",
        "error",
      );
      await signOut(auth);
    });
});

window.handleLoginClick = async function () {
  try {
    setDriveLoadingState(true, "Menyambungkan akun Google dan Drive...");
    const currentUser = auth.currentUser;
    const result = currentUser
      ? await reauthenticateWithPopup(currentUser, googleProvider)
      : await signInWithPopup(auth, googleProvider);
    const accountAccess = await getAccountAccess(result.user.email);
    if (
      !accountAccess ||
      accountAccess.active !== true ||
      ![USER_ROLES.SUPER_ADMIN, USER_ROLES.LOGISTICS].includes(
        accountAccess.role,
      )
    ) {
      clearDriveToken();
      accessDeniedNotice = true;
      await signOut(auth);
      renderAccessGate({ denied: true });
      showToast("Akun ini belum mendapat akses. Hubungi Super Admin.", "error");
      return;
    }
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      saveDriveToken(credential.accessToken, result.user.uid);
      saveDrivePermission(result.user.uid);
      renderAuthHeader();
      renderGoogleDriveInfo();
      if (document.getElementById("driveStorageStatus")) {
        refreshDriveConnection(credential.accessToken).catch(showDriveApiError);
      } else {
        window.appState.driveLoaded = true;
      }
      showToast(
        currentUser
          ? "Google Drive tersambung kembali. Login web tetap aktif."
          : "Login web dan Google Drive berhasil disambungkan",
        "success",
      );
    } else {
      showToast(
        "Login berhasil, tetapi Google belum memberikan izin Drive. Login Google sekali lagi dan setujui akses Drive.",
        "error",
      );
    }
  } catch (err) {
    window.appState.driveLoaded = false;
    renderDokumenTable();
    showDriveApiError(err);
  }
};

window.handleLogoutClick = async function () {
  await signOut(auth);
  clearDriveToken();
  showToast("Anda telah keluar dari akun", "info");
};

function renderAuthHeader() {
  const container = document.getElementById("authContainer");
  if (!container) return;
  const user = window.appState.user;

  if (user) {
    container.innerHTML = `
      <div class="flex items-center gap-3">
        <img src="${user.photoURL || "https://placehold.co/100x100/0284c7/fff?text=U"}" class="w-8 h-8 rounded-full border-2 border-sky-500 shadow-sm">
        <div class="hidden sm:block text-left text-xs">
          <p class="font-bold text-slate-800 leading-tight">${user.displayName || "Pengguna"}</p>
          <p class="text-[10px] text-slate-400">${user.email || ""}</p>
          <p class="text-[10px] font-semibold text-sky-700">${window.appState.access?.role === USER_ROLES.SUPER_ADMIN ? "Super Admin" : "Admin Logistik"}</p>
        </div>
        <button onclick="handleLogoutClick()" class="p-2 text-slate-400 hover:text-red-600 rounded-xl transition-colors">
          <i class="fa-solid fa-right-from-bracket"></i>
        </button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <button onclick="handleLoginClick()" class="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-medium text-xs rounded-xl shadow-md transition-all">
        <i class="fa-brands fa-google text-xs"></i>
        <span>Login Google</span>
      </button>
    `;
  }
}

function renderFirebaseInfo() {
  const container = document.getElementById("firebaseInfoGrid");
  if (!container) return;

  container.innerHTML = Object.entries(window.firebaseConfigInfo || {})
    .map(
      ([key, value]) => `
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <p class="text-[10px] uppercase tracking-wider font-bold text-slate-400">${key}</p>
          <p class="mt-1 text-xs font-semibold text-slate-700 break-all">${value || "-"}</p>
        </div>
      `,
    )
    .join("");
}

function renderGoogleDriveInfo() {
  const container = document.getElementById("googleDriveInfoGrid");
  if (!container) return;

  const quota = window.appState.driveQuota || {};
  const values = {
    "Status koneksi": window.appState.driveAccessToken
      ? "Terhubung"
      : window.appState.user
        ? "Login web aktif Â· sesi Google Drive perlu disambungkan"
        : "Belum login Google",
    "Akun Google":
      window.appState.user?.email || "Login Google untuk melihat akun",
    Layanan: "Google Drive API v3",
    "OAuth scope": "https://www.googleapis.com/auth/drive",
    "Pemakaian penyimpanan": quota.usage
      ? `${formatFileSize(quota.usage)}${quota.limit ? ` dari ${formatFileSize(quota.limit)}` : ""}`
      : "Login Google untuk memuat informasi kapasitas",
  };

  container.innerHTML = Object.entries(values)
    .map(
      ([key, value]) => `
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <p class="text-[10px] uppercase tracking-wider font-bold text-slate-400">${escapeHtml(key)}</p>
          <p class="mt-1 text-xs font-semibold text-slate-700 break-all">${escapeHtml(value)}</p>
        </div>
      `,
    )
    .join("");
}

function updateDashboardMetrics() {
  const totalBarangElement = document.getElementById("statTotalBarang");
  if (!totalBarangElement) return;

  const isDashboardLoaded =
    window.appState.barangLoaded &&
    window.appState.suppliersLoaded &&
    window.appState.pmsLoaded;
  if (!isDashboardLoaded) {
    [
      "statTotalBarang",
      "statTotalSupplier",
      "statTotalPM",
      "statInsentifMitra",
      "statTotalDokumen",
      "adminApprovedBadge",
      "superAdminApprovedBadge",
    ].forEach((id) => {
      const element = document.getElementById(id);
      if (element)
        element.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin text-base text-sky-500" aria-label="Memuat"></i>';
    });
    const chartLoading = document.getElementById("dashboardLoadingState");
    chartLoading?.classList.remove("hidden");
    return;
  }
  document.getElementById("dashboardLoadingState")?.classList.add("hidden");
  document.getElementById("dashboardPaguLoading")?.classList.add("hidden");

  document.getElementById("statTotalBarang").innerText =
    window.appState.barang.length;
  document.getElementById("statTotalSupplier").innerText =
    window.appState.suppliers.length;
  const totalPenerimaManfaat = window.appState.pms
    .filter((pm) => (pm.status || "Aktif") === "Aktif")
    .reduce((total, pm) => total + getPMTotal(pm), 0);
  document.getElementById("statTotalPM").innerText =
    totalPenerimaManfaat.toLocaleString("id-ID");
  document.getElementById("statInsentifMitra").innerText =
    `Insentif Mitra: Rp ${(totalPenerimaManfaat * 2000).toLocaleString("id-ID")}`;
  document.getElementById("statTotalDokumen").innerText =
    window.appState.dokumen.length;

  const totalBarang = window.appState.barang.length || 1;
  const adminAcc = window.appState.barang.filter(
    (i) => i.statusAdmin === "ACC",
  ).length;
  const superAcc = window.appState.barang.filter(
    (i) => i.statusSuperAdmin === "ACC",
  ).length;

  document.getElementById("adminApprovedBadge").innerText =
    `${Math.round((adminAcc / totalBarang) * 100)}%`;
  document.getElementById("superAdminApprovedBadge").innerText =
    `${Math.round((superAcc / totalBarang) * 100)}%`;

  renderCharts();
  renderPaguDashboard();
}

window.renderPaguDashboard = function () {
  const canvas = document.getElementById("dashboardPaguChart");
  const summary = document.getElementById("dashboardPaguSummary");
  if (!canvas || !summary) return;
  if (!window.appState.pmsLoaded) {
    document.getElementById("dashboardPaguLoading")?.classList.remove("hidden");
    return;
  }
  document.getElementById("dashboardPaguLoading")?.classList.add("hidden");
  const yearSelect = document.getElementById("dashboardPaguYear");
  const availableYears = [
    ...new Set(
      window.appState.pms
        .filter((pm) => (pm.status || "Aktif") === "Aktif")
        .map((pm) =>
          String(pm.tanggal || pm.createdAt || new Date().toISOString()).slice(
            0,
            4,
          ),
        )
        .filter((year) => /^\d{4}$/.test(year)),
    ),
  ].sort();
  const currentYear = String(new Date().getFullYear());
  if (yearSelect) {
    const selectedYear = yearSelect.value || currentYear;
    const years = [...new Set([...availableYears, currentYear])].sort();
    yearSelect.innerHTML = years
      .map((year) => `<option value="${year}">${year}</option>`)
      .join("");
    yearSelect.value = years.includes(selectedYear)
      ? selectedYear
      : currentYear;
  }
  const selectedYear = yearSelect?.value || currentYear;
  const monthly = Array.from({ length: 12 }, () => ({ big: 0, small: 0 }));
  window.appState.pms
    .filter((pm) => (pm.status || "Aktif") === "Aktif")
    .forEach((pm) => {
      const rawDate = String(pm.tanggal || pm.createdAt || "");
      if (rawDate.slice(0, 4) !== selectedYear) return;
      const month = Number(rawDate.slice(5, 7)) - 1;
      if (month < 0 || month > 11) return;
      if (pm.jenis === "SD") {
        monthly[month].big +=
          Number(pm.kelas46 || 0) + Number(pm.guruTendik || 0);
        monthly[month].small += Number(pm.kelas13 || 0);
      } else if (pm.jenis === "B3") {
        monthly[month].big += Number(pm.bumil || 0) + Number(pm.busui || 0);
        monthly[month].small += Number(pm.balita || 0);
      } else if (["SMP", "SMA"].includes(pm.jenis)) {
        monthly[month].big +=
          Number(pm.target || 0) + Number(pm.guruTendik || 0);
      } else if (pm.jenis === "TK") {
        monthly[month].big += Number(pm.guruTendik || 0);
        monthly[month].small += Number(pm.target || 0);
      }
    });
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Mei",
    "Jun",
    "Jul",
    "Agu",
    "Sep",
    "Okt",
    "Nov",
    "Des",
  ];
  const totalBig = monthly.reduce((sum, row) => sum + row.big, 0);
  const totalSmall = monthly.reduce((sum, row) => sum + row.small, 0);
  const totalPagu = totalBig * 10000 + totalSmall * 8000;
  summary.innerHTML = `<div class="rounded-xl bg-emerald-50 p-4"><p class="text-[10px] font-bold uppercase text-emerald-700">Porsi Besar</p><p class="mt-1 text-xl font-extrabold text-emerald-800">${totalBig.toLocaleString("id-ID")}</p></div><div class="rounded-xl bg-sky-50 p-4"><p class="text-[10px] font-bold uppercase text-sky-700">Porsi Kecil</p><p class="mt-1 text-xl font-extrabold text-sky-800">${totalSmall.toLocaleString("id-ID")}</p></div><div class="rounded-xl bg-amber-50 p-4"><p class="text-[10px] font-bold uppercase text-amber-700">Total Pagu</p><p class="mt-1 text-lg font-extrabold text-amber-800">Rp ${totalPagu.toLocaleString("id-ID")}</p><p class="mt-1 text-[10px] text-amber-700">Besar Rp10.000 Â· Kecil Rp8.000</p></div>`;
  if (typeof Chart === "undefined") return;
  if (window.appState.dashboardPaguChart)
    window.appState.dashboardPaguChart.destroy();
  window.appState.dashboardPaguChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: months,
      datasets: [
        {
          label: "Porsi besar",
          data: monthly.map((row) => row.big),
          backgroundColor: "#10b981",
          borderRadius: 5,
          yAxisID: "y",
        },
        {
          label: "Porsi kecil",
          data: monthly.map((row) => row.small),
          backgroundColor: "#38bdf8",
          borderRadius: 5,
          yAxisID: "y",
        },
        {
          label: "Pagu (juta rupiah)",
          data: monthly.map(
            (row) => (row.big * 10000 + row.small * 8000) / 1000000,
          ),
          type: "line",
          borderColor: "#f59e0b",
          backgroundColor: "#f59e0b",
          tension: 0.3,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: "Jumlah porsi" },
        },
        y1: {
          beginAtZero: true,
          position: "right",
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Pagu (juta Rp)" },
        },
      },
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (context) =>
              context.datasetIndex === 2
                ? `${context.dataset.label}: Rp ${(Number(context.raw) * 1000000).toLocaleString("id-ID")}`
                : `${context.dataset.label}: ${Number(context.raw).toLocaleString("id-ID")}`,
          },
        },
      },
    },
  });
};

function renderCharts() {
  const ctx1 = document.getElementById("dashboardChart")?.getContext("2d");
  if (ctx1) {
    if (window.appState.dashboardChart)
      window.appState.dashboardChart.destroy();

    const labels = window.appState.barang.map((b) =>
      (b.nama || b.name || "").substring(0, 10),
    );
    const kebutuhanData = window.appState.barang.map((b) => b.kebutuhan || 0);
    const datangData = window.appState.barang.map(getItemReceivedQuantity);

    window.appState.dashboardChart = new Chart(ctx1, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Target Kebutuhan",
            data: kebutuhanData,
            backgroundColor: "#38bdf8",
            borderRadius: 6,
          },
          {
            label: "Realisasi Datang",
            data: datangData,
            backgroundColor: "#10b981",
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
      },
    });
  }

  const ctx2 = document.getElementById("statusDoughnutChart")?.getContext("2d");
  if (ctx2) {
    if (window.appState.statusChart) window.appState.statusChart.destroy();
    const accCount = window.appState.barang.filter(
      (b) => b.statusAdmin === "ACC",
    ).length;
    const pendingCount = window.appState.barang.length - accCount;

    window.appState.statusChart = new Chart(ctx2, {
      type: "doughnut",
      data: {
        labels: ["ACC", "Pending"],
        datasets: [
          {
            data: [accCount, pendingCount],
            backgroundColor: ["#10b981", "#f59e0b"],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
      },
    });
  }
}

window.switchView = function (viewName) {
  document
    .querySelectorAll("main > section")
    .forEach((sec) => sec.classList.add("hidden"));
  const targetSec = document.getElementById(`view-${viewName}`);
  if (targetSec) targetSec.classList.remove("hidden");

  document.querySelectorAll(".nav-item").forEach((nav) => {
    nav.classList.remove(
      "bg-sky-600",
      "text-white",
      "shadow-md",
      "shadow-sky-600/30",
    );
    nav.classList.add("hover:bg-slate-800", "hover:text-white");
  });
  const activeNav = document.getElementById(`nav-${viewName}`);
  if (activeNav) {
    activeNav.classList.add(
      "bg-sky-600",
      "text-white",
      "shadow-md",
      "shadow-sky-600/30",
    );
    activeNav.classList.remove("hover:bg-slate-800");
  }

  const titleMap = {
    dashboard: "Dashboard Program MBG",
    barang: "Kelola Barang Logistik MBG",
    supplier: "Daftar Supplier Mitra",
    pm: "Penerima Manfaat (PM)",
    dokumen: "Dokumen Kelengkapan & LPJ",
  };
  document.getElementById("pageTitle").innerText =
    titleMap[viewName] || "MBG System";
  if (viewName === "pm") setTimeout(renderPMMap, 100);
  toggleSidebar(false);
};

window.toggleSidebar = function (show) {
  const sb = document.getElementById("sidebar");
  const ov = document.getElementById("sidebarOverlay");
  if (show) {
    sb.classList.remove("-translate-x-full");
    ov.classList.remove("hidden");
  } else {
    sb.classList.add("-translate-x-full");
    ov.classList.add("hidden");
  }
};

function renderBarangTable() {
  const tbody = document.getElementById("barangTableBody");
  if (!tbody) return;
  const pagination = document.getElementById("barangPagination");

  const currentItems = getCurrentBarangItems();
  const currentItemsLoaded = isOperationalPage()
    ? window.appState.barangOperasionalLoaded
    : window.appState.barangLoaded;
  const deleteType = isOperationalPage() ? "operasional" : "barang";
  if (!currentItemsLoaded) {
    tbody.innerHTML = `<tr><td colspan="8" class="px-5 py-10 text-center"><span class="inline-flex items-center gap-2 rounded-xl bg-sky-50 px-4 py-3 text-xs font-semibold text-sky-700"><i class="fa-solid fa-spinner fa-spin"></i>Memuat data barang dari Firebase...</span></td></tr>`;
    if (pagination) pagination.innerHTML = "";
    return;
  }
  if (isOperationalPage() && window.appState.barangOperasionalError) {
    tbody.innerHTML = `<tr><td colspan="8" class="px-5 py-8 text-center text-xs font-semibold text-amber-800">${escapeHtml(window.appState.barangOperasionalError)}</td></tr>`;
    if (pagination) pagination.innerHTML = "";
    return;
  }

  const searchTerm = (
    document.getElementById("searchBarang")?.value || ""
  ).toLowerCase();
  const filterTipe =
    document.getElementById("filterTipeBarang")?.value || "ALL";
  const dateFrom =
    document.getElementById("filterTanggalMulaiBarang")?.value || "";
  const dateTo =
    document.getElementById("filterTanggalAkhirBarang")?.value || "";
  const filterKey = `${isOperationalPage() ? "operasional" : "bahan_baku"}|${searchTerm}|${filterTipe}|${dateFrom}|${dateTo}`;
  if (window.appState.barangFilterKey !== filterKey) {
    window.appState.barangFilterKey = filterKey;
    window.appState.barangPage = 1;
  }

  const filtered = currentItems.filter((item) => {
    const name = (item.nama || item.name || "").toLowerCase();
    const matchesSearch = name.includes(searchTerm);
    const matchesTipe = filterTipe === "ALL" || item.tipe === filterTipe;
    const itemDate = String(item.tanggal || "");
    const matchesDate =
      (!dateFrom || itemDate >= dateFrom) && (!dateTo || itemDate <= dateTo);
    return matchesSearch && matchesTipe && matchesDate;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400">Tidak ada data barang ditemukan</td></tr>`;
    if (pagination) pagination.innerHTML = "";
    return;
  }

  const pageSize = Number(window.appState.barangPageSize) || 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  window.appState.barangPage = Math.min(
    pageCount,
    Math.max(1, Number(window.appState.barangPage) || 1),
  );
  const pageStart = (window.appState.barangPage - 1) * pageSize;
  const visibleItems = filtered.slice(pageStart, pageStart + pageSize);
  tbody.innerHTML = visibleItems
    .map((item) => {
      const latestArrival = getLatestArrival(item);
      const firebasePhoto =
        item.statusAdmin === "ACC"
          ? latestArrival?.photoDataUrl ||
            (latestArrival?.photoId
              ? window.appState.arrivalPhotoCache?.[latestArrival.photoId]
              : "") ||
            latestArrival?.photoUrl ||
            item.fotoPenerimaan ||
            item.foto ||
            item.fotoUrl ||
            item.imageUrl ||
            (latestArrival?.photoId ? "" : item.img) ||
            ""
          : "";
      const photo = firebasePhoto
        ? `<img src="${escapeHtml(firebasePhoto)}" alt="Foto ${escapeHtml(item.nama || item.name || "barang")}" loading="lazy" class="w-10 h-10 rounded-xl object-cover border border-slate-200 group-hover:scale-105 transition-transform" onerror="this.outerHTML='<span class=&quot;flex w-10 h-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-400&quot;><i class=&quot;fa-solid fa-box&quot;></i></span>'">`
        : latestArrival?.photoId && item.statusAdmin === "ACC"
          ? `<span data-arrival-photo-id="${escapeHtml(latestArrival.photoId)}" class="flex w-10 h-10 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-600"><i class="fa-solid fa-spinner fa-spin"></i></span>`
          : `<span class="flex w-10 h-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-400"><i class="fa-solid fa-box"></i></span>`;
      return `
        <tr class="hover:bg-slate-50/80 transition-colors">
          <td class="py-3 px-5">
            <div class="flex items-center gap-3 cursor-pointer group" onclick="openDetailBarang('${item.id}')">
              ${photo}
              <div>
                <p class="font-bold text-slate-800 group-hover:text-sky-600 transition-colors">${item.nama || item.name || "-"}</p>
                <p class="text-[10px] text-slate-400">ID: ${item.id}</p>
              </div>
            </div>
          </td>
          <td class="py-3 px-5 font-medium text-slate-600">${item.tanggal || "-"}</td>
          <td class="py-3 px-5 font-bold text-slate-800">${formatRupiah(item.harga)}</td>
          <td class="py-3 px-5 text-center font-medium">
            <span class="text-slate-800 font-bold">${item.kebutuhan || 0} ${item.satuan || ""}</span> / 
            <span class="text-emerald-600 font-bold">${getItemReceivedQuantity(item)} ${item.satuan || ""}</span>
          </td>
          <td class="py-3 px-5 text-center">
            <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${item.tipe === "Utama" ? "bg-sky-100 text-sky-700" : "bg-purple-100 text-purple-700"}">${item.tipe || "Utama"}</span>
          </td>
          <td class="py-3 px-5 text-center">
            <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${item.statusAdmin === "ACC" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}">${item.statusAdmin || "Pending"}</span>
          </td>
          <td class="py-3 px-5 text-center">
            <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${item.statusSuperAdmin === "ACC" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}">${item.statusSuperAdmin || "Pending"}</span>
          </td>
          <td class="py-3 px-5 text-right space-x-1">
            <button onclick="editBarang('${item.id}')" class="p-2 text-sky-600 hover:bg-sky-50 rounded-lg transition-colors" title="Edit Data">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button onclick="promptDelete('${deleteType}', '${item.id}', '${item.nama || item.name}')" class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Hapus Data">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
  if (pagination) {
    const firstItem = pageStart + 1;
    const lastItem = Math.min(pageStart + pageSize, filtered.length);
    pagination.innerHTML = `<div class="text-xs text-slate-500">Menampilkan ${firstItem}-${lastItem} dari ${filtered.length} barang</div><div class="flex items-center gap-2"><label class="flex items-center gap-2 text-xs text-slate-500">Baris<select onchange="changeBarangPageSize(this.value)" class="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"><option value="10" ${pageSize === 10 ? "selected" : ""}>10</option><option value="25" ${pageSize === 25 ? "selected" : ""}>25</option><option value="50" ${pageSize === 50 ? "selected" : ""}>50</option></select></label><button type="button" onclick="changeBarangPage(-1)" ${window.appState.barangPage <= 1 ? "disabled" : ""} aria-label="Halaman sebelumnya" class="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><i class="fa-solid fa-chevron-left"></i></button><span class="min-w-20 text-center text-xs font-semibold text-slate-600">${window.appState.barangPage} / ${pageCount}</span><button type="button" onclick="changeBarangPage(1)" ${window.appState.barangPage >= pageCount ? "disabled" : ""} aria-label="Halaman berikutnya" class="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><i class="fa-solid fa-chevron-right"></i></button></div>`;
  }
  loadLatestArrivalPhotos(visibleItems);
}

window.changeBarangPage = function (direction) {
  window.appState.barangPage = Math.max(
    1,
    (Number(window.appState.barangPage) || 1) + Number(direction),
  );
  renderBarangTable();
};

window.changeBarangPageSize = function (size) {
  window.appState.barangPageSize = Number(size) || 10;
  window.appState.barangPage = 1;
  renderBarangTable();
};

function getLatestArrival(item) {
  const history = Array.isArray(item?.arrivalHistory)
    ? item.arrivalHistory
    : [];
  return (
    [...history].sort((a, b) =>
      String(b.recordedAt || b.receivedAt || "").localeCompare(
        String(a.recordedAt || a.receivedAt || ""),
      ),
    )[0] || null
  );
}

function getItemReceivedQuantity(item) {
  const arrivals = Array.isArray(item?.arrivalHistory)
    ? item.arrivalHistory
    : [];
  return arrivals.length
    ? arrivals.reduce((sum, arrival) => sum + Number(arrival.quantity || 0), 0)
    : Number(item?.datang || 0);
}

function getInventoryDocumentId(name, unit) {
  const normalized = `${String(name || "")
    .trim()
    .toLocaleLowerCase("id-ID")}::${String(unit || "")
    .trim()
    .toLocaleLowerCase("id-ID")}`;
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = Math.imul(hash ^ normalized.charCodeAt(index), 16777619);
  }
  return `stock_${(hash >>> 0).toString(36)}`;
}

function getLowStockInventoryItems(
  items = window.appState.inventoryItems || [],
) {
  return items.filter((item) => {
    const minimum = Number(item.minimumStock || 0);
    return minimum > 0 && Number(item.datang || 0) <= minimum;
  });
}

async function loadLatestArrivalPhotos(items) {
  const photoIds = [
    ...new Set(
      items
        .filter((item) => item.statusAdmin === "ACC")
        .map((item) => getLatestArrival(item)?.photoId)
        .filter(Boolean),
    ),
  ];
  await Promise.all(
    photoIds.map(async (photoId) => {
      try {
        const photoSnapshot = await getDoc(
          doc(db, "barang_arrival_photos", String(photoId)),
        );
        const photoData = photoSnapshot.exists() ? photoSnapshot.data() : null;
        const dataUrl =
          photoData?.dataUrl ||
          photoData?.base64 ||
          photoData?.foto ||
          photoData?.image ||
          "";
        if (!dataUrl) return;
        window.appState.arrivalPhotoCache ||= {};
        window.appState.arrivalPhotoCache[photoId] = dataUrl;
        const parentItem = items.find(
          (item) => getLatestArrival(item)?.photoId === photoId,
        );
        if (parentItem) {
          const legacyImage = parentItem.img;
          const shouldReplaceLegacy = legacyImage && legacyImage !== dataUrl;
          const updatedParent = {
            ...parentItem,
            ...(shouldReplaceLegacy ? { img: dataUrl } : {}),
            ...(!parentItem.fotoPenerimaan ? { fotoPenerimaan: dataUrl } : {}),
            arrivalHistory: parentItem.arrivalHistory.map((arrival) =>
              arrival.photoId === photoId
                ? { ...arrival, photoDataUrl: dataUrl }
                : arrival,
            ),
          };
          window.appState.barang = window.appState.barang.map((item) =>
            String(item.id) === String(parentItem.id) ? updatedParent : item,
          );
          setDoc(
            doc(db, "mbg_items", String(parentItem.id)),
            updatedParent,
          ).catch((error) =>
            console.warn(
              "Could not sync the latest Firebase photo to its item:",
              error,
            ),
          );
        }
        document
          .querySelectorAll(`[data-arrival-photo-id="${CSS.escape(photoId)}"]`)
          .forEach((placeholder) => {
            const image = document.createElement("img");
            image.src = dataUrl;
            image.alt = "Foto bukti penerimaan";
            image.loading = "lazy";
            image.className =
              "h-10 w-10 rounded-xl border border-slate-200 object-cover";
            image.onerror = () => {
              placeholder.innerHTML = '<i class="fa-solid fa-box"></i>';
              placeholder.className =
                "flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-400";
            };
            placeholder.replaceWith(image);
          });
      } catch (error) {
        console.warn("Could not load arrival photo from Firestore:", error);
      }
    }),
  );
}

function getAdminArrivalType() {
  return document.getElementById("adminArrivalType")?.value === "operasional"
    ? "operasional"
    : "bahan_baku";
}

function getAdminArrivalItems(type = getAdminArrivalType()) {
  return type === "operasional"
    ? window.appState.barangOperasional
    : window.appState.barang;
}

window.setAdminArrivalType = function (type) {
  if (!["bahan_baku", "operasional"].includes(type)) return;
  const selectedType = document.getElementById("adminArrivalType");
  if (selectedType) selectedType.value = type;
  const isOperational = type === "operasional";
  [
    [document.getElementById("adminArrivalTypeRaw"), !isOperational],
    [document.getElementById("adminArrivalTypeOperational"), isOperational],
  ].forEach(([button, active]) => {
    if (!button) return;
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("bg-white", active);
    button.classList.toggle("text-sky-800", active);
    button.classList.toggle("shadow-sm", active);
    button.classList.toggle("text-slate-500", !active);
    button.classList.toggle("hover:text-slate-700", !active);
  });
  adminArrivalFilterKey = "";
  adminArrivalVisibleCount = ADMIN_ARRIVAL_PAGE_SIZE;
  renderAdminArrivalPage();
};

function renderAdminArrivalPage() {
  const list = document.getElementById("adminArrivalList");
  if (!list) return;
  const count = document.getElementById("adminArrivalCount");
  const type = getAdminArrivalType();
  const typeLabel = type === "operasional" ? "operasional" : "bahan baku";
  const isLoaded =
    type === "operasional"
      ? window.appState.barangOperasionalLoaded
      : window.appState.barangLoaded;
  if (!isLoaded) {
    if (count) count.textContent = `Memuat daftar ${typeLabel}...`;
    list.innerHTML = `<div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat daftar ${typeLabel}...</div>`;
    return;
  }
  if (type === "operasional" && window.appState.barangOperasionalError) {
    if (count) count.textContent = "Data operasional tidak dapat diakses";
    list.innerHTML = `<div class="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"><p class="font-bold"><i class="fa-solid fa-triangle-exclamation mr-2"></i>Gagal memuat barang operasional</p><p class="mt-2 text-xs leading-relaxed">${escapeHtml(window.appState.barangOperasionalError)}</p></div>`;
    return;
  }

  const dateFilter = document.getElementById("adminArrivalFilterDate");
  if (dateFilter && !dateFilter.value) dateFilter.value = getLocalDateString();
  const selectedDate = dateFilter?.value || getLocalDateString();
  const endDate =
    document.getElementById("adminArrivalFilterDateTo")?.value || selectedDate;
  if (endDate < selectedDate) {
    if (count)
      count.textContent = "Tanggal akhir harus sama atau setelah tanggal awal";
    list.innerHTML = `<div class="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center text-sm font-semibold text-amber-800">Periksa rentang tanggal yang dipilih.</div>`;
    return;
  }
  const pendingItems = getAdminArrivalItems(type).filter(
    (item) =>
      (item.statusAdmin || "Pending") === "Pending" &&
      String(item.tanggal || "") >= selectedDate &&
      String(item.tanggal || "") <= endDate,
  );

  const query = (document.getElementById("adminArrivalSearch")?.value || "")
    .trim()
    .toLocaleLowerCase("id-ID");
  const filterKey = `${type}|${selectedDate}|${endDate}|${query}`;
  if (adminArrivalFilterKey !== filterKey) {
    adminArrivalFilterKey = filterKey;
    adminArrivalVisibleCount = ADMIN_ARRIVAL_PAGE_SIZE;
  }
  const filteredItems = pendingItems.filter((item) =>
    (item.nama || item.name || "").toLocaleLowerCase("id-ID").includes(query),
  );
  adminArrivalObserver?.disconnect();
  if (count)
    count.textContent = `${filteredItems.length.toLocaleString("id-ID")} barang Pending, ${formatDateID(selectedDate)}${endDate !== selectedDate ? ` â€“ ${formatDateID(endDate)}` : ""}`;

  if (!filteredItems.length) {
    list.innerHTML = `<div class="rounded-2xl border border-slate-200 bg-white p-8 text-center"><i class="fa-solid fa-box-open text-2xl text-slate-300"></i><p class="mt-3 text-sm font-semibold text-slate-600">${pendingItems.length ? "Barang tidak ditemukan" : "Tidak ada barang Pending pada rentang tanggal ini"}</p><p class="mt-1 text-xs text-slate-400">Pilih tanggal lain untuk melihat barang Pending.</p></div>`;
    return;
  }

  const visibleItems = filteredItems.slice(0, adminArrivalVisibleCount);
  const cards = visibleItems
    .map((item) => {
      const itemId = escapeHtml(item.id);
      const arrivalHistory = Array.isArray(item.arrivalHistory)
        ? [...item.arrivalHistory].sort((a, b) =>
            String(b.recordedAt || b.receivedAt || "").localeCompare(
              String(a.recordedAt || a.receivedAt || ""),
            ),
          )
        : [];
      const latest = arrivalHistory[0];
      const latestDate = latest?.receivedAt
        ? new Date(latest.receivedAt)
        : null;
      const latestLabel =
        latestDate && !Number.isNaN(latestDate.getTime())
          ? latestDate.toLocaleString("id-ID", {
              dateStyle: "medium",
              timeStyle: "short",
            })
          : "Belum ada penerimaan tercatat";
      const latestDetail = latest
        ? `<p class="mt-1 text-[11px] text-slate-500">Terakhir: ${Number(latest.quantity || 0).toLocaleString("id-ID")} ${escapeHtml(item.satuan || "")} Â· ${escapeHtml(latestLabel)}</p>${latest.photoId ? `<button type="button" onclick="viewAdminArrivalPhoto('${escapeHtml(latest.photoId)}')" class="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700"><i class="fa-regular fa-image"></i>Lihat foto terakhir</button>` : ""}`
        : `<p class="mt-1 text-[11px] text-slate-500">${escapeHtml(latestLabel)}</p>`;
      return `<article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><h3 class="font-bold text-slate-800">${escapeHtml(item.nama || item.name || "Barang")}</h3><span class="rounded-full bg-amber-100 px-2 py-1 text-[9px] font-bold text-amber-700">Pending</span></div><p class="mt-1 text-xs text-slate-500">${escapeHtml(item.tipe || "Utama")} Â· ${escapeHtml(item.satuan || "unit")}</p><p class="mt-3 text-sm font-bold text-slate-700">Total datang: ${getItemReceivedQuantity(item).toLocaleString("id-ID")} ${escapeHtml(item.satuan || "")}</p>${latestDetail}</div><i class="fa-solid fa-boxes-stacked mt-1 text-xl text-sky-600"></i></div><button type="button" onclick="openAdminArrival('${itemId}')" class="mt-4 w-full rounded-xl bg-sky-700 px-4 py-3 text-sm font-bold text-white hover:bg-sky-800"><i class="fa-solid fa-camera mr-2"></i>Catat barang datang</button></article>`;
    })
    .join("");
  const hasMore = visibleItems.length < filteredItems.length;
  list.innerHTML = `${cards}${hasMore ? `<div id="adminArrivalScrollSentinel" class="py-4 text-center text-xs text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Gulir untuk memuat barang berikutnya</div>` : `<p class="py-3 text-center text-[10px] text-slate-400">Semua barang sudah ditampilkan</p>`}`;
  observeAdminArrivalSentinel();
}

window.showAdminPwaTab = function (tab) {
  const panels = {
    dashboard: "adminDashboardPanel",
    arrival: "adminArrivalPanel",
    stock: "adminStockPanel",
    profile: "adminProfilePanel",
  };
  if (!panels[tab]) return;
  const currentTab = Object.keys(panels).find(
    (key) =>
      document
        .getElementById(
          {
            dashboard: "adminNavDashboard",
            arrival: "adminNavArrival",
            stock: "adminNavStock",
            profile: "adminNavProfile",
          }[key],
        )
        ?.getAttribute("aria-current") === "page",
  );
  const tabChanged = currentTab !== tab;
  Object.entries(panels).forEach(([key, id]) => {
    const panel = document.getElementById(id);
    const isActive = key === tab;
    if (panel) {
      panel.classList.toggle("hidden", !isActive);
      panel.setAttribute("aria-hidden", String(!isActive));
      if (isActive && tabChanged) {
        panel.classList.remove("admin-pwa-panel-enter");
        void panel.offsetWidth;
        panel.classList.add("admin-pwa-panel-enter");
      }
    }
    const button = document.getElementById(
      {
        dashboard: "adminNavDashboard",
        arrival: "adminNavArrival",
        stock: "adminNavStock",
        profile: "adminNavProfile",
      }[key],
    );
    button?.classList.toggle("text-sky-700", key === tab);
    button?.classList.toggle("text-slate-400", key !== tab);
    button?.classList.toggle("bg-sky-50", key === tab);
    if (button) {
      if (isActive) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  });
  const heading = {
    dashboard: ["Dashboard Admin", "Ringkasan logistik MBG"],
    arrival: ["Penerimaan Barang", "Foto dan catatan barang datang"],
    stock: ["Stok Barang", "Pantau barang yang sudah diterima"],
    profile: ["Profil", "Akun Admin Logistik"],
  }[tab];
  const title = document.getElementById("adminPwaPageTitle");
  const subtitle = document.getElementById("adminPwaPageSubtitle");
  if (title) title.textContent = heading[0];
  if (subtitle) subtitle.textContent = heading[1];
  if (tab === "stock") renderAdminPwaStock();
  if (tab === "profile") renderAdminPwaProfile();
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
};

function renderAdminPwaDashboard() {
  if (!document.getElementById("adminDashboardPanel")) return;
  const fields = [
    "adminDashTotalBarang",
    "adminDashPending",
    "adminDashArrivalsToday",
    "adminDashStockAvailable",
    "adminDashLowStock",
  ];
  if (!window.appState.barangLoaded) {
    fields.forEach((id) => {
      const element = document.getElementById(id);
      if (element)
        element.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin text-base"></i>';
    });
    return;
  }
  const items = window.appState.barang;
  const today = getLocalDateString();
  const arrivals = items.flatMap((item) =>
    (Array.isArray(item.arrivalHistory) ? item.arrivalHistory : []).map(
      (entry) => ({ item, entry }),
    ),
  );
  const inventoryItems = window.appState.inventoryItems || [];
  const lowStockItems = getLowStockInventoryItems(inventoryItems);
  const values = {
    adminDashTotalBarang: items.length,
    adminDashPending: items.filter(
      (item) => (item.statusAdmin || "Pending") === "Pending",
    ).length,
    adminDashArrivalsToday: arrivals.filter(
      ({ entry }) => String(entry.receivedDate || "") === today,
    ).length,
    adminDashStockAvailable: inventoryItems.filter(
      (item) => Number(item.datang || 0) > 0,
    ).length,
    adminDashLowStock: lowStockItems.length,
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value.toLocaleString("id-ID");
  });
  const recent = document.getElementById("adminDashRecent");
  const lowStockPanel = document.getElementById("adminDashLowStockList");
  if (lowStockPanel) {
    lowStockPanel.innerHTML = lowStockItems.length
      ? lowStockItems
          .slice(0, 5)
          .map(
            (item) =>
              `<div class="flex items-center justify-between gap-2 border-b border-amber-100 py-2 last:border-0"><span class="min-w-0 truncate text-xs font-semibold text-slate-700">${escapeHtml(item.nama || item.name || "Barang")}</span><span class="shrink-0 text-[10px] font-bold text-amber-700">${Number(item.datang || 0).toLocaleString("id-ID")} / ${Number(item.minimumStock || 0).toLocaleString("id-ID")} ${escapeHtml(item.satuan || "")}</span></div>`,
          )
          .join("")
      : '<p class="py-3 text-center text-xs text-emerald-700">Tidak ada stok di bawah batas minimum.</p>';
  }
  if (!recent) return;
  const latest = arrivals
    .sort((a, b) =>
      String(b.entry.recordedAt || b.entry.receivedAt || "").localeCompare(
        String(a.entry.recordedAt || a.entry.receivedAt || ""),
      ),
    )
    .slice(0, 5);
  recent.innerHTML = latest.length
    ? latest
        .map(({ item, entry }) => {
          const when = entry.receivedAt ? new Date(entry.receivedAt) : null;
          const timeText =
            when && !Number.isNaN(when.getTime())
              ? when.toLocaleString("id-ID", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              : "Waktu tidak tersedia";
          return `<article class="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0"><div class="min-w-0"><p class="truncate text-xs font-bold text-slate-700">${escapeHtml(item.nama || item.name || "Barang")}</p><p class="mt-1 text-[10px] text-slate-400">${escapeHtml(timeText)}</p></div><span class="shrink-0 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700">+${Number(entry.quantity || 0).toLocaleString("id-ID")} ${escapeHtml(item.satuan || "")}</span></article>`;
        })
        .join("")
    : '<p class="py-5 text-center text-xs text-slate-400">Belum ada riwayat penerimaan barang.</p>';
}

window.renderAdminPwaStock = function () {
  const list = document.getElementById("adminPwaStockList");
  if (!list) return;
  if (!window.appState.inventoryLoaded) {
    list.innerHTML =
      '<div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-sky-700"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat stok...</div>';
    return;
  }
  const query = (document.getElementById("adminPwaStockSearch")?.value || "")
    .trim()
    .toLocaleLowerCase("id-ID");
  const items = [...window.appState.inventoryItems]
    .filter((item) =>
      (item.nama || item.name || "").toLocaleLowerCase("id-ID").includes(query),
    )
    .sort((a, b) =>
      String(a.nama || a.name || "").localeCompare(
        String(b.nama || b.name || ""),
        "id",
      ),
    );
  list.innerHTML = items.length
    ? items
        .map((item) => {
          const stock = Number(item.datang || 0);
          const minimum = Number(item.minimumStock || 0);
          const low = minimum > 0 && stock <= minimum;
          const state = low
            ? "Perlu restok"
            : stock > 0
              ? "Tersedia"
              : "Kosong";
          const color = low
            ? "bg-amber-50 text-amber-700"
            : stock > 0
              ? "bg-emerald-50 text-emerald-700"
              : "bg-rose-50 text-rose-700";
          return `<article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div class="flex items-center justify-between gap-3"><div class="min-w-0"><h3 class="truncate text-sm font-bold text-slate-800">${escapeHtml(item.nama || item.name || "Barang")}</h3><p class="mt-1 text-[11px] text-slate-500">${escapeHtml(item.tipe || "Umum")} Â· Kebutuhan ${Number(item.kebutuhan || 0).toLocaleString("id-ID")} ${escapeHtml(item.satuan || "")}</p></div><div class="shrink-0 text-right"><strong class="block text-sm text-slate-800">${stock.toLocaleString("id-ID")} ${escapeHtml(item.satuan || "")}</strong><span class="mt-1 inline-flex rounded-full px-2 py-1 text-[9px] font-bold ${color}">${state}</span></div></div><button type="button" onclick="openStockUpdate(decodeURIComponent('${encodeURIComponent(String(item.id))}'))" class="mt-3 w-full rounded-xl bg-sky-50 px-3 py-2.5 text-xs font-bold text-sky-700 hover:bg-sky-100"><i class="fa-solid fa-pen-to-square mr-1"></i>Update Stok</button></article>`;
        })
        .join("")
    : '<div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Barang tidak ditemukan.</div>';
};

window.renderAdminPwaStock = function () {
  const list = document.getElementById("adminPwaStockList");
  if (!list) return;
  if (!window.appState.inventoryLoaded) {
    list.innerHTML =
      '<div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-sky-700"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat stok...</div>';
    return;
  }
  const query = (document.getElementById("adminPwaStockSearch")?.value || "")
    .trim()
    .toLocaleLowerCase("id-ID");
  const items = [...window.appState.inventoryItems]
    .filter((item) =>
      (item.nama || item.name || "").toLocaleLowerCase("id-ID").includes(query),
    )
    .sort((a, b) =>
      String(a.nama || a.name || "").localeCompare(
        String(b.nama || b.name || ""),
        "id",
      ),
    );
  list.innerHTML = items.length
    ? items
        .map((item) => {
          const stock = Number(item.datang || 0);
          const minimum = Number(item.minimumStock || 0);
          const low = minimum > 0 && stock <= minimum;
          const state = low
            ? "Perlu restok"
            : stock > 0
              ? "Tersedia"
              : "Kosong";
          const color = low
            ? "bg-amber-50 text-amber-700"
            : stock > 0
              ? "bg-emerald-50 text-emerald-700"
              : "bg-rose-50 text-rose-700";
          const safeId = encodeURIComponent(String(item.id));
          return `<article class="rounded-2xl border ${low ? "border-amber-300" : "border-slate-200"} bg-white p-4 shadow-sm"><div class="flex items-center justify-between gap-3"><div class="min-w-0"><h3 class="truncate text-sm font-bold text-slate-800">${escapeHtml(item.nama || item.name || "Barang")}</h3><p class="mt-1 text-[11px] text-slate-500">${escapeHtml(item.tipe || "Umum")} · ${escapeHtml(item.satuan || "unit")}</p>${minimum > 0 ? `<p class="mt-1 text-[10px] ${low ? "font-semibold text-amber-700" : "text-slate-400"}">Batas minimum ${minimum.toLocaleString("id-ID")} ${escapeHtml(item.satuan || "")}</p>` : ""}</div><div class="shrink-0 text-right"><strong class="block text-sm text-slate-800">${stock.toLocaleString("id-ID")} ${escapeHtml(item.satuan || "")}</strong><span class="mt-1 inline-flex rounded-full px-2 py-1 text-[9px] font-bold ${color}">${state}</span></div></div><button type="button" onclick="openStockUpdate(decodeURIComponent('${safeId}'))" class="mt-3 w-full rounded-xl bg-sky-50 px-3 py-2.5 text-xs font-bold text-sky-700 hover:bg-sky-100"><i class="fa-solid fa-pen-to-square mr-1"></i>Update Stok</button><button type="button" onclick="openStocktake(decodeURIComponent('${safeId}'))" class="mt-2 w-full rounded-xl bg-indigo-50 px-3 py-2.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100"><i class="fa-solid fa-clipboard-check mr-1"></i>Catat Stok Opname</button><div class="mt-2 grid grid-cols-2 gap-2"><button type="button" onclick="openStockHistory(decodeURIComponent('${safeId}'))" class="rounded-xl bg-slate-100 px-3 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-200"><i class="fa-solid fa-clock-rotate-left mr-1"></i>Riwayat</button><button type="button" onclick="promptStockDelete(decodeURIComponent('${safeId}'))" class="rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-600 hover:bg-rose-100"><i class="fa-solid fa-trash-can mr-1"></i>Hapus</button></div></article>`;
        })
        .join("")
    : '<div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Barang tidak ditemukan.</div>';
};

window.openAdminPwaAddStockItem = function () {
  document.querySelector("#adminPwaAddStockModal form")?.reset();
  const openingDate = document.getElementById("adminPwaNewItemDate");
  if (openingDate) openingDate.value = getLocalDateString();
  const modal = document.getElementById("adminPwaAddStockModal");
  modal?.classList.remove("hidden");
  modal?.classList.add("flex");
};

window.submitAdminPwaAddStockItem = async function (event) {
  event.preventDefault();
  const button = document.getElementById("adminPwaAddStockSaveButton");
  const name = document.getElementById("adminPwaNewItemName").value.trim();
  const unit = document.getElementById("adminPwaNewItemUnit").value.trim();
  const id = getInventoryDocumentId(name, unit);
  const item = {
    id,
    nama: name,
    tipe: document.getElementById("adminPwaNewItemType").value,
    satuan: unit,
    datang: Number(
      document.getElementById("adminPwaNewItemOpeningStock").value || 0,
    ),
    minimumStock: Number(
      document.getElementById("adminPwaNewItemMinimum").value || 0,
    ),
    stockHistory: [],
  };
  if (!item.nama || !item.satuan || item.datang < 0 || item.minimumStock < 0)
    return;
  if (window.appState.inventoryItems.some((entry) => String(entry.id) === id))
    return showToast(
      "Barang dan satuan tersebut sudah ada di daftar stok",
      "info",
    );
  if (item.datang > 0)
    item.stockHistory.push({
      type: "masuk",
      quantity: item.datang,
      stockBefore: 0,
      stockAfter: item.datang,
      date: document.getElementById("adminPwaNewItemDate").value,
      note: "Saldo awal",
      createdAt: new Date().toISOString(),
    });
  setButtonLoading(button, true, "Menyimpan...");
  try {
    const existing = await getDoc(doc(db, "inventory_items", id));
    if (existing.exists())
      return showToast(
        "Barang dan satuan tersebut sudah ada di daftar stok",
        "info",
      );
    await setDoc(doc(db, "inventory_items", id), item);
    window.appState.inventoryItems.unshift(item);
    renderAdminPwaStock();
    renderStockTable();
    renderAdminPwaDashboard();
    closeStockModal("adminPwaAddStockModal");
    showToast("Barang stok berhasil ditambahkan ke Firestore", "success");
  } catch (error) {
    showToast(error.message || "Barang gagal disimpan ke Firestore", "error");
  } finally {
    setButtonLoading(button, false);
  }
};

function renderAdminPwaProfile() {
  const user = window.appState.user;
  const photo = document.getElementById("adminProfilePhoto");
  const name = document.getElementById("adminProfileName");
  const email = document.getElementById("adminProfileEmail");
  const role = document.getElementById("adminProfileRole");
  if (photo)
    photo.src =
      user?.photoURL ||
      getSppHeaderSettings().foundationLogoDataUrl ||
      "./assets/icon-192.svg";
  if (name) name.textContent = user?.displayName || "Pengguna";
  if (email) email.textContent = user?.email || "Belum login";
  if (role)
    role.textContent =
      window.appState.access?.role === USER_ROLES.SUPER_ADMIN
        ? "Super Admin"
        : "Admin Logistik";
}

function observeAdminArrivalSentinel() {
  adminArrivalObserver?.disconnect();
  const sentinel = document.getElementById("adminArrivalScrollSentinel");
  if (!sentinel || !("IntersectionObserver" in window)) return;
  adminArrivalObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        adminArrivalVisibleCount += ADMIN_ARRIVAL_PAGE_SIZE;
        renderAdminArrivalPage();
      }
    },
    { rootMargin: "180px" },
  );
  adminArrivalObserver.observe(sentinel);
}

function getLocalDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateID(value) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("id-ID", { dateStyle: "medium" });
}

async function compressArrivalPhoto(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "Foto tidak dapat dibaca. Pilih gambar JPG, PNG, atau WebP.",
    );
  }
  const maxDimension = 1280;
  const scale = Math.min(
    1,
    maxDimension / Math.max(bitmap.width, bitmap.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Perangkat tidak dapat mengompres foto ini.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  let quality = 0.68;
  let blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  while (blob && blob.size > 360 * 1024 && quality > 0.38) {
    quality -= 0.08;
    blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
  }
  if (!blob || blob.size > 360 * 1024)
    throw new Error(
      "Foto masih terlalu besar setelah dikompres. Ambil foto dengan resolusi lebih rendah.",
    );
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Foto gagal diproses."));
    reader.readAsDataURL(blob);
  });
  return {
    dataUrl,
    sizeBytes: blob.size,
    width: canvas.width,
    height: canvas.height,
  };
}

window.renderAdminArrivalPage = renderAdminArrivalPage;

window.openAdminArrival = function (itemId) {
  const itemType = getAdminArrivalType();
  const item = getAdminArrivalItems(itemType).find(
    (entry) => String(entry.id) === String(itemId),
  );
  const selectedDate =
    document.getElementById("adminArrivalFilterDate")?.value ||
    getLocalDateString();
  if (
    !item ||
    (item.statusAdmin || "Pending") !== "Pending" ||
    String(item.tanggal || "") < selectedDate ||
    String(item.tanggal || "") >
      (document.getElementById("adminArrivalFilterDateTo")?.value ||
        selectedDate)
  ) {
    showToast(
      "Barang ini tidak lagi berstatus Pending untuk tanggal terpilih",
      "error",
    );
    renderAdminArrivalPage();
    return;
  }
  if (!window.appState.user) {
    showToast(
      "Login Google terlebih dahulu untuk mencatat penerimaan",
      "error",
    );
    return;
  }

  document.getElementById("adminArrivalForm").reset();
  document.getElementById("adminArrivalItemId").value = item.id;
  document.getElementById("adminArrivalItemType").value = itemType;
  document.getElementById("adminArrivalItemName").textContent =
    item.nama || item.name || "Barang";
  document.getElementById("adminArrivalUnit").textContent =
    item.satuan || "unit";
  const now = new Date();
  document.getElementById("adminArrivalDate").value = getLocalDateString(now);
  document.getElementById("adminArrivalTime").value =
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  document.getElementById("adminArrivalPhotoPreview").classList.add("hidden");
  document.getElementById("adminArrivalModal").classList.remove("hidden");
  document.getElementById("adminArrivalModal").classList.add("flex");
};

window.closeAdminArrivalModal = function () {
  document.getElementById("adminArrivalModal")?.classList.add("hidden");
  document.getElementById("adminArrivalModal")?.classList.remove("flex");
  document.getElementById("adminArrivalForm")?.reset();
  document.getElementById("adminArrivalPhotoPreview")?.classList.add("hidden");
  if (adminArrivalPhotoPreviewUrl) {
    URL.revokeObjectURL(adminArrivalPhotoPreviewUrl);
    adminArrivalPhotoPreviewUrl = null;
  }
};

window.viewAdminArrivalPhoto = async function (photoId) {
  try {
    const photoSnapshot = await getDoc(
      doc(db, "barang_arrival_photos", String(photoId)),
    );
    const data = photoSnapshot.exists() ? photoSnapshot.data() : null;
    const dataUrl =
      data?.dataUrl || data?.base64 || data?.foto || data?.image || "";
    if (!dataUrl) throw new Error("Foto bukti tidak ditemukan.");
    const view = document.getElementById("adminArrivalPhotoViewModal");
    const image = document.getElementById("adminArrivalPhotoViewImage");
    if (!view || !image) return;
    image.src = dataUrl;
    view.classList.remove("hidden");
    view.classList.add("flex");
  } catch (error) {
    showToast(error.message || "Foto gagal dibuka.", "error");
  }
};

window.closeAdminArrivalPhotoView = function () {
  const view = document.getElementById("adminArrivalPhotoViewModal");
  const image = document.getElementById("adminArrivalPhotoViewImage");
  if (image) image.src = "";
  view?.classList.add("hidden");
  view?.classList.remove("flex");
};

window.submitAdminArrival = async function (event) {
  event.preventDefault();
  const itemId = document.getElementById("adminArrivalItemId").value;
  const itemType = document.getElementById("adminArrivalItemType").value;
  const itemCollection =
    itemType === "operasional" ? "operational_items" : "mbg_items";
  const currentItems = getAdminArrivalItems(itemType);
  const item = currentItems.find(
    (entry) => String(entry.id) === String(itemId),
  );
  const quantity = Number(
    document.getElementById("adminArrivalQuantity").value,
  );
  const file = document.getElementById("adminArrivalPhoto").files?.[0];
  const date = document.getElementById("adminArrivalDate").value;
  const time = document.getElementById("adminArrivalTime").value;
  if (!item || (item.statusAdmin || "Pending") !== "Pending") {
    showToast("Barang tidak ditemukan atau statusnya bukan Pending", "error");
    return;
  }
  if (String(item.tanggal || "") !== date) {
    showToast(
      "Tanggal datang tetap harus sesuai dengan tanggal barang",
      "error",
    );
    return;
  }
  if (!window.appState.user) {
    showToast(
      "Login Google terlebih dahulu untuk mencatat penerimaan",
      "error",
    );
    return;
  }
  if (!file || !file.type.startsWith("image/")) {
    showToast("Pilih foto bukti penerimaan dalam format gambar", "error");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showToast("Ukuran foto asli maksimal 20 MB sebelum dikompres", "error");
    return;
  }
  if (!Number.isFinite(quantity) || quantity <= 0 || !date || !time) {
    showToast("Isi jumlah, tanggal, dan jam penerimaan dengan benar", "error");
    return;
  }

  const submitButton = document.getElementById("adminArrivalSubmitButton");
  setButtonLoading(submitButton, true, "Mengompres foto...");
  let photoRef = null;
  let parentItemSaved = false;
  try {
    const compressedPhoto = await compressArrivalPhoto(file);
    submitButton.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i><span>Menyimpan ke Firestore...</span>';
    const receivedAt = new Date(`${date}T${time}`);
    const recordedAt = new Date().toISOString();
    const inventoryId = getInventoryDocumentId(
      item.nama || item.name || "Barang",
      item.satuan || "unit",
    );
    const inventoryRef = doc(db, "inventory_items", inventoryId);
    const inventorySnapshot = await getDoc(inventoryRef);
    const cachedInventoryItem =
      window.appState.inventoryItems.find(
        (entry) => String(entry.id) === inventoryId,
      ) || {};
    const inventoryItem = inventorySnapshot.exists()
      ? { id: inventorySnapshot.id, ...inventorySnapshot.data() }
      : cachedInventoryItem;
    const stockBefore = Number(inventoryItem.datang || 0);
    const stockAfter = stockBefore + quantity;
    const note = document.getElementById("adminArrivalNote").value.trim();
    photoRef = doc(collection(db, "barang_arrival_photos"));
    const arrival = {
      id: photoRef.id,
      quantity,
      receivedDate: date,
      receivedTime: time,
      receivedAt: receivedAt.toISOString(),
      recordedAt,
      receivedBy: window.appState.user.email || window.appState.user.uid,
      note,
      photoId: photoRef.id,
      photoSizeBytes: compressedPhoto.sizeBytes,
      photoWidth: compressedPhoto.width,
      photoHeight: compressedPhoto.height,
    };
    const updatedItem = {
      ...item,
      statusAdmin: "ACC",
      arrivalHistory: [
        ...(Array.isArray(item.arrivalHistory) ? item.arrivalHistory : []),
        arrival,
      ],
    };
    const updatedInventoryItem = {
      nama: inventoryItem.nama || item.nama || item.name || "Barang",
      tipe: inventoryItem.tipe || item.tipe || "Umum",
      satuan: inventoryItem.satuan || item.satuan || "unit",
      datang: stockAfter,
      sourcePlanningItemIds: [
        ...new Set([
          ...(inventoryItem.sourcePlanningItemIds || []),
          ...(itemType === "operasional" ? [] : [String(item.id)]),
        ]),
      ],
      ...(itemType === "operasional"
        ? {
            sourceOperationalItemIds: [
              ...new Set([
                ...(inventoryItem.sourceOperationalItemIds || []),
                String(item.id),
              ]),
            ],
          }
        : {}),
      stockHistory: [
        ...(Array.isArray(inventoryItem.stockHistory)
          ? inventoryItem.stockHistory
          : []),
        {
          type: "masuk",
          quantity,
          date,
          note: note || "Penerimaan dicatat melalui PWA Admin",
          stockBefore,
          stockAfter,
          createdAt: recordedAt,
        },
      ],
    };
    const batch = writeBatch(db);
    batch.set(photoRef, {
      itemId: String(item.id),
      itemType,
      itemName: item.nama || item.name || "Barang",
      receivedDate: date,
      receivedTime: time,
      receivedBy: window.appState.user.email || window.appState.user.uid,
      createdAt: recordedAt,
      mimeType: "image/jpeg",
      sizeBytes: compressedPhoto.sizeBytes,
      dataUrl: compressedPhoto.dataUrl,
    });
    batch.set(doc(db, itemCollection, String(item.id)), updatedItem);
    batch.set(inventoryRef, updatedInventoryItem);
    await batch.commit();
    parentItemSaved = true;
    const updatedItems = currentItems.map((entry) =>
      String(entry.id) === String(item.id) ? updatedItem : entry,
    );
    if (itemType === "operasional")
      window.appState.barangOperasional = updatedItems;
    else window.appState.barang = updatedItems;
    const inventoryIndex = window.appState.inventoryItems.findIndex(
      (entry) => String(entry.id) === inventoryId,
    );
    const nextInventoryItem = { id: inventoryId, ...updatedInventoryItem };
    if (inventoryIndex < 0)
      window.appState.inventoryItems.unshift(nextInventoryItem);
    else window.appState.inventoryItems[inventoryIndex] = nextInventoryItem;
    renderAdminArrivalPage();
    renderStockTable();
    renderBarangTable();
    renderAdminPwaDashboard();
    renderAdminPwaStock();
    updateDashboardMetrics();
    closeAdminArrivalModal();
    showToast(
      "Foto terkompresi dan penerimaan berhasil disimpan ke Firestore",
      "success",
    );
  } catch (error) {
    if (photoRef && !parentItemSaved) await deleteDoc(photoRef).catch(() => {});
    showToast(
      parentItemSaved
        ? `Penerimaan tersimpan, tetapi foto mungkin gagal dibersihkan dari data browser: ${error.message}`
        : error.message || "Penerimaan barang gagal disimpan.",
      "error",
    );
  } finally {
    setButtonLoading(submitButton, false);
  }
};

window.renderStockTable = function () {
  const tbody = document.getElementById("stockTableBody");
  const summary = document.getElementById("stockSummary");
  if (!tbody || !summary) return;

  if (!window.appState.inventoryLoaded) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="py-10 text-center text-sky-700"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat stok...</td></tr>';
    return;
  }
  const items = window.appState.inventoryItems;
  const stockState = (item) => {
    return Number(item.datang) > 0 ? "available" : "empty";
  };
  const counts = {
    total: items.length,
    available: items.filter((item) => stockState(item) === "available").length,
    empty: items.filter((item) => stockState(item) === "empty").length,
    low: getLowStockInventoryItems(items).length,
  };
  summary.innerHTML = `
    <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm"><p class="text-xs font-bold uppercase tracking-wider text-slate-400">Jenis Barang</p><p class="text-2xl font-extrabold text-slate-800 mt-2">${counts.total.toLocaleString("id-ID")}</p><p class="text-[11px] text-slate-500 mt-1">Total barang terdaftar</p></div>
    <div class="bg-white p-5 rounded-2xl border border-emerald-200 shadow-sm"><p class="text-xs font-bold uppercase tracking-wider text-slate-400">Stok Tersedia</p><p class="text-2xl font-extrabold text-emerald-600 mt-2">${counts.available.toLocaleString("id-ID")}</p><p class="text-[11px] text-slate-500 mt-1">Barang dengan saldo lebih dari nol</p></div>
    <div class="bg-white p-5 rounded-2xl border border-red-200 shadow-sm"><p class="text-xs font-bold uppercase tracking-wider text-slate-400">Stok Kosong</p><p class="text-2xl font-extrabold text-red-600 mt-2">${counts.empty.toLocaleString("id-ID")}</p><p class="text-[11px] text-slate-500 mt-1">Barang tanpa saldo stok</p></div>
    <div class="bg-white p-5 rounded-2xl border border-amber-200 shadow-sm"><p class="text-xs font-bold uppercase tracking-wider text-slate-400">Perlu Restok</p><p class="text-2xl font-extrabold text-amber-600 mt-2">${counts.low.toLocaleString("id-ID")}</p><p class="text-[11px] text-slate-500 mt-1">Saldo menyentuh batas minimum</p></div>
  `;

  const query = (document.getElementById("stockSearch")?.value || "")
    .trim()
    .toLowerCase();
  const filter = document.getElementById("stockFilter")?.value || "all";
  const filtered = items.filter((item) => {
    const matchesName = (item.nama || item.name || "")
      .toLowerCase()
      .includes(query);
    const state = stockState(item);
    const isLow =
      Number(item.minimumStock || 0) > 0 &&
      Number(item.datang || 0) <= Number(item.minimumStock || 0);
    return (
      matchesName &&
      (filter === "all" || filter === state || (filter === "low" && isLow))
    );
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-10 text-slate-400">${items.length ? "Tidak ada barang yang cocok dengan filter." : "Belum ada data barang."}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((item) => {
      const arrived = Number(item.datang) || 0;
      const state = stockState(item);
      const minimum = Number(item.minimumStock || 0);
      const low = minimum > 0 && arrived <= minimum;
      const stateLabel = low
        ? "Perlu restok"
        : state === "empty"
          ? "Kosong"
          : "Tersedia";
      const stateStyle = low
        ? "bg-amber-100 text-amber-800"
        : state === "empty"
          ? "bg-red-100 text-red-700"
          : "bg-emerald-100 text-emerald-700";
      return `<tr class="hover:bg-slate-50/80 ${low ? "bg-amber-50/40" : ""}"><td class="py-3.5 px-5"><p class="font-bold text-slate-800">${escapeHtml(item.nama || item.name || "-")}</p><p class="text-[10px] text-slate-400 mt-1">ID: ${escapeHtml(item.id)}</p></td><td class="py-3.5 px-5">${escapeHtml(item.tipe || "Utama")}</td><td class="py-3.5 px-5 text-right font-bold text-slate-800 whitespace-nowrap">${arrived.toLocaleString("id-ID")} ${escapeHtml(item.satuan || "")}${minimum > 0 ? `<p class="mt-1 text-[10px] font-normal ${low ? "text-amber-700" : "text-slate-400"}">Minimum ${minimum.toLocaleString("id-ID")} ${escapeHtml(item.satuan || "")}</p>` : ""}</td><td class="py-3.5 px-5"><span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${stateStyle}">${stateLabel}</span></td><td class="py-3.5 px-5 text-right whitespace-nowrap"><button type="button" onclick="openStockUpdate('${escapeHtml(item.id)}')" class="px-2.5 py-2 bg-sky-50 text-sky-700 rounded-lg font-semibold hover:bg-sky-100" title="Catat barang masuk atau keluar"><i class="fa-solid fa-pen-to-square mr-1"></i>Update</button><button type="button" onclick="openStockMinimum('${escapeHtml(item.id)}')" class="px-2.5 py-2 ml-1 bg-amber-50 text-amber-700 rounded-lg font-semibold hover:bg-amber-100" title="Atur batas minimum"><i class="fa-solid fa-bell"></i></button><button type="button" onclick="openStockHistory('${escapeHtml(item.id)}')" class="px-2.5 py-2 ml-1 bg-slate-100 text-slate-600 rounded-lg font-semibold hover:bg-slate-200" title="Lihat riwayat"><i class="fa-solid fa-clock-rotate-left mr-1"></i>Riwayat</button><button type="button" onclick="promptStockDelete('${escapeHtml(item.id)}')" class="px-2.5 py-2 ml-1 bg-red-50 text-red-600 rounded-lg font-semibold hover:bg-red-100" title="Hapus barang"><i class="fa-solid fa-trash-can"></i></button></td></tr>`;
    })
    .join("");
};

window.closeStockModal = function (modalId) {
  document.getElementById(modalId)?.classList.add("hidden");
};

function getSppHeaderSettings() {
  if (window.appState?.kitchenSettings) return window.appState.kitchenSettings;
  try {
    return JSON.parse(localStorage.getItem("mbgKitchenSettings") || "{}");
  } catch {
    return {};
  }
}

function renderSidebarBrandLogo() {
  const settings = getSppHeaderSettings();
  const logoUrl = settings.leftLogoDataUrl || settings.foundationLogoDataUrl;
  const brandHeader = document.querySelector(
    "#sidebar > div:first-child > div:first-child",
  );
  if (!brandHeader) return;

  const container = brandHeader.firstElementChild;
  if (container) {
    container.classList.add(
      "sidebar-brand-mark",
      "shrink-0",
      "overflow-hidden",
    );
    if (typeof logoUrl === "string" && logoUrl.startsWith("data:image/")) {
      let image = container.querySelector("img");
      if (!image) {
        image = document.createElement("img");
        image.alt = "Logo yayasan";
        image.className =
          "block h-full w-full rounded-xl bg-white object-contain p-0.5";
        container.replaceChildren(image);
      }
      if (image.src !== logoUrl) image.src = logoUrl;
      container.classList.remove(
        "bg-gradient-to-tr",
        "from-sky-500",
        "to-emerald-400",
        "text-white",
        "shadow-sky-500/20",
      );
      container.classList.add("bg-white");
    } else {
      container.classList.remove("bg-white");
      container.classList.add(
        "bg-gradient-to-tr",
        "from-sky-500",
        "to-emerald-400",
        "text-white",
      );
      if (!container.querySelector("i")) {
        const icon = document.createElement("i");
        icon.className = "fa-solid fa-utensils text-lg";
        container.replaceChildren(icon);
      }
    }
  }

  const title = brandHeader.querySelector("h1");
  const subtitle = brandHeader.querySelector("p");
  if (title) {
    title.textContent = settings.kitchenName?.trim() || "MBG System";
    title.classList.add("truncate");
  }
  if (subtitle) {
    subtitle.textContent =
      settings.foundationName?.trim() || "Makan Bergizi Gratis";
    subtitle.classList.add("truncate");
  }
  brandHeader.lastElementChild?.classList.add("min-w-0", "flex-1");
}

function renderConfiguredAppIcons() {
  const settings = getSppHeaderSettings();
  const logoUrl = settings.leftLogoDataUrl || settings.foundationLogoDataUrl;
  const hasCustomLogo =
    typeof logoUrl === "string" && logoUrl.startsWith("data:image/");
  const iconUrl = hasCustomLogo ? logoUrl : "./assets/icon-192.svg";

  document
    .querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')
    .forEach((link) => {
      link.href = iconUrl;
      link.type = hasCustomLogo
        ? logoUrl.slice(5, logoUrl.indexOf(";")) || "image/webp"
        : "image/svg+xml";
    });

  const pwaBrandIcon = document.getElementById("adminPwaBrandIcon");
  if (pwaBrandIcon) {
    if (hasCustomLogo) {
      let image = pwaBrandIcon.querySelector("img");
      if (!image) {
        image = document.createElement("img");
        image.alt = "Logo yayasan";
        image.className =
          "h-full w-full rounded-2xl bg-white object-contain p-0.5";
        pwaBrandIcon.replaceChildren(image);
      }
      if (image.src !== logoUrl) image.src = logoUrl;
      pwaBrandIcon.classList.remove("bg-sky-700", "text-white");
      pwaBrandIcon.classList.add("overflow-hidden", "bg-white");
    } else {
      pwaBrandIcon.classList.remove("overflow-hidden", "bg-white");
      pwaBrandIcon.classList.add("bg-sky-700", "text-white");
      if (!pwaBrandIcon.querySelector("i")) {
        const icon = document.createElement("i");
        icon.className = "fa-solid fa-box-open";
        pwaBrandIcon.replaceChildren(icon);
      }
    }
  }

  const profilePhoto = document.getElementById("adminProfilePhoto");
  if (profilePhoto && !window.appState.user?.photoURL)
    profilePhoto.src = iconUrl;
}

window.renderSidebarBrandLogo = renderSidebarBrandLogo;
window.addEventListener("storage", (event) => {
  if (event.key === "mbgKitchenSettings") {
    renderSidebarBrandLogo();
    renderConfiguredAppIcons();
  }
});
window.addEventListener("mbg-kitchen-settings-updated", () => {
  renderSidebarBrandLogo();
  renderConfiguredAppIcons();
});
window.saveKitchenSettingsToFirebase = async function (settings) {
  const savedSettings = {
    ...settings,
    updatedAt: new Date().toISOString(),
    updatedBy: normalizeAccountEmail(window.appState.user?.email),
  };
  await setDoc(doc(db, "app_settings", "organization"), savedSettings, {
    merge: true,
  });
  window.appState.kitchenSettings = savedSettings;
  try {
    localStorage.setItem("mbgKitchenSettings", JSON.stringify(savedSettings));
  } catch {}
  window.dispatchEvent(new Event("mbg-kitchen-settings-updated"));
  return savedSettings;
};
renderSidebarBrandLogo();
renderConfiguredAppIcons();

function renderSppLetters(loadError = null) {
  const tbody = document.getElementById("sppLettersTableBody");
  if (!tbody) return;
  const letters = [...(window.appState.sppLetters || [])].sort((a, b) =>
    String(b.createdAt || b.date || "").localeCompare(
      String(a.createdAt || a.date || ""),
    ),
  );
  const count = document.getElementById("sppLetterCount");
  if (count) count.textContent = `${letters.length} surat`;
  if (!window.appState.sppLettersLoaded) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-5 py-10 text-center text-sky-700"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat surat tersimpan...</td></tr>`;
    return;
  }
  if (loadError) {
    const message =
      loadError.code === "permission-denied"
        ? "Akses ditolak. Publikasikan Firestore Rules terbaru yang mengizinkan koleksi payment_letters, lalu muat ulang halaman."
        : `Surat gagal dimuat (${loadError.code || "Firestore"}): ${loadError.message || "terjadi kesalahan"}`;
    tbody.innerHTML = `<tr><td colspan="6" class="px-5 py-10 text-center text-rose-600">${escapeHtml(message)}</td></tr>`;
    return;
  }
  if (!letters.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-5 py-10 text-center text-slate-400">Belum ada surat permintaan pembayaran yang disimpan.</td></tr>`;
    return;
  }
  tbody.innerHTML = letters
    .map((letter) => {
      const letterId = encodeURIComponent(String(letter.id));
      const total = Number(
        letter.total ??
          (letter.suppliers || []).reduce(
            (sum, row) => sum + Number(row.amount || 0),
            0,
          ),
      );
      const creator = letter.createdByName || letter.createdByEmail || "-";
      return `<tr class="border-t border-slate-100 hover:bg-slate-50"><td class="whitespace-nowrap px-5 py-3.5">${escapeHtml(formatLetterDate(letter.date || "-"))}</td><td class="px-5 py-3.5 font-semibold text-slate-700">${escapeHtml(letter.number || "-")}</td><td class="max-w-xs px-5 py-3.5"><span class="line-clamp-2">${escapeHtml(letter.category || "-")}</span></td><td class="whitespace-nowrap px-5 py-3.5 text-right font-bold text-slate-700">${formatRupiah(total)}</td><td class="px-5 py-3.5">${escapeHtml(creator)}</td><td class="whitespace-nowrap px-5 py-3.5 text-right"><button type="button" onclick="openSavedSppLetter(decodeURIComponent('${letterId}'))" class="rounded-lg bg-sky-50 px-2.5 py-2 font-semibold text-sky-700" title="Buka surat"><i class="fa-regular fa-eye"></i></button><button type="button" onclick="editSavedSppLetter(decodeURIComponent('${letterId}'))" class="ml-1 rounded-lg bg-amber-50 px-2.5 py-2 font-semibold text-amber-700" title="Edit surat"><i class="fa-solid fa-pen-to-square"></i></button><button type="button" onclick="deleteSavedSppLetter(decodeURIComponent('${letterId}'))" class="ml-1 rounded-lg bg-rose-50 px-2.5 py-2 font-semibold text-rose-600" title="Hapus surat"><i class="fa-solid fa-trash-can"></i></button></td></tr>`;
    })
    .join("");
}

window.openSavedSppLetter = function (letterId) {
  const letter = (window.appState.sppLetters || []).find(
    (entry) => String(entry.id) === String(letterId),
  );
  if (!letter) return showToast("Surat tidak ditemukan", "error");
  showSppPreview(letter);
};

window.deleteSavedSppLetter = async function (letterId) {
  const letter = (window.appState.sppLetters || []).find(
    (entry) => String(entry.id) === String(letterId),
  );
  if (!letter || !window.confirm(`Hapus surat ${letter.number || "ini"}?`))
    return;
  try {
    await deleteDoc(doc(db, "payment_letters", String(letterId)));
    showToast("Surat berhasil dihapus", "success");
  } catch (error) {
    showToast(error.message || "Surat gagal dihapus", "error");
  }
};

function terbilangRupiah(value) {
  const number = Math.floor(Number(value) || 0);
  if (number === 0) return "nol rupiah";
  const belowTwenty = [
    "",
    "satu",
    "dua",
    "tiga",
    "empat",
    "lima",
    "enam",
    "tujuh",
    "delapan",
    "sembilan",
    "sepuluh",
    "sebelas",
  ];
  const words = (n) => {
    if (n < 12) return belowTwenty[n];
    if (n < 20) return `${words(n - 10)} belas`;
    if (n < 100)
      return `${words(Math.floor(n / 10))} puluh${n % 10 ? ` ${words(n % 10)}` : ""}`;
    if (n < 200) return `seratus${n % 100 ? ` ${words(n - 100)}` : ""}`;
    if (n < 1000)
      return `${words(Math.floor(n / 100))} ratus${n % 100 ? ` ${words(n % 100)}` : ""}`;
    if (n < 2000) return `seribu${n % 1000 ? ` ${words(n - 1000)}` : ""}`;
    if (n < 1_000_000)
      return `${words(Math.floor(n / 1000))} ribu${n % 1000 ? ` ${words(n % 1000)}` : ""}`;
    if (n < 1_000_000_000)
      return `${words(Math.floor(n / 1_000_000))} juta${n % 1_000_000 ? ` ${words(n % 1_000_000)}` : ""}`;
    if (n < 1_000_000_000_000)
      return `${words(Math.floor(n / 1_000_000_000))} miliar${n % 1_000_000_000 ? ` ${words(n % 1_000_000_000)}` : ""}`;
    return `${words(Math.floor(n / 1_000_000_000_000))} triliun${n % 1_000_000_000_000 ? ` ${words(n % 1_000_000_000_000)}` : ""}`;
  };
  return `${words(number).replace(/\s+/g, " ").trim()} rupiah`;
}

function formatLetterDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
}

function getSppItemCategory() {
  return document.getElementById("sppItemCategory")?.value === "operasional"
    ? "operasional"
    : "bahan_baku";
}

function getSppItems(category = getSppItemCategory()) {
  return category === "operasional"
    ? window.appState.barangOperasional || []
    : window.appState.barang || [];
}

function areSppItemsLoaded(category = getSppItemCategory()) {
  return category === "operasional"
    ? window.appState.barangOperasionalLoaded
    : window.appState.barangLoaded;
}

window.setSppItemCategory = function (category) {
  if (!["bahan_baku", "operasional"].includes(category)) return;
  const categorySelect = document.getElementById("sppItemCategory");
  if (categorySelect) categorySelect.value = category;
  document.querySelectorAll("#sppSupplierRows tr").forEach((row) => {
    const itemSelect = row.querySelector(".spp-item-select");
    if (itemSelect) itemSelect.value = "";
    [
      ".spp-item-name",
      ".spp-item-quantity",
      ".spp-item-unit",
      ".spp-item-price",
      ".spp-item-amount",
    ].forEach((selector) => {
      const input = row.querySelector(selector);
      if (input) input.value = "";
    });
    const unitLabel = row.querySelector(".spp-item-unit-label");
    if (unitLabel) unitLabel.textContent = "";
  });
  window.refreshSppDatabaseOptions();
  window.loadSppDatabaseProductPhotos();
  window.updateSppPaymentTotal();
};

window.refreshSppDatabaseOptions = function (row = null) {
  const suppliers = window.appState.suppliers || [];
  const rows = row
    ? [row.matches?.("tr") ? row : row.closest?.("tr")].filter(Boolean)
    : [...(document.querySelectorAll("#sppSupplierRows tr") || [])];
  const safeOption = (value) => escapeHtml(String(value ?? ""));
  const category = getSppItemCategory();
  const categoryLabel =
    category === "operasional" ? "operasional" : "bahan baku";
  const sourceItems = getSppItems(category);
  const sourceLoaded = areSppItemsLoaded(category);
  rows.forEach((entry) => {
    const itemDate = entry.querySelector(".spp-item-date")?.value || "";
    const items = sourceItems.filter(
      (item) => itemDate && String(item.tanggal || "") === itemDate,
    );
    const itemSelect = entry.querySelector(".spp-item-select");
    const supplierSelect = entry.querySelector(".spp-item-supplier-select");
    if (itemSelect) {
      const selectedId = itemSelect.value;
      const placeholder = !sourceLoaded
        ? `Memuat barang ${categoryLabel}...`
        : category === "operasional" && window.appState.barangOperasionalError
          ? "Akses data operasional ditolak"
          : !itemDate
            ? "Pilih tanggal barang terlebih dahulu"
            : !items.length
              ? `Tidak ada barang ${categoryLabel} pada tanggal ini`
              : "Pilih barang";
      itemSelect.innerHTML = `<option value="">${placeholder}</option>${items.map((item) => `<option value="${safeOption(item.id)}">${safeOption(item.nama || item.name || "Barang")} Â· ${safeOption(item.satuan || "")}</option>`).join("")}`;
      if (items.some((item) => String(item.id) === selectedId))
        itemSelect.value = selectedId;
      else itemSelect.value = "";
      window.selectSppDatabaseItem(itemSelect);
    }
    if (supplierSelect) {
      const selectedId = supplierSelect.value;
      const placeholder = !window.appState.suppliersLoaded
        ? "Memuat supplier dari database..."
        : suppliers.length
          ? "Pilih supplier"
          : "Belum ada data supplier";
      supplierSelect.innerHTML = `<option value="">${placeholder}</option>${suppliers.map((supplier) => `<option value="${safeOption(supplier.id)}">${safeOption(supplier.nama || "Supplier")}</option>`).join("")}`;
      if (suppliers.some((supplier) => String(supplier.id) === selectedId))
        supplierSelect.value = selectedId;
      else supplierSelect.value = "";
      window.selectSppDatabaseSupplier(supplierSelect);
    }
  });
};

window.selectSppDatabaseItem = function (select) {
  const row = select.closest("tr");
  const item = getSppItems().find(
    (entry) => String(entry.id) === String(select.value),
  );
  const nameInput = row?.querySelector(".spp-item-name");
  if (nameInput) nameInput.value = item ? item.nama || item.name || "" : "";
  const quantityInput = row?.querySelector(".spp-item-quantity");
  const unitInput = row?.querySelector(".spp-item-unit");
  const unitLabel = row?.querySelector(".spp-item-unit-label");
  const priceInput = row?.querySelector(".spp-item-price");
  const receivedQuantity = item ? getItemReceivedQuantity(item) : 0;
  const billableQuantity = item
    ? receivedQuantity > 0
      ? receivedQuantity
      : Number(item.kebutuhan || 0)
    : 0;
  if (quantityInput) quantityInput.value = item ? billableQuantity : "";
  if (unitInput) unitInput.value = item?.satuan || "";
  if (unitLabel) unitLabel.textContent = item?.satuan || "";
  if (priceInput) priceInput.value = item ? Number(item.harga || 0) : "";
  window.calculateSppRowTotal(row);
};

window.calculateSppRowTotal = function (row) {
  if (!row) return 0;
  const quantity = Number(row.querySelector(".spp-item-quantity")?.value || 0);
  const price = Number(row.querySelector(".spp-item-price")?.value || 0);
  const amountInput = row.querySelector(".spp-item-amount");
  const total = quantity * price;
  if (amountInput) amountInput.value = total > 0 ? String(total) : "";
  window.updateSppPaymentTotal();
  return total;
};

window.selectSppDatabaseSupplier = function (select) {
  const row = select.closest("tr");
  const supplier = (window.appState.suppliers || []).find(
    (entry) => String(entry.id) === String(select.value),
  );
  const nameInput = row?.querySelector(".spp-item-supplier");
  const accountInput = row?.querySelector(".spp-item-account");
  const bankInput = row?.querySelector(".spp-item-bank");
  if (nameInput) nameInput.value = supplier?.nama || "";
  if (accountInput) accountInput.value = supplier?.noRekening || "";
  if (bankInput) bankInput.value = supplier?.namaBank || "";
};

window.addSppSupplierRow = function (initial = {}) {
  const tbody = document.getElementById("sppSupplierRows");
  if (!tbody) return;
  const row = document.createElement("tr");
  row.className = "border-t border-slate-100";
  row.innerHTML =
    '<td class="p-2"><input class="spp-item-date hidden" type="hidden"/><input class="spp-item-date-picker mb-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-[10px]" type="date" aria-label="Tanggal barang" onchange="setSppItemDate(this)"/><select class="spp-item-select mb-1 w-full rounded-lg border border-slate-200 px-2 py-2" onchange="selectSppDatabaseItem(this)"><option value="">Pilih tanggal barang terlebih dahulu</option></select><input class="spp-item-name w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-[10px]" maxlength="140" placeholder="Nama barang" readonly/></td><td class="p-2"><input class="spp-item-quantity w-20 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2" type="number" min="0" step="any" placeholder="Qty" readonly/><small class="spp-item-unit-label ml-1 text-slate-500"></small><input class="spp-item-unit hidden" type="text"/></td><td class="p-2"><input class="spp-item-price w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2" type="number" min="0" step="any" placeholder="Harga" readonly/></td><td class="p-2"><input class="spp-item-amount w-full rounded-lg border border-slate-200 bg-sky-50 px-2 py-2 font-bold" type="number" min="0" step="any" placeholder="Total" readonly/></td><td class="p-2"><input class="spp-item-account w-full rounded-lg border border-slate-200 px-2 py-2" maxlength="80" placeholder="Otomatis dari supplier"/></td><td class="p-2"><input class="spp-item-bank w-full rounded-lg border border-slate-200 px-2 py-2" maxlength="100" placeholder="Otomatis dari supplier"/></td><td class="p-2"><select class="spp-item-supplier-select mb-1 w-full rounded-lg border border-slate-200 px-2 py-2" onchange="selectSppDatabaseSupplier(this)"><option value="">Memuat supplier dari database...</option></select><input class="spp-item-supplier w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-[10px]" maxlength="140" placeholder="Nama supplier" readonly/></td><td class="p-2"><button type="button" class="spp-remove-row rounded-lg bg-rose-50 px-2 py-2 text-rose-600" aria-label="Hapus baris"><i class="fa-solid fa-trash-can"></i></button></td>';
  row.querySelector(".spp-item-date").value =
    initial.itemDate ||
    document.getElementById("sppBulkItemDate")?.value ||
    document.getElementById("sppLetterDate")?.value ||
    getLocalDateString();
  row.querySelector(".spp-item-date-picker").value =
    row.querySelector(".spp-item-date").value;
  row.querySelector(".spp-item-name").value = initial.itemName || "";
  row.querySelector(".spp-item-amount").value = initial.amount || "";
  row.querySelector(".spp-item-account").value = initial.accountNumber || "";
  row.querySelector(".spp-item-bank").value = initial.bankName || "";
  row.querySelector(".spp-item-supplier").value = initial.supplierName || "";
  row.querySelector(".spp-remove-row").addEventListener("click", () => {
    if (tbody.children.length === 1) {
      row.querySelectorAll("input, select").forEach((input) => {
        input.value = "";
      });
      window.selectSppDatabaseItem(row.querySelector(".spp-item-select"));
      window.selectSppDatabaseSupplier(
        row.querySelector(".spp-item-supplier-select"),
      );
    } else row.remove();
    window.updateSppPaymentTotal();
  });
  tbody.appendChild(row);
  window.refreshSppDatabaseOptions(row);
  const itemSelect = row.querySelector(".spp-item-select");
  if (initial.itemId && itemSelect) {
    if (
      ![...itemSelect.options].some(
        (option) => option.value === String(initial.itemId),
      )
    ) {
      itemSelect.add(
        new Option(
          `${initial.itemName || "Barang tersimpan"} · ${initial.unit || ""}`,
          String(initial.itemId),
        ),
      );
    }
    itemSelect.value = String(initial.itemId);
    window.selectSppDatabaseItem(itemSelect);
    row.querySelector(".spp-item-name").value = initial.itemName || "";
    row.querySelector(".spp-item-quantity").value = initial.quantity ?? "";
    row.querySelector(".spp-item-unit").value = initial.unit || "";
    row.querySelector(".spp-item-unit-label").textContent = initial.unit || "";
    row.querySelector(".spp-item-price").value = initial.unitPrice ?? "";
    row.querySelector(".spp-item-amount").value = initial.amount ?? "";
  }
  const supplierSelect = row.querySelector(".spp-item-supplier-select");
  if (initial.supplierId && supplierSelect) {
    if (
      ![...supplierSelect.options].some(
        (option) => option.value === String(initial.supplierId),
      )
    ) {
      supplierSelect.add(
        new Option(
          initial.supplierName || "Supplier tersimpan",
          String(initial.supplierId),
        ),
      );
    }
    supplierSelect.value = String(initial.supplierId);
    window.selectSppDatabaseSupplier(supplierSelect);
  }
  row.querySelector(".spp-item-account").value = initial.accountNumber || "";
  row.querySelector(".spp-item-bank").value = initial.bankName || "";
  row.querySelector(".spp-item-supplier").value = initial.supplierName || "";
  window.updateSppPaymentTotal();
  return row;
};

window.setSppItemDate = function (input) {
  const row = input.closest("tr");
  const dateInput = row?.querySelector(".spp-item-date");
  if (dateInput) dateInput.value = input.value;
  const itemSelect = row?.querySelector(".spp-item-select");
  if (itemSelect) {
    itemSelect.value = "";
    window.refreshSppDatabaseOptions(row);
  }
  const name = row?.querySelector(".spp-item-name");
  const quantity = row?.querySelector(".spp-item-quantity");
  const price = row?.querySelector(".spp-item-price");
  const amount = row?.querySelector(".spp-item-amount");
  const unit = row?.querySelector(".spp-item-unit-label");
  if (name) name.value = "";
  if (quantity) quantity.value = "";
  if (price) price.value = "";
  if (amount) amount.value = "";
  if (unit) unit.textContent = "";
  window.updateSppPaymentTotal();
};

window.addAllSppItemsForDate = function (button) {
  const category = getSppItemCategory();
  const categoryLabel =
    category === "operasional" ? "operasional" : "bahan baku";
  const sourceRow = button.closest("tr");
  const date =
    document.getElementById("sppBulkItemDate")?.value ||
    sourceRow?.querySelector(".spp-item-date")?.value ||
    "";
  if (!date) return showToast("Pilih tanggal barang terlebih dahulu", "error");
  if (!areSppItemsLoaded(category))
    return showToast(`Data barang ${categoryLabel} masih dimuat`, "info");
  if (category === "operasional" && window.appState.barangOperasionalError)
    return showToast(window.appState.barangOperasionalError, "error");
  const items = getSppItems(category).filter(
    (item) => String(item.tanggal || "") === date,
  );
  if (!items.length)
    return showToast(
      `Tidak ada barang ${categoryLabel} pada tanggal tersebut`,
      "info",
    );

  const existingRows = [...document.querySelectorAll("#sppSupplierRows tr")];
  const alreadyAdded = new Set(
    existingRows
      .filter((row) => row.querySelector(".spp-item-date")?.value === date)
      .map((row) => row.querySelector(".spp-item-select")?.value)
      .filter(Boolean),
  );
  const pendingItems = items.filter(
    (item) => !alreadyAdded.has(String(item.id)),
  );
  if (!pendingItems.length)
    return showToast("Semua barang pada tanggal ini sudah ditambahkan", "info");

  let reusableRow =
    existingRows.find(
      (row) =>
        !row.querySelector(".spp-item-select")?.value &&
        !row.querySelector(".spp-item-supplier-select")?.value,
    ) || null;
  if (
    reusableRow &&
    (reusableRow.querySelector(".spp-item-select")?.value ||
      reusableRow.querySelector(".spp-item-supplier-select")?.value)
  )
    reusableRow = null;
  pendingItems.forEach((item) => {
    const row = reusableRow || window.addSppSupplierRow({ itemDate: date });
    reusableRow = null;
    const dateInput = row.querySelector(".spp-item-date");
    if (dateInput) dateInput.value = date;
    const datePicker = row.querySelector(".spp-item-date-picker");
    if (datePicker) datePicker.value = date;
    window.refreshSppDatabaseOptions(row);
    const itemSelect = row.querySelector(".spp-item-select");
    if (itemSelect) {
      itemSelect.value = String(item.id);
      window.selectSppDatabaseItem(itemSelect);
    }
  });
  window.updateSppPaymentTotal();
  showToast(
    `${pendingItems.length} barang ${categoryLabel} berhasil ditambahkan. Pilih supplier untuk setiap barang.`,
    "success",
  );
};

window.updateSppPaymentTotal = function () {
  const amount = [
    ...(document.querySelectorAll(".spp-item-amount") || []),
  ].reduce((sum, input) => sum + (Number(input.value) || 0), 0);
  const output = document.getElementById("sppTotalAmount");
  if (output) output.textContent = `Rp ${amount.toLocaleString("id-ID")}`;
  return amount;
};

function normalizeSppAttachments(attachments) {
  const makeSheets = (photos, layout, allowShortLast = false) => {
    const sheets = [];
    for (let start = 0; start < photos.length; start += layout) {
      const pagePhotos = photos.slice(start, start + layout);
      sheets.push({
        layout: allowShortLast ? pagePhotos.length : layout,
        photos: pagePhotos,
      });
    }
    return sheets;
  };
  if (Array.isArray(attachments))
    return { productLayouts: makeSheets(attachments, 1), invoicePhotos: [] };
  const oldPhotos = Array.isArray(attachments?.productPhotos)
    ? attachments.productPhotos
    : [];
  const productLayouts = Array.isArray(attachments?.productLayouts)
    ? attachments.productLayouts.flatMap((group) =>
        makeSheets(
          Array.isArray(group?.photos) ? group.photos : [],
          Math.min(6, Math.max(1, Number(group?.layout) || 1)),
        ),
      )
    : makeSheets(
        oldPhotos,
        Math.min(6, Math.max(1, Number(attachments?.productPhotoLayout) || 1)),
        true,
      );
  return {
    productLayouts,
    invoicePhotos: Array.isArray(attachments?.invoicePhotos)
      ? attachments.invoicePhotos
      : [],
  };
}

function renderSppAttachmentPreviews() {
  const productPreview = document.getElementById("sppProductPhotoPreviews");
  const productStatus = document.getElementById("sppProductPhotoStatus");
  if (productPreview)
    productPreview.innerHTML = sppProductPhotoLayouts
      .map(
        (group, groupIndex) =>
          `<section class="col-span-full rounded-lg border border-sky-100 bg-sky-50/50 p-2"><div class="mb-2 flex items-center justify-between gap-2"><span class="text-[10px] font-bold text-sky-800">Lembar ${groupIndex + 1} · layout ${group.layout} foto · ${group.photos.length}/${group.layout}</span><button type="button" onclick="removeSppProductLayout(${groupIndex})" class="text-[10px] font-semibold text-rose-600">Hapus lembar</button></div><div class="grid grid-cols-2 gap-2 sm:grid-cols-3">${group.photos.map((photo, photoIndex) => `<figure class="relative overflow-hidden rounded-lg border border-slate-200 bg-white"><img src="${escapeHtml(photo.dataUrl || "")}" alt="${escapeHtml(photo.name || "Lampiran")}" class="h-24 w-full object-cover"><figcaption class="truncate p-1.5 pr-7 text-[9px] text-slate-500">${escapeHtml(photo.name || "Lampiran")}</figcaption><button type="button" onclick="removeSppAttachment('product', ${groupIndex}, ${photoIndex})" aria-label="Hapus ${escapeHtml(photo.name || "foto")}" class="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/95 text-rose-600 shadow"><i class="fa-solid fa-xmark"></i></button></figure>`).join("")}</div></section>`,
      )
      .join("");
  const productCount = sppProductPhotoLayouts.reduce(
    (sum, group) => sum + group.photos.length,
    0,
  );
  if (productStatus)
    productStatus.textContent = sppProductPhotoLayouts.length
      ? `${sppProductPhotoLayouts.length} lembar foto barang (${productCount} foto).`
      : "Belum ada lembar foto barang.";
  const renderGroup = (photos, kind, previewId, statusId) => {
    const preview = document.getElementById(previewId);
    const status = document.getElementById(statusId);
    if (preview)
      preview.innerHTML = photos
        .map(
          (photo, index) =>
            `<figure class="relative overflow-hidden rounded-lg border border-slate-200"><img src="${escapeHtml(photo.dataUrl || "")}" alt="${escapeHtml(photo.name || "Lampiran")}" class="h-24 w-full object-cover"><figcaption class="truncate p-1.5 pr-7 text-[9px] text-slate-500">${escapeHtml(photo.name || "Lampiran")}</figcaption><button type="button" onclick="removeSppAttachment('${kind}', ${index})" aria-label="Hapus ${escapeHtml(photo.name || "foto")}" class="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/95 text-rose-600 shadow"><i class="fa-solid fa-xmark"></i></button></figure>`,
        )
        .join("");
    if (status)
      status.textContent = photos.length
        ? `${photos.length} foto nota · ${photos.length} halaman.`
        : "Belum ada foto nota.";
  };
  renderGroup(
    sppInvoicePhotos,
    "invoice",
    "sppInvoicePhotoPreviews",
    "sppInvoicePhotoStatus",
  );
}

window.setSppProductPhotoLayout = function (value) {
  sppProductPhotoLayout = Math.min(6, Math.max(1, Number(value) || 1));
};

window.addSppProductPhotoLayout = function () {
  const layout = Math.min(
    6,
    Math.max(
      1,
      Number(document.getElementById("sppProductPhotoLayout")?.value) || 1,
    ),
  );
  sppProductPhotoLayout = layout;
  const incomplete = sppProductPhotoLayouts.find(
    (group) => group.photos.length < group.layout,
  );
  if (incomplete) {
    showToast(
      `Lengkapi lembar layout ${incomplete.layout} terlebih dahulu (${incomplete.photos.length}/${incomplete.layout} foto)`,
      "info",
    );
    document.getElementById("sppProductPhotoFiles")?.click();
    return;
  }
  sppProductPhotoLayouts.push({ layout, photos: [] });
  renderSppAttachmentPreviews();
  document.getElementById("sppProductPhotoFiles")?.click();
};

window.removeSppProductLayout = function (layoutIndex) {
  sppProductPhotoLayouts.splice(layoutIndex, 1);
  renderSppAttachmentPreviews();
};

window.removeSppAttachment = function (kind, groupIndex, photoIndex) {
  if (kind === "invoice") sppInvoicePhotos.splice(groupIndex, 1);
  else {
    const group = sppProductPhotoLayouts[groupIndex];
    group?.photos.splice(photoIndex, 1);
    if (group && !group.photos.length)
      sppProductPhotoLayouts.splice(groupIndex, 1);
  }
  renderSppAttachmentPreviews();
};

window.clearSppAttachments = function (kind) {
  if (kind === "invoice") sppInvoicePhotos = [];
  else sppProductPhotoLayouts = [];
  renderSppAttachmentPreviews();
};

function getSppPhotoDate(value) {
  if (!value) return "";
  const text = String(value);
  const isoDate = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : getLocalDateString(parsed);
}

window.loadSppDatabaseProductPhotos = async function () {
  const dateInput = document.getElementById("sppProductPhotoDate");
  const list = document.getElementById("sppDatabaseProductPhotoList");
  const status = document.getElementById("sppDatabaseProductPhotoStatus");
  if (!dateInput || !list || !status) return;
  const selectedDate = dateInput.value;
  const loadVersion = ++sppDatabasePhotoLoadVersion;
  list.innerHTML = "";
  if (!selectedDate) {
    sppDatabaseProductPhotos = [];
    status.textContent = "Pilih tanggal untuk mencari foto penerimaan barang.";
    return;
  }

  const category = getSppItemCategory();
  const categoryLabel =
    category === "operasional" ? "operasional" : "bahan baku";
  if (!areSppItemsLoaded(category)) {
    status.textContent = `Memuat barang ${categoryLabel} dari database...`;
    return;
  }
  if (category === "operasional" && window.appState.barangOperasionalError) {
    status.textContent = window.appState.barangOperasionalError;
    return;
  }
  const items = getSppItems(category).filter((item) => {
    const matchingArrival = (
      Array.isArray(item.arrivalHistory) ? item.arrivalHistory : []
    ).some(
      (arrival) =>
        getSppPhotoDate(arrival.receivedAt || arrival.recordedAt) ===
        selectedDate,
    );
    return (
      getSppPhotoDate(item.tanggal || item.date) === selectedDate ||
      matchingArrival
    );
  });
  status.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Memuat foto dari database...';
  const photos = await Promise.all(
    items.map(async (item) => {
      const matchingArrivals = (
        Array.isArray(item.arrivalHistory) ? item.arrivalHistory : []
      )
        .filter(
          (entry) =>
            getSppPhotoDate(entry.receivedAt || entry.recordedAt) ===
            selectedDate,
        )
        .sort((a, b) =>
          String(b.recordedAt || b.receivedAt || "").localeCompare(
            String(a.recordedAt || a.receivedAt || ""),
          ),
        );
      const arrival =
        matchingArrivals[0] ||
        (getSppPhotoDate(item.tanggal || item.date) === selectedDate
          ? getLatestArrival(item)
          : null);
      let dataUrl =
        arrival?.photoDataUrl ||
        (arrival?.photoId
          ? window.appState?.arrivalPhotoCache?.[arrival.photoId]
          : "") ||
        arrival?.photoUrl ||
        item.fotoPenerimaan ||
        item.foto ||
        item.fotoUrl ||
        item.imageUrl ||
        (!arrival?.photoId ? item.img : "") ||
        "";
      if (!dataUrl && arrival?.photoId) {
        try {
          const snapshot = await getDoc(
            doc(db, "barang_arrival_photos", String(arrival.photoId)),
          );
          const photoData = snapshot.exists() ? snapshot.data() : null;
          dataUrl =
            photoData?.dataUrl ||
            photoData?.base64 ||
            photoData?.foto ||
            photoData?.image ||
            "";
          if (dataUrl) {
            window.appState.arrivalPhotoCache ||= {};
            window.appState.arrivalPhotoCache[arrival.photoId] = dataUrl;
          }
        } catch (error) {
          console.warn("Foto penerimaan tidak dapat dimuat:", error);
        }
      }
      if (
        !dataUrl ||
        (!/^data:image\//i.test(dataUrl) && !/^https?:\/\//i.test(dataUrl))
      )
        return null;
      return {
        key: `${item.id || item.nama || item.name}-${arrival?.photoId || "item"}`,
        name: item.nama || item.name || "Foto barang",
        dataUrl,
        date: selectedDate,
        detail:
          `${item.satuan || item.unit || ""}${arrival?.jumlah ? ` · ${arrival.jumlah} ${item.satuan || item.unit || ""}` : ""}`.trim(),
      };
    }),
  );
  if (
    loadVersion !== sppDatabasePhotoLoadVersion ||
    dateInput.value !== selectedDate
  )
    return;
  sppDatabaseProductPhotos = photos.filter(Boolean);
  if (!sppDatabaseProductPhotos.length) {
    status.textContent = items.length
      ? "Tidak ada foto penerimaan tersimpan untuk tanggal ini."
      : `Tidak ada barang ${categoryLabel} di database pada tanggal ini.`;
    return;
  }
  status.textContent = `${sppDatabaseProductPhotos.length} foto barang ditemukan. Pilih foto, lalu tambahkan ke lembar layout yang aktif.`;
  list.innerHTML = sppDatabaseProductPhotos
    .map(
      (photo, index) =>
        `<label class="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 p-2 hover:border-sky-300"><input type="checkbox" class="spp-db-product-photo h-4 w-4 accent-sky-700" value="${index}"><img src="${escapeHtml(photo.dataUrl)}" alt="${escapeHtml(photo.name)}" class="h-14 w-14 rounded-md object-cover"><span class="min-w-0 flex-1"><span class="block truncate text-[10px] font-semibold text-slate-700">${escapeHtml(photo.name)}</span><span class="block text-[9px] text-slate-500">${escapeHtml(photo.date)}${photo.detail ? ` · ${escapeHtml(photo.detail)}` : ""}</span></span></label>`,
    )
    .join("");
};

window.addSelectedSppDatabaseProductPhotos = function () {
  const targetGroup = sppProductPhotoLayouts.find(
    (group) => group.photos.length < group.layout,
  );
  if (!targetGroup)
    return showToast(
      "Tambah lembar foto dan pilih layout terlebih dahulu",
      "info",
    );
  const selected = [
    ...document.querySelectorAll(".spp-db-product-photo:checked"),
  ]
    .map((input) => sppDatabaseProductPhotos[Number(input.value)])
    .filter(Boolean);
  if (!selected.length)
    return showToast("Pilih setidaknya satu foto barang", "info");
  const remaining = targetGroup.layout - targetGroup.photos.length;
  if (selected.length > remaining)
    return showToast(
      `Layout ini hanya membutuhkan ${remaining} foto lagi`,
      "error",
    );
  targetGroup.photos.push(
    ...selected.map((photo) => ({ name: photo.name, dataUrl: photo.dataUrl })),
  );
  renderSppAttachmentPreviews();
  document
    .querySelectorAll(".spp-db-product-photo:checked")
    .forEach((input) => {
      input.checked = false;
    });
};

window.prepareSppAttachments = async function (event, kind = "product") {
  const files = [...(event.target.files || [])];
  const targetGroup =
    kind === "invoice"
      ? null
      : sppProductPhotoLayouts.find(
          (group) => group.photos.length < group.layout,
        );
  const photos = kind === "invoice" ? sppInvoicePhotos : targetGroup?.photos;
  const status = document.getElementById(
    kind === "invoice" ? "sppInvoicePhotoStatus" : "sppProductPhotoStatus",
  );
  if (kind === "product" && !targetGroup) {
    event.target.value = "";
    if (status)
      status.textContent = "Tambahkan lembar dan pilih layout terlebih dahulu.";
    return showToast("Klik Tambah lembar foto lalu pilih layout 1–6", "info");
  }
  if (
    files.some(
      (file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type),
    )
  ) {
    event.target.value = "";
    if (status) status.textContent = "Format foto harus JPG, PNG, atau WebP.";
    return showToast("Pilih foto dengan format JPG, PNG, atau WebP", "error");
  }
  const maxCount =
    kind === "product" ? targetGroup.layout - photos.length : 8 - photos.length;
  if (files.length > maxCount) {
    event.target.value = "";
    if (status)
      status.textContent =
        kind === "product"
          ? `Layout lembar ini maksimal ${targetGroup.layout} foto.`
          : "Maksimal 8 foto nota.";
    return showToast(
      kind === "product"
        ? `Pilih maksimal ${maxCount} foto lagi untuk layout ${targetGroup.layout}`
        : "Maksimal 8 foto nota",
      "error",
    );
  }
  if (status)
    status.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Mengompres foto...';
  try {
    const compressedPhotos = [];
    for (const file of files) {
      const compressed = await compressArrivalPhoto(file);
      compressedPhotos.push({ name: file.name, dataUrl: compressed.dataUrl });
    }
    photos.push(...compressedPhotos);
    renderSppAttachmentPreviews();
  } catch (error) {
    if (status)
      status.textContent = error.message || "Foto lampiran gagal diproses.";
    showToast(error.message || "Foto lampiran gagal diproses", "error");
  } finally {
    event.target.value = "";
  }
};

function showSppPreview(data, isSample = false) {
  const settings = data.header || getSppHeaderSettings();
  const safe = (value) => escapeHtml(String(value ?? "").trim());
  const foundation = safe(settings.foundationName || "Nama Yayasan");
  const kitchen = safe(settings.kitchenName || "Nama SPPG / Dapur");
  const address = safe(settings.kitchenAddress || "Alamat SPPG");
  const phone = safe(settings.kitchenPhone || "");
  const leftLogoUrl =
    typeof (settings.leftLogoDataUrl || settings.foundationLogoDataUrl) ===
      "string" &&
    (settings.leftLogoDataUrl || settings.foundationLogoDataUrl).startsWith(
      "data:image/",
    )
      ? settings.leftLogoDataUrl || settings.foundationLogoDataUrl
      : "";
  const rightLogoUrl =
    typeof settings.rightLogoDataUrl === "string" &&
    settings.rightLogoDataUrl.startsWith("data:image/")
      ? settings.rightLogoDataUrl
      : "";
  const logoUrl = leftLogoUrl;
  const total = data.suppliers.reduce(
    (sum, supplier) => sum + Number(supplier.amount || 0),
    0,
  );
  const supplierRows = data.suppliers
    .map(
      (supplier, index) =>
        `<tr><td class="center">${index + 1}</td><td>${safe(supplier.itemName)}</td><td class="number">${Number(supplier.quantity || 0).toLocaleString("id-ID")}</td><td class="center">${safe(supplier.unit)}</td><td class="number">Rp ${Number(supplier.unitPrice || 0).toLocaleString("id-ID")}</td><td class="number">Rp ${Number(supplier.amount || 0).toLocaleString("id-ID")}</td><td>${safe(supplier.accountNumber)}</td><td>${safe(supplier.bankName)}</td><td>${safe(supplier.supplierName)}</td></tr>`,
    )
    .join("");
  const totalRow = `<tr class="sumrow"><td colspan="5" class="center"><b>JUMLAH</b></td><td class="number"><b>Rp ${total.toLocaleString("id-ID")}</b></td><td colspan="3"></td></tr>`;
  const attachments = normalizeSppAttachments(data.attachments);
  const productCollages = attachments.productLayouts.map(
    (group, index) =>
      `<article class="product-collage"><h3>FOTO BARANG · LAYOUT ${index + 1} (${group.layout} FOTO)</h3><div class="product-photo-grid layout-${group.layout}">${group.photos.map((photo) => `<figure><img src="${safe(photo.dataUrl)}" alt="${safe(photo.name)}"><figcaption>${safe(photo.name)}</figcaption></figure>`).join("")}</div></article>`,
  );
  const productPhotoSheets = [];
  for (let start = 0; start < productCollages.length; start += 2) {
    productPhotoSheets.push(
      `<section class="attachment-sheet product-sheet"><div class="product-collage-stack">${productCollages.slice(start, start + 2).join("")}</div></section>`,
    );
  }
  const invoicePhotoSheets = attachments.invoicePhotos.map(
    (photo, index) =>
      `<section class="attachment-sheet invoice-sheet"><h3>FOTO NOTA · LEMBAR ${index + 1}/${attachments.invoicePhotos.length}</h3><figure><img src="${safe(photo.dataUrl)}" alt="${safe(photo.name)}"><figcaption>${safe(photo.name)}</figcaption></figure></section>`,
  );
  const hasAttachments =
    productPhotoSheets.length + invoicePhotoSheets.length > 0;
  const attachmentsHtml = hasAttachments
    ? [...productPhotoSheets, ...invoicePhotoSheets].join("")
    : `<p class="empty-attachments">${isSample ? "Contoh lampiran foto barang dan foto nota akan ditampilkan di halaman ini." : "Tidak ada foto barang atau foto nota yang dilampirkan."}</p>`;
  const purpose = safe(data.purpose).replace(/\r?\n/g, "<br>");
  const recipientAddress = safe(data.recipientAddress).replace(
    /\r?\n/g,
    "<br>",
  );
  const place = safe(settings.kitchenAddress || kitchen);
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#e8edf2;color:#111;font:10px/1.45 Arial,sans-serif}.page{position:relative;width:210mm;min-height:297mm;margin:16px auto;padding:18mm 19mm;background:#fff;box-shadow:0 4px 20px #0002}.page-two{page-break-before:always}.kop{display:flex;align-items:center;justify-content:center;gap:12px;text-align:center;border-bottom:3px double #111;padding:0 0 9px}.logo{width:62px;height:62px;object-fit:contain;flex:none}.koptext{flex:1}.foundation{font-size:12px;font-weight:bold;text-transform:uppercase}.kitchen{font-size:12px;font-weight:bold;text-transform:uppercase;margin-top:2px}.address,.contact{font-size:9px}.doc-title{text-align:center;font-weight:bold;margin:10px 0 14px;font-size:11px}.letter-number{margin:-8px 0 9px;text-align:center;font-size:9px}.properties{margin:0 0 2px}.recipient{margin:0 0 12px}.intro{margin:0 0 8px;text-align:justify}.summary-title{margin:10px auto 0;width:68%;border:1px solid #111;background:#dbe7f8;text-align:center;font-weight:bold;padding:3px}.summary-subtitle{margin:0 auto;width:68%;border:1px solid #111;border-top:0;background:#dbe7f8;text-align:center;font-weight:bold;padding:3px}.summary-date{margin:0 auto 8px;width:68%;border:1px solid #111;border-top:0;background:#dbe7f8;text-align:center;padding:3px}table{width:100%;border-collapse:collapse;font-size:8px;table-layout:fixed}th,td{border:1px solid #111;padding:5px 4px;overflow-wrap:anywhere;vertical-align:middle}th{background:#c9ddf2;text-align:center;font-weight:bold}.number{text-align:right;white-space:nowrap}.center{text-align:center}.sumrow td{background:#dbe7f8}.closing{margin:12px 0 0;text-align:justify}.date{text-align:right;margin:8px 0}.signature-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:center;margin-top:12px;font-size:9px}.signature{min-height:86px}.signature .gap{height:42px}.sign-name{font-weight:bold;text-decoration:underline}.head-sign{text-align:center;margin:4px auto 0;width:50%;font-size:9px}.head-sign .gap{height:44px}.page-heading{text-align:center;font-weight:bold;font-size:11px;margin:0 0 14px}.attachments{display:block}.attachment-sheet{break-inside:avoid;page-break-inside:avoid;min-height:238mm;padding:3mm 0}.attachment-sheet+.attachment-sheet{break-before:page;page-break-before:always}.attachment-sheet h3{text-align:center;font-size:11px;margin:0 0 8mm}.product-photo-grid{display:grid;gap:6mm;align-content:start}.product-photo-grid.layout-1,.product-photo-grid.layout-2{grid-template-columns:1fr}.product-photo-grid.layout-3,.product-photo-grid.layout-4{grid-template-columns:repeat(2,minmax(0,1fr))}.product-photo-grid.layout-5,.product-photo-grid.layout-6{grid-template-columns:repeat(3,minmax(0,1fr))}.product-photo-grid figure,.invoice-sheet figure{min-width:0;margin:0;border:1px solid #cbd5e1;padding:3mm;break-inside:avoid}.product-photo-grid img{display:block;width:100%;object-fit:contain}.product-photo-grid.layout-1 img{height:215mm}.product-photo-grid.layout-2 img{height:103mm}.product-photo-grid.layout-3 img,.product-photo-grid.layout-4 img{height:96mm}.product-photo-grid.layout-5 img,.product-photo-grid.layout-6 img{height:74mm}.invoice-sheet figure{height:232mm;display:flex;flex-direction:column;align-items:center;justify-content:center}.invoice-sheet img{display:block;width:100%;height:218mm;object-fit:contain}.attachment-sheet figcaption{margin-top:2mm;text-align:center;font-size:9px;overflow-wrap:anywhere}.empty-attachments{text-align:center;margin-top:30px;color:#666}.sample{position:absolute;right:19mm;top:6mm;font-size:8px;color:#94a3b8}@page{size:A4;margin:0}@media print{body{background:#fff}.page{width:210mm;min-height:297mm;margin:0;padding:18mm 19mm;box-shadow:none;page-break-after:always}.page:last-child{page-break-after:auto}.page-two.empty{display:none}.sample{display:none}}</style></head><body><main class="page">${isSample ? '<span class="sample">CONTOH TEMPLATE</span>' : ""}<header class="kop">${logoUrl ? `<img class="logo" src="${safe(logoUrl)}" alt="Logo">` : ""}<div class="koptext"><div class="foundation">${foundation}</div><div class="kitchen">${kitchen}</div><div class="address">${address}</div>${phone ? `<div class="contact">Telp. ${phone}</div>` : ""}</div></header><div class="doc-title">SURAT PERMINTAAN PEMBAYARAN</div><div class="letter-number">Nomor: ${safe(data.number)}</div><div class="properties">Sifat : ${safe(data.urgency)}<br>Perihal : ${safe(data.category)}</div><div class="recipient">Kepada Yth.<br><b>${safe(data.recipient)}</b>${recipientAddress ? `<br>${recipientAddress}` : ""}<br>Di Tempat</div><p class="intro">Sehubungan dengan pelaksanaan kegiatan Makan Bergizi Gratis tanggal ${safe(formatLetterDate(data.date))} di SPPG ${kitchen}, ${address}, maka kami mengajukan permintaan pembayaran dana belanja (kategori: ${safe(data.category)}). Biaya kepada pihak supplier sebagaimana rincian berikut:</p><div class="summary-title">REKAP BIAYA ${safe(data.category).toLocaleUpperCase("id-ID")}</div><div class="summary-subtitle">${kitchen.toLocaleUpperCase("id-ID")}</div><div class="summary-date">TANGGAL (${safe(formatLetterDate(data.date))})</div><table><thead><tr><th style="width:5%">NO</th><th style="width:18%">NAMA BARANG</th><th style="width:8%">QTY</th><th style="width:8%">SATUAN</th><th style="width:12%">HARGA SATUAN</th><th style="width:14%">TOTAL</th><th style="width:14%">NOMOR REKENING</th><th style="width:8%">NAMA BANK</th><th style="width:13%">NAMA SUPPLIER</th></tr></thead><tbody>${supplierRows}${totalRow}</tbody></table><p class="intro">Total pembayaran sebesar <b>Rp ${total.toLocaleString("id-ID")}</b> (<i>${safe(terbilangRupiah(total))}</i>). ${purpose}</p><p class="closing">Demikian surat permintaan pembayaran ini kami buat dan ajukan untuk digunakan sebagaimana mestinya. Atas perhatiannya kami ucapkan terima kasih.</p><p class="date">${place}, ${safe(formatLetterDate(data.date))}</p><div class="signature-grid"><div class="signature">Mengetahui,<br>PIC SPPG ${kitchen}<div class="gap"></div><div class="sign-name">${safe(data.picName)}</div></div><div class="signature">Akuntan SPPG ${kitchen}<div class="gap"></div><div class="sign-name">${safe(data.accountantName)}</div></div></div><div class="head-sign">Kepala SPPG ${kitchen}<div class="gap"></div><div class="sign-name">${safe(data.headName)}</div></div></main><section class="page page-two${hasAttachments ? "" : " empty"}"><div class="attachments">${attachmentsHtml}</div></section></body></html>`;
  const frame = document.getElementById("sppPreviewFrame");
  if (!frame) return;
  const itemCategoryLabel =
    data.itemCategory === "operasional" ? "Operasional" : "Bahan Baku";
  frame.srcdoc = html
    .replace(
      `Perihal : ${safe(data.category)}`,
      `Jenis barang : ${itemCategoryLabel}<br>Perihal : ${safe(data.category)}`,
    )
    .replace(
      '<div class="koptext">',
      `${rightLogoUrl ? `<img class="logo logo-right" src="${safe(rightLogoUrl)}" alt="Logo kanan">` : ""}<div class="koptext">`,
    )
    .replace('alt="Logo"', 'alt="Logo kiri"')
    .replace(
      "</head>",
      `<style>
    .logo-right{order:3}
    .summary-title,.summary-subtitle,.summary-date{width:100%;margin-left:0;margin-right:0}
    .attachment-sheet{height:auto;min-height:0;padding:0;overflow:visible;display:block;break-inside:avoid;page-break-inside:avoid}
    .attachment-sheet h3{margin:0 0 2mm;font-size:8px;line-height:1}
    .product-sheet{height:250mm;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .product-collage-stack{width:100%;height:216mm;display:grid;grid-template-rows:repeat(2,108mm);align-content:center;justify-items:center;gap:0}
    .product-collage{width:100%;height:108mm;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;overflow:hidden}
    .product-collage h3{height:5mm;margin:0;font-size:8px;line-height:1}
    .product-photo-grid{width:120mm;height:auto;max-width:100%;gap:0;grid-auto-flow:row;align-content:start;margin:0 auto}
    .product-photo-grid.layout-1{width:70mm;grid-template-columns:1fr;grid-template-rows:1fr}
    .product-photo-grid.layout-2{width:120mm;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:1fr}
    .product-photo-grid.layout-3,.product-photo-grid.layout-4{width:120mm;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr))}
    .product-photo-grid.layout-5,.product-photo-grid.layout-6{width:120mm;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr))}
    .product-photo-grid figure{width:100%;height:55mm;min-height:0;padding:0;border:0;border-radius:0;margin:0;overflow:hidden;line-height:0}
    .product-photo-grid.layout-1 figure{height:70mm}
    .product-photo-grid.layout-2 figure{height:55mm}
    .product-photo-grid.layout-3 figure,.product-photo-grid.layout-4 figure{height:48mm}
    .product-photo-grid.layout-5 figure,.product-photo-grid.layout-6 figure{height:42mm}
    .product-photo-grid img{display:block;width:100%;height:100%;object-fit:cover}
    .product-photo-grid.layout-1 img,.product-photo-grid.layout-2 img,.product-photo-grid.layout-3 img,.product-photo-grid.layout-4 img,.product-photo-grid.layout-5 img,.product-photo-grid.layout-6 img{height:100%}
    .product-photo-grid figcaption{display:none}
    .invoice-sheet{height:250mm;display:flex;flex-direction:column;align-items:center;justify-content:center}
    .invoice-sheet h3{margin:0 0 3mm;font-size:8px}
    .invoice-sheet figure{width:85mm;height:75mm;margin:0;border:0;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
    .invoice-sheet img{width:100%;height:68mm;max-width:85mm;object-fit:contain}
    .invoice-sheet figcaption{margin-top:1mm;font-size:7px;line-height:1.1;max-width:100%;overflow-wrap:anywhere}
    @media print{.attachment-sheet+.attachment-sheet{break-before:page;page-break-before:always}}
  </style></head>`,
    );
  document.getElementById("sppPreviewTitle").textContent = isSample
    ? "Contoh Template Surat Permintaan Pembayaran"
    : "Pratinjau Surat Permintaan Pembayaran";
  document.getElementById("sppPreviewModal").classList.remove("hidden");
  document.getElementById("sppPreviewModal").classList.add("flex");
}

window.openSppForm = function () {
  const form = document.querySelector("#sppFormModal form");
  form?.reset();
  sppEditingLetterId = "";
  document.getElementById("sppLetterId").value = "";
  document.getElementById("sppFormTitle").textContent =
    "Buat Surat Permintaan Pembayaran";
  const submitButton = form?.querySelector("button[type='submit']");
  if (submitButton)
    submitButton.innerHTML =
      '<i class="fa-solid fa-eye mr-1"></i>Simpan &amp; Pratinjau';
  const today = getLocalDateString();
  sppProductPhotoLayouts = [];
  sppInvoicePhotos = [];
  sppProductPhotoLayout = 1;
  sppDatabaseProductPhotos = [];
  document.getElementById("sppProductPhotoLayout").value = "1";
  document.getElementById("sppProductPhotoDate").value = today;
  document.getElementById("sppProductPhotoFiles").value = "";
  document.getElementById("sppInvoicePhotoFiles").value = "";
  renderSppAttachmentPreviews();
  document.getElementById("sppSupplierRows").innerHTML = "";
  window.setSppItemCategory("bahan_baku");
  document.getElementById("sppLetterDate").value = today;
  document.getElementById("sppBulkItemDate").value = today;
  window.addSppSupplierRow();
  document
    .querySelectorAll("#sppSupplierRows .spp-item-date")
    .forEach((input) => {
      if (!input.value) input.value = today;
    });
  const settings = getSppHeaderSettings();
  document.getElementById("sppRecipient").value = settings.foundationName
    ? `Ketua ${settings.foundationName}`
    : "";
  window.refreshSppDatabaseOptions();
  const modal = document.getElementById("sppFormModal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  window.loadSppDatabaseProductPhotos();
};

window.editSavedSppLetter = function (letterId) {
  const letter = (window.appState.sppLetters || []).find(
    (entry) => String(entry.id) === String(letterId),
  );
  if (!letter) return showToast("Surat tidak ditemukan", "error");

  window.openSppForm();
  window.setSppItemCategory(
    letter.itemCategory === "operasional" ? "operasional" : "bahan_baku",
  );
  sppEditingLetterId = String(letter.id);
  document.getElementById("sppLetterId").value = sppEditingLetterId;
  document.getElementById("sppFormTitle").textContent =
    "Edit Surat Permintaan Pembayaran";
  const submitButton = document.querySelector(
    "#sppFormModal form button[type='submit']",
  );
  if (submitButton)
    submitButton.innerHTML =
      '<i class="fa-solid fa-floppy-disk mr-1"></i>Simpan Perubahan &amp; Pratinjau';

  document.getElementById("sppLetterNumber").value = letter.number || "";
  document.getElementById("sppLetterDate").value = letter.date || "";
  document.getElementById("sppUrgency").value = letter.urgency || "Segera";
  document.getElementById("sppRecipient").value = letter.recipient || "";
  document.getElementById("sppRecipientAddress").value =
    letter.recipientAddress || "";
  document.getElementById("sppCategory").value = letter.category || "";
  document.getElementById("sppPurpose").value = letter.purpose || "";
  document.getElementById("sppBulkItemDate").value =
    letter.suppliers?.[0]?.itemDate || letter.date || getLocalDateString();

  document.getElementById("sppSupplierRows").innerHTML = "";
  const suppliers = Array.isArray(letter.suppliers) ? letter.suppliers : [];
  (suppliers.length ? suppliers : [{}]).forEach((supplier) => {
    window.addSppSupplierRow({
      ...supplier,
      itemDate: supplier.itemDate || letter.date || "",
    });
  });

  const savedAttachments = normalizeSppAttachments(letter.attachments);
  sppProductPhotoLayouts = savedAttachments.productLayouts.map((group) => ({
    layout: group.layout,
    photos: [...group.photos],
  }));
  sppInvoicePhotos = [...savedAttachments.invoicePhotos];
  sppProductPhotoLayout = sppProductPhotoLayouts.at(-1)?.layout || 1;
  document.getElementById("sppProductPhotoLayout").value = String(
    sppProductPhotoLayout,
  );
  renderSppAttachmentPreviews();
  window.updateSppPaymentTotal();
};

window.closeSppForm = function () {
  const modal = document.getElementById("sppFormModal");
  modal?.classList.add("hidden");
  modal?.classList.remove("flex");
};

window.closeSppPreview = function () {
  const modal = document.getElementById("sppPreviewModal");
  modal?.classList.add("hidden");
  modal?.classList.remove("flex");
};

window.printSppPreview = function () {
  const frame = document.getElementById("sppPreviewFrame");
  if (!frame?.contentWindow)
    return showToast("Pratinjau surat belum siap", "error");
  frame.contentWindow.focus();
  frame.contentWindow.print();
};

window.previewSppTemplate = function () {
  showSppPreview(
    {
      number: "001/SPPG/2026",
      date: getLocalDateString(),
      urgency: "Segera",
      recipient: "Ketua Yayasan Rizqy Aneka Prima",
      recipientAddress: "Di Tempat",
      category: "Permintaan Pembayaran Dana Belanja Bahan Baku",
      purpose: "Untuk belanja bahan baku kegiatan Makan Bergizi Gratis.",
      suppliers: [
        {
          itemName: "Beras",
          quantity: 120,
          unit: "Kg",
          unitPrice: 20000,
          amount: 2400000,
          accountNumber: "1234567890",
          bankName: "BRI",
          supplierName: "Toko Pangan Sejahtera",
        },
        {
          itemName: "Telur Ayam",
          quantity: 90,
          unit: "Kg",
          unitPrice: 15000,
          amount: 1350000,
          accountNumber: "0987654321",
          bankName: "BSI",
          supplierName: "UD Sumber Rezeki",
        },
      ],
      attachments: { productLayouts: [], invoicePhotos: [] },
      picName: "Nama PIC SPPG",
      accountantName: "Nama Akuntan",
      headName: "Nama Kepala SPPG",
    },
    true,
  );
};

window.generateSppLetter = function (event) {
  event.preventDefault();
  const savedSettings = getSppHeaderSettings();
  const data = {
    number: document.getElementById("sppLetterNumber").value.trim(),
    date: document.getElementById("sppLetterDate").value,
    itemCategory: getSppItemCategory(),
    urgency: document.getElementById("sppUrgency").value,
    recipient: document.getElementById("sppRecipient").value.trim(),
    recipientAddress: document
      .getElementById("sppRecipientAddress")
      .value.trim(),
    category: document.getElementById("sppCategory").value.trim(),
    purpose: document.getElementById("sppPurpose").value.trim(),
    suppliers: [...document.querySelectorAll("#sppSupplierRows tr")]
      .map((row) => ({
        itemDate: row.querySelector(".spp-item-date").value,
        itemId: row.querySelector(".spp-item-select").value,
        itemName: row.querySelector(".spp-item-name").value.trim(),
        quantity: Number(row.querySelector(".spp-item-quantity").value || 0),
        unit: row.querySelector(".spp-item-unit").value.trim(),
        unitPrice: Number(row.querySelector(".spp-item-price").value || 0),
        amount: Number(row.querySelector(".spp-item-amount").value || 0),
        accountNumber: row.querySelector(".spp-item-account").value.trim(),
        bankName: row.querySelector(".spp-item-bank").value.trim(),
        supplierId: row.querySelector(".spp-item-supplier-select").value,
        supplierName: row.querySelector(".spp-item-supplier").value.trim(),
      }))
      .filter(
        (row) =>
          row.itemId ||
          row.itemName ||
          row.amount ||
          row.accountNumber ||
          row.bankName ||
          row.supplierId ||
          row.supplierName,
      ),
    attachments: {
      productLayouts: sppProductPhotoLayouts.map((group) => ({
        layout: group.layout,
        photos: [...group.photos],
      })),
      invoicePhotos: [...sppInvoicePhotos],
    },
    picName: String(savedSettings.sppPicName || "").trim(),
    accountantName: String(savedSettings.sppAccountantName || "").trim(),
    headName: String(savedSettings.sppHeadName || "").trim(),
    header: {
      foundationName: savedSettings.foundationName || "",
      foundationLogoDataUrl:
        savedSettings.leftLogoDataUrl ||
        savedSettings.foundationLogoDataUrl ||
        "",
      leftLogoDataUrl:
        savedSettings.leftLogoDataUrl ||
        savedSettings.foundationLogoDataUrl ||
        "",
      rightLogoDataUrl: savedSettings.rightLogoDataUrl || "",
      kitchenName: savedSettings.kitchenName || "",
      kitchenAddress: savedSettings.kitchenAddress || "",
      kitchenPhone: savedSettings.kitchenPhone || "",
    },
  };
  if (!data.picName || !data.accountantName || !data.headName)
    return showToast(
      "Isi nama PIC, akuntan, dan kepala SPPG terlebih dahulu di halaman Setting",
      "error",
    );
  if (!data.date || !data.suppliers.length)
    return showToast(
      "Tanggal dan minimal satu rincian pembayaran harus diisi",
      "error",
    );
  const invalidRow = data.suppliers.some(
    (row) =>
      !row.itemDate ||
      !row.itemId ||
      !row.itemName ||
      row.quantity <= 0 ||
      row.unitPrice <= 0 ||
      row.amount !== row.quantity * row.unitPrice ||
      !row.supplierId ||
      !row.accountNumber ||
      !row.bankName ||
      !row.supplierName,
  );
  if (invalidRow)
    return showToast(
      "Pilih barang sesuai tanggal, isi jumlah pembayaran, dan pilih supplier pada setiap baris",
      "error",
    );
  if (!data.suppliers.some((row) => row.amount > 0))
    return showToast("Jumlah pembayaran harus lebih dari nol", "error");
  const incompleteLayout = data.attachments.productLayouts.find(
    (group) => group.photos.length !== group.layout,
  );
  if (incompleteLayout)
    return showToast(
      `Layout foto barang ${incompleteLayout.layout} harus berisi tepat ${incompleteLayout.layout} foto sebelum disimpan`,
      "error",
    );
  const allAttachments = [
    ...data.attachments.productLayouts.flatMap((group) => group.photos),
    ...data.attachments.invoicePhotos,
  ];
  if (
    allAttachments.reduce(
      (sum, photo) => sum + String(photo.dataUrl || "").length,
      0,
    ) >
    780 * 1024
  ) {
    return showToast(
      "Total ukuran foto barang dan nota terlalu besar untuk disimpan. Kurangi jumlah atau ukuran fotonya.",
      "error",
    );
  }
  const submitButton = document.querySelector(
    "#sppFormModal form button[type='submit']",
  );
  setButtonLoading(
    submitButton,
    true,
    sppEditingLetterId ? "Menyimpan perubahan..." : "Menyimpan surat...",
  );
  const total = data.suppliers.reduce(
    (sum, supplier) => sum + Number(supplier.amount || 0),
    0,
  );
  const now = new Date().toISOString();
  const existingLetter = sppEditingLetterId
    ? (window.appState.sppLetters || []).find(
        (letter) => String(letter.id) === sppEditingLetterId,
      )
    : null;
  const letterRef = sppEditingLetterId
    ? doc(db, "payment_letters", sppEditingLetterId)
    : doc(collection(db, "payment_letters"));
  const savedLetter = {
    ...data,
    type: "surat_permintaan_pembayaran",
    total,
    createdAt: existingLetter?.createdAt || now,
    updatedAt: now,
    createdByEmail:
      existingLetter?.createdByEmail || window.appState.user?.email || "",
    createdByName:
      existingLetter?.createdByName ||
      window.appState.user?.displayName ||
      window.appState.user?.email ||
      "",
  };
  setDoc(letterRef, savedLetter)
    .then(() => {
      savedLetter.id = letterRef.id;
      const nextLetters = new Map(
        (window.appState.sppLetters || []).map((letter) => [
          String(letter.id),
          letter,
        ]),
      );
      nextLetters.set(String(letterRef.id), savedLetter);
      window.appState.sppLetters = [...nextLetters.values()];
      window.appState.sppLettersLoaded = true;
      renderSppLetters();
      sppEditingLetterId = "";
      closeSppForm();
      showSppPreview(savedLetter);
      showToast(
        existingLetter
          ? "Perubahan surat berhasil disimpan"
          : "Surat berhasil disimpan dan masuk ke tabel riwayat",
        "success",
      );
    })
    .catch((error) =>
      showToast(error.message || "Surat gagal disimpan ke Firebase", "error"),
    )
    .finally(() => setButtonLoading(submitButton, false));
};

window.openStockItemModal = function () {
  const form = document.getElementById("formStockItem");
  form?.reset();
  const date = document.getElementById("stockItemOpeningDate");
  if (date) date.value = getLocalDateString();
  document.getElementById("stockItemModal")?.classList.remove("hidden");
  document.getElementById("stockItemModal")?.classList.add("flex");
};

window.closeStockItemModal = function () {
  document.getElementById("stockItemModal")?.classList.add("hidden");
  document.getElementById("stockItemModal")?.classList.remove("flex");
};

window.saveStockItem = async function (event) {
  event.preventDefault();
  const name = document.getElementById("stockItemName").value.trim();
  const unit = document.getElementById("stockItemUnit").value.trim();
  const opening = Number(
    document.getElementById("stockItemOpening").value || 0,
  );
  const date =
    document.getElementById("stockItemOpeningDate").value ||
    getLocalDateString();
  if (!name || !unit || !Number.isFinite(opening) || opening < 0) return;
  const id = getInventoryDocumentId(name, unit);
  const item = {
    nama: name,
    tipe: document.getElementById("stockItemType").value || "Umum",
    satuan: unit,
    datang: opening,
    minimumStock: Number(
      document.getElementById("stockItemMinimum").value || 0,
    ),
    stockHistory:
      opening > 0
        ? [
            {
              type: "masuk",
              quantity: opening,
              stockBefore: 0,
              stockAfter: opening,
              date,
              note: "Saldo awal",
              createdAt: new Date().toISOString(),
            },
          ]
        : [],
  };
  if (!Number.isFinite(item.minimumStock) || item.minimumStock < 0)
    return showToast("Batas minimum harus bernilai nol atau lebih", "error");
  const button = event.submitter;
  if (window.appState.inventoryItems.some((entry) => String(entry.id) === id))
    return showToast(
      "Barang dan satuan tersebut sudah ada di daftar stok",
      "info",
    );
  setButtonLoading(button, true, "Menyimpan...");
  try {
    const existing = await getDoc(doc(db, "inventory_items", id));
    if (existing.exists())
      return showToast(
        "Barang dan satuan tersebut sudah ada di daftar stok",
        "info",
      );
    await setDoc(doc(db, "inventory_items", id), item);
    window.appState.inventoryItems.unshift({ id, ...item });
    renderStockTable();
    renderAdminPwaStock();
    renderAdminPwaDashboard();
    window.closeStockItemModal();
    showToast("Barang stok berhasil ditambahkan", "success");
  } catch (error) {
    showToast(error.message || "Barang stok gagal disimpan", "error");
  } finally {
    setButtonLoading(button, false);
  }
};

window.openStockMinimum = function (itemId) {
  const item = window.appState.inventoryItems.find(
    (entry) => String(entry.id) === String(itemId),
  );
  if (!item) return;
  document.getElementById("stockMinimumItemId").value = item.id;
  document.getElementById("stockMinimumItemName").textContent =
    `${item.nama || item.name || "Barang"} · ${item.satuan || "unit"}`;
  document.getElementById("stockMinimumValue").value = Number(
    item.minimumStock || 0,
  );
  const modal = document.getElementById("stockMinimumModal");
  modal?.classList.remove("hidden");
  modal?.classList.add("flex");
};

window.saveStockMinimum = async function (event) {
  event.preventDefault();
  const itemId = document.getElementById("stockMinimumItemId").value;
  const item = window.appState.inventoryItems.find(
    (entry) => String(entry.id) === String(itemId),
  );
  const minimumStock = Number(
    document.getElementById("stockMinimumValue").value,
  );
  if (!item || !Number.isFinite(minimumStock) || minimumStock < 0)
    return showToast("Isi batas minimum yang valid", "error");
  const button = event.submitter;
  setButtonLoading(button, true, "Menyimpan...");
  try {
    await setDoc(
      doc(db, "inventory_items", itemId),
      { minimumStock },
      { merge: true },
    );
    window.appState.inventoryItems = window.appState.inventoryItems.map(
      (entry) =>
        String(entry.id) === String(itemId)
          ? { ...entry, minimumStock }
          : entry,
    );
    renderStockTable();
    renderAdminPwaStock();
    renderAdminPwaDashboard();
    closeStockModal("stockMinimumModal");
    showToast(
      minimumStock > 0
        ? "Batas minimum stok berhasil disimpan"
        : "Peringatan minimum stok dinonaktifkan",
      "success",
    );
  } catch (error) {
    showToast(error.message || "Batas minimum stok gagal disimpan", "error");
  } finally {
    setButtonLoading(button, false);
  }
};

window.openStockUpdate = function (itemId) {
  const item = window.appState.inventoryItems.find(
    (entry) => String(entry.id) === String(itemId),
  );
  if (!item) return;
  document.getElementById("stockUpdateItemId").value = item.id;
  document.getElementById("stockUpdateItemName").textContent =
    `${item.nama || item.name || "Barang"} - stok saat ini ${Number(item.datang || 0).toLocaleString("id-ID")} ${item.satuan || ""}`;
  document.getElementById("stockUpdateQuantity").value = "";
  document.getElementById("stockUpdateType").value = "masuk";
  const today = new Date();
  document.getElementById("stockUpdateDate").value =
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  document.getElementById("stockUpdateNote").value = "";
  document.getElementById("stockUpdateModal").classList.remove("hidden");
};

window.downloadStockReport = function () {
  const reportDate = document.getElementById("stockReportDate")?.value || "";
  if (!reportDate) {
    showToast("Pilih tanggal laporan stok", "error");
    return;
  }
  const summaryByItem = new Map();
  for (const item of window.appState.inventoryItems) {
    const dayEntries = (
      Array.isArray(item.stockHistory) ? item.stockHistory : []
    )
      .filter((entry) => String(entry.date || "") === reportDate)
      .sort((a, b) =>
        String(a.createdAt || "").localeCompare(String(b.createdAt || "")),
      );
    if (!dayEntries.length) continue;
    const first = dayEntries[0];
    const last = dayEntries[dayEntries.length - 1];
    const unit = String(item.satuan || "").trim();
    const name = String(item.nama || item.name || "Barang").trim();
    const key = `${name.toLocaleLowerCase("id-ID")}::${unit.toLocaleLowerCase("id-ID")}`;
    const opening =
      first.stockBefore != null
        ? Number(first.stockBefore)
        : first.type === "masuk"
          ? Number(first.stockAfter || 0) - Number(first.quantity || 0)
          : first.type === "keluar"
            ? Number(first.stockAfter || 0) + Number(first.quantity || 0)
            : Number(first.stockAfter || first.physicalStock || 0) -
              Number(first.difference || 0);
    const summary = summaryByItem.get(key) || {
      name,
      unit,
      opening: 0,
      incoming: 0,
      outgoing: 0,
      adjustment: 0,
      remaining: 0,
    };
    summary.opening += opening;
    summary.incoming += dayEntries.reduce(
      (sum, entry) =>
        sum + (entry.type === "masuk" ? Number(entry.quantity || 0) : 0),
      0,
    );
    summary.outgoing += dayEntries.reduce(
      (sum, entry) =>
        sum + (entry.type === "keluar" ? Number(entry.quantity || 0) : 0),
      0,
    );
    summary.adjustment += dayEntries.reduce(
      (sum, entry) =>
        sum + (entry.type === "opname" ? Number(entry.difference || 0) : 0),
      0,
    );
    const ending = last.stockAfter ?? last.physicalStock;
    summary.remaining +=
      ending == null
        ? opening + summary.incoming - summary.outgoing + summary.adjustment
        : Number(ending);
    summaryByItem.set(key, summary);
  }
  const summaries = [...summaryByItem.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "id"),
  );
  if (!summaries.length) {
    showToast("Tidak ada transaksi stok pada tanggal tersebut", "info");
    return;
  }
  const date = new Date(`${reportDate}T00:00:00`);
  const dateLabel = Number.isNaN(date.getTime())
    ? reportDate
    : date.toLocaleDateString("id-ID", { dateStyle: "long" });
  const formatQty = (value) => Number(value || 0).toLocaleString("id-ID");
  const tableRows = summaries.map(
    (summary, index) =>
      `<tr><td class="center">${index + 1}</td><td>${escapeHtml(summary.name)}</td><td class="number">${formatQty(summary.opening)}</td><td class="number">${formatQty(summary.incoming)}</td><td class="number">${formatQty(summary.outgoing)}</td><td class="number">${summary.adjustment > 0 ? "+" : ""}${formatQty(summary.adjustment)}</td><td>${escapeHtml(summary.unit)}</td><td class="number"><strong>${formatQty(summary.remaining)}</strong></td></tr>`,
  );
  const reportHtml = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Laporan Stok ${escapeHtml(reportDate)}</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font:10px Arial,sans-serif;color:#111}h1{font-size:16px;text-align:center;margin:0 0 5px}.date{text-align:center;margin:0 0 16px;font-size:11px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #222;padding:7px 6px;vertical-align:top}th{background:#d9edf7;text-align:center;font-weight:bold}.number{text-align:right;white-space:nowrap}.center{text-align:center}tr{break-inside:avoid}@media print{thead{display:table-header-group}}</style></head><body><h1>LAPORAN STOK BARANG</h1><p class="date">Tanggal: ${escapeHtml(dateLabel)}</p><table><thead><tr><th>No.</th><th>Nama Barang</th><th>Barang Awal</th><th>Barang Masuk</th><th>Barang Keluar</th><th>Penyesuaian Opname</th><th>Satuan</th><th>Sisa</th></tr></thead><tbody>${tableRows.join("")}</tbody></table><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),200));</script></body></html>`;
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    showToast("Izinkan pop-up browser untuk membuat PDF laporan", "error");
    return;
  }
  reportWindow.document.open();
  reportWindow.document.write(reportHtml);
  reportWindow.document.close();
  showToast(`${summaries.length} barang dirangkum dalam tabel PDF`, "success");
};

window.openStocktakeReport = function () {
  const records = window.appState.inventoryItems
    .flatMap((item) =>
      (Array.isArray(item.stockHistory) ? item.stockHistory : [])
        .filter((entry) => entry.type === "opname")
        .map((entry) => ({ item, entry })),
    )
    .sort((a, b) =>
      String(b.entry.createdAt || b.entry.date || "").localeCompare(
        String(a.entry.createdAt || a.entry.date || ""),
      ),
    );
  const list = document.getElementById("stocktakeReportList");
  if (!list) return;
  list.innerHTML = records.length
    ? records
        .map(({ item, entry }) => {
          const date = entry.date ? new Date(`${entry.date}T00:00:00`) : null;
          const dateText =
            date && !Number.isNaN(date.getTime())
              ? date.toLocaleDateString("id-ID", { dateStyle: "medium" })
              : "Tanggal tidak tersedia";
          const diff = Number(entry.difference || 0);
          const diffText = `${diff > 0 ? "+" : ""}${diff.toLocaleString("id-ID")} ${item.satuan || ""}`;
          const diffClass =
            diff < 0
              ? "text-rose-700"
              : diff > 0
                ? "text-emerald-700"
                : "text-slate-600";
          return `<article class="rounded-xl border border-slate-200 p-4"><div class="flex flex-wrap items-start justify-between gap-2"><div><h4 class="text-sm font-bold text-slate-800">${escapeHtml(item.nama || item.name || "Barang")}</h4><p class="mt-1 text-[11px] text-slate-500">${escapeHtml(dateText)}${entry.recordedBy ? ` Â· ${escapeHtml(entry.recordedBy)}` : ""}</p></div><strong class="text-sm ${diffClass}">${escapeHtml(diffText)}</strong></div><div class="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-[11px]"><p class="text-slate-500">Sistem<strong class="mt-1 block text-slate-700">${Number(entry.stockBefore ?? 0).toLocaleString("id-ID")} ${escapeHtml(item.satuan || "")}</strong></p><p class="text-slate-500">Fisik<strong class="mt-1 block text-slate-700">${Number(entry.physicalStock ?? entry.stockAfter ?? 0).toLocaleString("id-ID")} ${escapeHtml(item.satuan || "")}</strong></p></div><p class="mt-2 text-xs text-slate-600"><strong>Catatan:</strong> ${escapeHtml(entry.note || "Tidak ada selisih")}</p></article>`;
        })
        .join("")
    : '<div class="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-400">Belum ada catatan stok opname.</div>';
  const modal = document.getElementById("stocktakeReportModal");
  modal?.classList.remove("hidden");
  modal?.classList.add("flex");
};

window.openStocktake = function (itemId) {
  const item = window.appState.inventoryItems.find(
    (entry) => String(entry.id) === String(itemId),
  );
  if (!item) return;
  const balance = Number(item.datang || 0);
  document.getElementById("stocktakeItemId").value = item.id;
  document.getElementById("stocktakeItemName").textContent =
    `${item.nama || item.name || "Barang"} Â· satuan ${item.satuan || "unit"}`;
  document.getElementById("stocktakeSystemBalance").value =
    `${balance.toLocaleString("id-ID")} ${item.satuan || ""}`;
  document.getElementById("stocktakePhysicalBalance").value = balance;
  document.getElementById("stocktakeDate").value = getLocalDateString();
  document.getElementById("stocktakeNote").value = "";
  updateStocktakeDifference();
  const modal = document.getElementById("stocktakeModal");
  modal?.classList.remove("hidden");
  modal?.classList.add("flex");
};

window.updateStocktakeDifference = function () {
  const system = Number(
    window.appState.inventoryItems.find(
      (item) =>
        String(item.id) ===
        String(document.getElementById("stocktakeItemId")?.value),
    )?.datang || 0,
  );
  const physical = Number(
    document.getElementById("stocktakePhysicalBalance")?.value || 0,
  );
  const difference = physical - system;
  const output = document.getElementById("stocktakeDifference");
  const card = document.getElementById("stocktakeDifferenceCard");
  if (output) {
    const sign = difference > 0 ? "+" : "";
    output.textContent = `${sign}${difference.toLocaleString("id-ID")} (fisik âˆ’ sistem)`;
    output.className = `mt-1 text-sm font-extrabold ${difference < 0 ? "text-rose-700" : difference > 0 ? "text-emerald-700" : "text-slate-700"}`;
  }
  if (card)
    card.className = `rounded-xl p-3 ${difference === 0 ? "bg-slate-50" : "bg-amber-50"}`;
  const hint = document.getElementById("stocktakeNoteHint");
  if (hint)
    hint.textContent =
      difference === 0
        ? "Tidak ada selisih. Catatan bersifat opsional."
        : "Catatan wajib diisi untuk menjelaskan selisih stok.";
  return difference;
};

window.submitStocktake = async function (event) {
  event.preventDefault();
  const itemId = document.getElementById("stocktakeItemId").value;
  const item = window.appState.inventoryItems.find(
    (entry) => String(entry.id) === String(itemId),
  );
  const physical = Number(
    document.getElementById("stocktakePhysicalBalance").value,
  );
  const date = document.getElementById("stocktakeDate").value;
  const note = document.getElementById("stocktakeNote").value.trim();
  if (!item || !Number.isFinite(physical) || physical < 0 || !date) return;
  const system = Number(item.datang || 0);
  const difference = physical - system;
  if (difference !== 0 && !note) {
    showToast("Catatan alasan wajib diisi karena ada selisih stok", "error");
    document.getElementById("stocktakeNote").focus();
    return;
  }
  const updatedItem = {
    ...item,
    datang: physical,
    stockHistory: [
      ...(Array.isArray(item.stockHistory) ? item.stockHistory : []),
      {
        type: "opname",
        quantity: Math.abs(difference),
        difference,
        physicalStock: physical,
        date,
        note,
        stockBefore: system,
        stockAfter: physical,
        recordedBy:
          window.appState.user?.email || window.appState.user?.uid || "",
        createdAt: new Date().toISOString(),
      },
    ],
  };
  const button = document.getElementById("stocktakeSubmitButton");
  setButtonLoading(button, true, "Menyimpan...");
  try {
    await setDoc(doc(db, "inventory_items", String(itemId)), updatedItem);
    window.appState.inventoryItems = window.appState.inventoryItems.map(
      (entry) => (String(entry.id) === String(itemId) ? updatedItem : entry),
    );
    renderStockTable();
    renderAdminPwaStock();
    renderAdminPwaDashboard();
    updateDashboardMetrics();
    closeStockModal("stocktakeModal");
    showToast(
      difference === 0
        ? "Stok opname tersimpan, tidak ada selisih"
        : `Stok opname tersimpan Â· selisih ${difference > 0 ? "+" : ""}${difference.toLocaleString("id-ID")} ${item.satuan || ""}`,
      "success",
    );
  } catch (error) {
    showToast(
      error.message || "Stok opname gagal disimpan ke Firestore",
      "error",
    );
  } finally {
    setButtonLoading(button, false);
  }
};

window.submitStockUpdate = async function (event) {
  event.preventDefault();
  const itemId = document.getElementById("stockUpdateItemId").value;
  const item = window.appState.inventoryItems.find(
    (entry) => String(entry.id) === String(itemId),
  );
  const quantity = Number(document.getElementById("stockUpdateQuantity").value);
  if (!item || !Number.isFinite(quantity) || quantity <= 0) return;
  const type = document.getElementById("stockUpdateType").value;
  const currentStock = Number(item.datang || 0);
  if (type === "keluar" && quantity > currentStock) {
    showToast(
      `Stok tidak cukup. Saldo saat ini ${currentStock.toLocaleString("id-ID")} ${item.satuan || ""}.`,
      "error",
    );
    return;
  }
  const date = document.getElementById("stockUpdateDate").value;
  const note = document.getElementById("stockUpdateNote").value.trim();
  if (!date) {
    showToast("Pilih tanggal transaksi stok", "error");
    return;
  }
  const stockAfter = currentStock + (type === "masuk" ? quantity : -quantity);
  const updatedItem = {
    ...item,
    datang: stockAfter,
    stockHistory: [
      ...(Array.isArray(item.stockHistory) ? item.stockHistory : []),
      {
        type,
        quantity,
        date,
        note,
        stockBefore: currentStock,
        stockAfter,
        createdAt: new Date().toISOString(),
      },
    ],
  };
  const saveButton =
    document.getElementById("adminPwaStockSaveButton") || event.submitter;
  setButtonLoading(saveButton, true, "Menyimpan...");
  try {
    await setDoc(doc(db, "inventory_items", String(itemId)), updatedItem);
    window.appState.inventoryItems = window.appState.inventoryItems.map(
      (entry) => (String(entry.id) === String(itemId) ? updatedItem : entry),
    );
    renderStockTable();
    renderAdminPwaStock();
    renderAdminPwaDashboard();
    updateDashboardMetrics();
    showToast(`Transaksi barang ${type} berhasil disimpan`, "success");
  } catch (error) {
    const index = window.appState.inventoryItems.findIndex(
      (entry) => String(entry.id) === String(itemId),
    );
    if (index >= 0) window.appState.inventoryItems[index] = updatedItem;
    renderStockTable();
    renderAdminPwaStock();
    renderAdminPwaDashboard();
    showToast(
      "Stok diperbarui di perangkat ini; gagal tersimpan ke server",
      "error",
    );
  } finally {
    setButtonLoading(saveButton, false);
  }
  closeStockModal("stockUpdateModal");
};

window.openStockHistory = function (itemId) {
  const item = window.appState.inventoryItems.find(
    (entry) => String(entry.id) === String(itemId),
  );
  if (!item) return;
  document.getElementById("stockHistoryItemName").textContent =
    item.nama || item.name || "Barang";
  const historyList = document.getElementById("stockHistoryList");
  const history = Array.isArray(item.stockHistory)
    ? [...item.stockHistory]
    : [];
  history.sort((a, b) =>
    String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)),
  );
  historyList.innerHTML = history.length
    ? history
        .map((entry) => {
          const date = entry.date ? new Date(`${entry.date}T00:00:00`) : null;
          const displayDate =
            date && !Number.isNaN(date.getTime())
              ? date.toLocaleDateString("id-ID", { dateStyle: "medium" })
              : "Tanggal tidak tersedia";
          const isStocktake = entry.type === "opname";
          const type = entry.type === "keluar" ? "keluar" : "masuk";
          const sign = type === "masuk" ? "+" : "-";
          const amountColor = isStocktake
            ? Number(entry.difference || 0) < 0
              ? "text-rose-700"
              : Number(entry.difference || 0) > 0
                ? "text-emerald-700"
                : "text-slate-600"
            : type === "masuk"
              ? "text-emerald-700"
              : "text-rose-700";
          const typeLabel = isStocktake
            ? "Stok Opname"
            : type === "masuk"
              ? "Barang Masuk"
              : "Barang Keluar";
          const recordedAt = entry.createdAt ? new Date(entry.createdAt) : null;
          const recordedText =
            recordedAt && !Number.isNaN(recordedAt.getTime())
              ? recordedAt.toLocaleString("id-ID", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              : "Waktu pencatatan tidak tersedia";
          if (isStocktake) {
            const delta = Number(entry.difference || 0);
            const deltaText = `${delta > 0 ? "+" : ""}${delta.toLocaleString("id-ID")} ${item.satuan || ""}`;
            return `<article class="rounded-xl border border-indigo-100 bg-white p-4 shadow-sm"><div class="flex flex-wrap items-start justify-between gap-3"><div><span class="block text-xs font-semibold text-slate-700">Tanggal opname: ${escapeHtml(displayDate)}</span><span class="mt-1 block text-[10px] text-slate-400">Dicatat: ${escapeHtml(recordedText)}${entry.recordedBy ? ` Â· ${escapeHtml(entry.recordedBy)}` : ""}</span><span class="mt-2 inline-block text-[10px] font-bold uppercase text-indigo-700">Stok Opname</span></div><strong class="text-sm ${amountColor}">Selisih ${escapeHtml(deltaText)}</strong></div><div class="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-[11px]"><p class="text-slate-500">Saldo sistem <strong class="block text-slate-700">${Number(entry.stockBefore ?? 0).toLocaleString("id-ID")} ${escapeHtml(item.satuan || "")}</strong></p><p class="text-slate-500">Hasil fisik <strong class="block text-slate-700">${Number(entry.physicalStock ?? entry.stockAfter ?? 0).toLocaleString("id-ID")} ${escapeHtml(item.satuan || "")}</strong></p></div>${entry.note ? `<p class="mt-3 text-xs text-slate-500"><span class="font-semibold">Catatan:</span> ${escapeHtml(entry.note)}</p>` : ""}</article>`;
          }
          return `<article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div class="flex flex-wrap items-start justify-between gap-3"><div><span class="block text-xs font-semibold text-slate-700">Tanggal transaksi: ${escapeHtml(displayDate)}</span><span class="block text-[10px] text-slate-400 mt-1">Dicatat: ${escapeHtml(recordedText)}</span><span class="inline-block mt-2 text-[10px] font-bold uppercase ${amountColor}">${typeLabel}</span></div><strong class="text-sm ${amountColor}">${sign}${Number(entry.quantity || 0).toLocaleString("id-ID")} ${escapeHtml(item.satuan || "")}</strong></div>${entry.note ? `<p class="text-xs text-slate-500 mt-3"><span class="font-semibold">Catatan:</span> ${escapeHtml(entry.note)}</p>` : ""}</article>`;
        })
        .join("")
    : `<p class="py-8 text-center text-sm text-slate-400">Belum ada riwayat perubahan stok.</p>`;
  document.getElementById("stockHistoryModal").classList.remove("hidden");
  document.getElementById("stockHistoryModal").classList.add("flex");
};

window.filterBarangTable = renderBarangTable;

window.exportBarangReport = function () {
  const searchTerm = (document.getElementById("searchBarang")?.value || "")
    .trim()
    .toLocaleLowerCase("id-ID");
  const filterTipe =
    document.getElementById("filterTipeBarang")?.value || "ALL";
  const dateFrom =
    document.getElementById("filterTanggalMulaiBarang")?.value || "";
  const dateTo =
    document.getElementById("filterTanggalAkhirBarang")?.value || "";
  const filtered = getCurrentBarangItems().filter((item) => {
    const name = (item.nama || item.name || "").toLocaleLowerCase("id-ID");
    const date = String(item.tanggal || "");
    return (
      name.includes(searchTerm) &&
      (filterTipe === "ALL" || item.tipe === filterTipe) &&
      (!dateFrom || date >= dateFrom) &&
      (!dateTo || date <= dateTo)
    );
  });
  if (!filtered.length)
    return showToast("Tidak ada data untuk diekspor", "error");
  const columns = [
    "ID",
    "Nama Barang",
    "Tanggal",
    "Tipe",
    "Harga",
    "Satuan",
    "Kebutuhan",
    "Datang",
    "Status Admin",
    "Status Super Admin",
  ];
  const escapeCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = filtered.map((item) => [
    item.id,
    item.nama || item.name,
    item.tanggal,
    item.tipe,
    item.harga,
    item.satuan,
    item.kebutuhan,
    getItemReceivedQuantity(item),
    item.statusAdmin || "Pending",
    item.statusSuperAdmin || "Pending",
  ]);
  const csv =
    "\uFEFF" +
    [columns, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
  const blobUrl = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = `laporan-${isOperationalPage() ? "barang-operasional" : "barang"}-${getLocalDateString()}.csv`;
  link.click();
  URL.revokeObjectURL(blobUrl);
  showToast(
    `${filtered.length} data ${isOperationalPage() ? "barang operasional" : "barang"} berhasil diekspor`,
    "success",
  );
};

window.openRabModal = function () {
  if (isOperationalPage()) return;
  const today = getLocalDateString();
  const date = new Date();
  document.getElementById("rabDate").value = today;
  document.getElementById("rabStartDate").value = today;
  document.getElementById("rabEndDate").value = today;
  document.getElementById("rabMonth").value = String(date.getMonth() + 1);
  document.getElementById("rabMonthYear").value = String(date.getFullYear());
  document.getElementById("rabYear").value = String(date.getFullYear());
  document.getElementById("rabPMSearch").value = "";
  window.appState.rabSelectedPMIds = null;
  renderRabPMChoices();
  updateRabPeriodFields();
  const modal = document.getElementById("modalRab");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
};

window.renderRabPMChoices = function () {
  const container = document.getElementById("rabPMChoices");
  if (!container) return;
  const activePMs = window.appState.pms.filter(
    (pm) => (pm.status || "Aktif") === "Aktif",
  );
  const selectedIds = window.appState.rabSelectedPMIds;
  const query = (document.getElementById("rabPMSearch")?.value || "")
    .trim()
    .toLocaleLowerCase("id-ID");
  const shownPMs = activePMs.filter((pm) =>
    `${pm.nama || ""} ${pm.jenis || ""} ${pm.lokasi || ""}`
      .toLocaleLowerCase("id-ID")
      .includes(query),
  );
  container.innerHTML = shownPMs.length
    ? shownPMs
        .map((pm) => {
          const id = escapeHtml(pm.id);
          const isChecked =
            selectedIds === null || selectedIds.has(String(pm.id));
          return `<label class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-white"><input type="checkbox" value="${id}" ${isChecked ? "checked" : ""} onchange="toggleRabPMSelection(this.value,this.checked)" class="h-4 w-4 rounded border-slate-300 text-violet-600"><span class="min-w-0 flex-1"><strong class="block truncate text-slate-700">${escapeHtml(pm.nama || "PM tanpa nama")}</strong><small class="text-slate-500">${escapeHtml(pm.jenis || "PM")} Â· ${getPMTotal(pm).toLocaleString("id-ID")} porsi</small></span></label>`;
        })
        .join("")
    : `<p class="p-3 text-xs text-slate-400">${activePMs.length ? "Tidak ada PM yang cocok." : "Belum ada PM aktif."}</p>`;
  const selectedCount =
    selectedIds === null
      ? activePMs.length
      : activePMs.filter((pm) => selectedIds.has(String(pm.id))).length;
  const countLabel = document.getElementById("rabPMSelectionCount");
  if (countLabel)
    countLabel.textContent = `${selectedCount} dari ${activePMs.length} PM aktif dipilih`;
  const selectAll = document.querySelector(
    '#modalRab button[onclick="toggleAllRabPMs()"]',
  );
  if (selectAll)
    selectAll.textContent =
      selectedCount === activePMs.length ? "Batal pilih semua" : "Pilih semua";
};

window.toggleRabPMSelection = function (pmId, checked) {
  const allIds = window.appState.pms
    .filter((pm) => (pm.status || "Aktif") === "Aktif")
    .map((pm) => String(pm.id));
  if (window.appState.rabSelectedPMIds === null)
    window.appState.rabSelectedPMIds = new Set(allIds);
  if (checked) window.appState.rabSelectedPMIds.add(String(pmId));
  else window.appState.rabSelectedPMIds.delete(String(pmId));
  renderRabPMChoices();
};

window.toggleAllRabPMs = function () {
  const activeIds = window.appState.pms
    .filter((pm) => (pm.status || "Aktif") === "Aktif")
    .map((pm) => String(pm.id));
  const currentlySelected =
    window.appState.rabSelectedPMIds === null
      ? activeIds
      : [...window.appState.rabSelectedPMIds];
  window.appState.rabSelectedPMIds =
    currentlySelected.length === activeIds.length
      ? new Set()
      : new Set(activeIds);
  renderRabPMChoices();
};

window.closeRabModal = function () {
  const modal = document.getElementById("modalRab");
  modal?.classList.add("hidden");
  modal?.classList.remove("flex");
};

window.updateRabPeriodFields = function () {
  const type = document.getElementById("rabPeriodType")?.value || "daily";
  document
    .getElementById("rabDailyFields")
    ?.classList.toggle("hidden", type !== "daily");
  document
    .getElementById("rabWeeklyFields")
    ?.classList.toggle("hidden", type !== "weekly");
  document
    .getElementById("rabWeeklyFields")
    ?.classList.toggle("grid", type === "weekly");
  document
    .getElementById("rabMonthlyFields")
    ?.classList.toggle("hidden", type !== "monthly");
  document
    .getElementById("rabMonthlyFields")
    ?.classList.toggle("grid", type === "monthly");
  document
    .getElementById("rabYearlyFields")
    ?.classList.toggle("hidden", type !== "yearly");
};

window.downloadRab = function (event) {
  event.preventDefault();
  if (isOperationalPage()) return;
  if (!window.appState.menusLoaded)
    return showToast(
      "Data menu dari Firebase masih dimuat. Coba unduh RAB kembali sebentar lagi.",
      "info",
    );
  const type = document.getElementById("rabPeriodType").value;
  let startDate = "";
  let endDate = "";
  let periodLabel = "";
  if (type === "daily") {
    startDate = endDate = document.getElementById("rabDate").value;
    if (!startDate)
      return showToast("Pilih tanggal laporan terlebih dahulu", "error");
    periodLabel = `Harian ${formatDateID(startDate)}`;
  } else if (type === "weekly") {
    startDate = document.getElementById("rabStartDate").value;
    endDate = document.getElementById("rabEndDate").value;
    if (!startDate || !endDate || endDate < startDate)
      return showToast("Rentang tanggal RAB mingguan tidak valid", "error");
    periodLabel = `Mingguan ${formatDateID(startDate)} - ${formatDateID(endDate)}`;
  } else if (type === "monthly") {
    const year = document.getElementById("rabMonthYear").value;
    const month = String(document.getElementById("rabMonth").value).padStart(
      2,
      "0",
    );
    if (!/^\d{4}$/.test(year))
      return showToast("Tahun laporan tidak valid", "error");
    startDate = `${year}-${month}-01`;
    endDate = `${year}-${month}-${new Date(Number(year), Number(month), 0).getDate()}`;
    periodLabel = `Bulanan ${new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" })}`;
  } else {
    const year = document.getElementById("rabYear").value;
    if (!/^\d{4}$/.test(year))
      return showToast("Tahun laporan tidak valid", "error");
    startDate = `${year}-01-01`;
    endDate = `${year}-12-31`;
    periodLabel = `Tahunan ${year}`;
  }
  if (!startDate || !endDate)
    return showToast("Pilih tanggal laporan terlebih dahulu", "error");

  const items = window.appState.barang
    .filter(
      (item) =>
        String(item.tanggal || "") >= startDate &&
        String(item.tanggal || "") <= endDate,
    )
    .sort(
      (a, b) =>
        String(a.tanggal || "").localeCompare(String(b.tanggal || "")) ||
        String(a.nama || a.name || "").localeCompare(
          String(b.nama || b.name || ""),
          "id",
        ),
    );
  const menusForPeriod = window.appState.menus
    .filter(
      (menu) =>
        String(menu.tanggal || "") >= startDate &&
        String(menu.tanggal || "") <= endDate,
    )
    .sort(
      (a, b) =>
        String(a.tanggal || "").localeCompare(String(b.tanggal || "")) ||
        String(a.namaMenu || "").localeCompare(String(b.namaMenu || ""), "id"),
    );
  const selectedPMIds = window.appState.rabSelectedPMIds;
  const activePMs = window.appState.pms.filter(
    (pm) =>
      (pm.status || "Aktif") === "Aktif" &&
      (selectedPMIds === null || selectedPMIds.has(String(pm.id))),
  );
  let porsiBesar = 0;
  let porsiKecil = 0;
  activePMs.forEach((pm) => {
    if (pm.jenis === "SD") {
      porsiBesar += Number(pm.kelas46 || 0) + Number(pm.guruTendik || 0);
      porsiKecil += Number(pm.kelas13 || 0);
    } else if (pm.jenis === "B3") {
      porsiBesar += Number(pm.bumil || 0) + Number(pm.busui || 0);
      porsiKecil += Number(pm.balita || 0);
    } else if (["SMP", "SMA"].includes(pm.jenis)) {
      porsiBesar += Number(pm.target || 0) + Number(pm.guruTendik || 0);
    } else if (pm.jenis === "TK") {
      porsiBesar += Number(pm.guruTendik || 0);
      porsiKecil += Number(pm.target || 0);
    }
  });
  const totalPagu = porsiBesar * 10000 + porsiKecil * 8000;
  const formatMoney = (value) =>
    `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
  const safe = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const generatedAt = new Date().toLocaleString("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  });
  const totalBarang = items.reduce(
    (sum, item) => sum + Number(item.kebutuhan || 0) * Number(item.harga || 0),
    0,
  );
  const rows = items.length
    ? items
        .map((item, index) => {
          const quantity = Number(item.kebutuhan || 0);
          const unitPrice = Number(item.harga || 0);
          return `<tr><td>${index + 1}</td><td>${safe(item.nama || item.name || "-")}</td><td class="number">${quantity.toLocaleString("id-ID")}</td><td>${safe(item.satuan || "-")}</td><td class="number">${formatMoney(unitPrice)}</td><td class="number">${formatMoney(quantity * unitPrice)}</td><td>${safe(item.keterangan || "")}</td></tr>`;
        })
        .join("")
    : '<tr><td colspan="7" class="empty">Tidak ada data barang dalam periode ini.</td></tr>';
  const menuRows = menusForPeriod.length
    ? menusForPeriod
        .map(
          (menu) =>
            `<tr><td>${safe(formatDateID(menu.tanggal || ""))}</td><td>${safe(menu.namaMenu || "-")}</td><td class="number">${safe(menu.energi ?? "-")}</td><td class="number">${safe(menu.protein ?? "-")}</td><td class="number">${safe(menu.lemak ?? "-")}</td><td class="number">${safe(menu.karbohidrat ?? "-")}</td><td class="number">${safe(menu.serat ?? "-")}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="7" class="empty">Belum ada menu tersimpan di database pada periode ini.</td></tr>';
  const menuReportTable = `<h2>MENU DAN KANDUNGAN GIZI</h2><table><thead><tr><th>TANGGAL</th><th>NAMA MENU</th><th>ENERGI (kkal)</th><th>PROTEIN (g)</th><th>LEMAK (g)</th><th>KARBOHIDRAT (g)</th><th>SERAT (g)</th></tr></thead><tbody>${menuRows}</tbody></table>`;
  const getPMPortions = (pm) => {
    if (pm.jenis === "SD")
      return [
        {
          size: "Besar",
          recipientType: "Siswa kelas 4-6 / Guru-Tendik",
          count: Number(pm.kelas46 || 0) + Number(pm.guruTendik || 0),
        },
        {
          size: "Kecil",
          recipientType: "Siswa kelas 1-3",
          count: Number(pm.kelas13 || 0),
        },
      ];
    if (pm.jenis === "B3")
      return [
        {
          size: "Besar",
          recipientType: "B3 - Bumil/Busui",
          count: Number(pm.bumil || 0) + Number(pm.busui || 0),
        },
        {
          size: "Kecil",
          recipientType: "B3 - Balita",
          count: Number(pm.balita || 0),
        },
      ];
    if (pm.jenis === "TK")
      return [
        {
          size: "Besar",
          recipientType: "Guru/Tendik",
          count: Number(pm.guruTendik || 0),
        },
        {
          size: "Kecil",
          recipientType: "Siswa TK",
          count: Number(pm.target || 0),
        },
      ];
    return [
      {
        size: "Besar",
        recipientType: "Siswa/Guru-Tendik",
        count: Number(pm.target || 0) + Number(pm.guruTendik || 0),
      },
    ];
  };
  const pmRows =
    activePMs
      .flatMap((pm) =>
        getPMPortions(pm)
          .filter((portion) => portion.count > 0)
          .map((portion) => {
            const unitPrice = portion.size === "Besar" ? 10000 : 8000;
            return `<tr><td>${safe(pm.nama || "-")}</td><td>${portion.size} Â· ${safe(portion.recipientType)}</td><td class="number">${portion.count.toLocaleString("id-ID")}</td><td class="number">${formatMoney(unitPrice)}</td><td class="number">${formatMoney(portion.count * unitPrice)}</td></tr>`;
          }),
      )
      .join("") ||
    '<tr><td colspan="5" class="empty">Tidak ada PM aktif.</td></tr>';
  const kitchenProfile = getKitchenProfile();
  const kitchenName = safe(
    kitchenProfile.kitchenName || "SPPG Ogan Ilir Pemulutan Muara Dua",
  );
  const periodDateLabel =
    type === "daily"
      ? formatDateID(startDate)
      : `${formatDateID(startDate)} - ${formatDateID(endDate)}`;
  const reportHtml = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>RAB MBG - ${safe(periodLabel)}</title><style>@page{size:A4 landscape;margin:13mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#111}h1{font-size:15px;margin:0;text-align:center;font-weight:700}h2{font-size:13px;margin:18px 0 6px}.header{text-align:center;line-height:1.4;margin-bottom:10px}.header .date{margin-top:4px}.menu{text-align:center;font-weight:bold;margin:8px 0}table{width:100%;border-collapse:collapse;font-size:10px}th,td{padding:5px 7px;border:1px solid #111;text-align:left}th{background:#58c5e6;text-align:center}.number{text-align:right;white-space:nowrap}.center{text-align:center}.total-row td{font-weight:bold}.summary{width:70%;margin-left:auto;margin-top:15px}.summary th{background:#fff}.signatures{display:flex;justify-content:flex-end;gap:70px;margin:38px 35px 0}.sign{min-width:160px;text-align:center}.sign-space{height:55px}.note{font-size:9px;margin-top:12px;color:#475569}@media print{tr{break-inside:avoid}}</style></head><body><div class="header"><h1>${kitchenName.toLocaleUpperCase("id-ID")}</h1><strong>YAYASAN KEMALA BHAYANGKARI</strong><div class="date">HARI : ${safe(periodDateLabel)}</div><div class="menu">RAB ${safe(periodLabel)}</div></div>${menuReportTable}<table><thead><tr><th style="width:5%">No.</th><th style="width:22%">URAIAN</th><th style="width:15%">QTY</th><th style="width:18%">SATUAN</th><th style="width:18%">Harga</th><th style="width:18%">Total HARGA</th><th style="width:18%">KETERANGAN</th></tr></thead><tbody>${rows}<tr class="total-row"><td colspan="5" class="number">Total</td><td class="number">${formatMoney(totalBarang)}</td><td></td></tr></tbody></table><h2>RINCIAN PORSI DAN PAGU PM</h2><table><thead><tr><th style="width:28%">PENERIMA MANFAAT</th><th style="width:30%">PORSI / KATEGORI</th><th style="width:14%">JUMLAH PENERIMA</th><th style="width:14%">PAGU</th><th style="width:14%">TOTAL</th></tr></thead><tbody>${pmRows}<tr class="total-row"><td colspan="2" class="number">Total</td><td class="number">${(porsiBesar + porsiKecil).toLocaleString("id-ID")}</td><td></td><td class="number">${formatMoney(totalPagu)}</td></tr></tbody></table><table class="summary"><tbody><tr><td>Total Belanja Barang</td><td class="number">${formatMoney(totalBarang)}</td></tr><tr><td>Total Pagu PM</td><td class="number">${formatMoney(totalPagu)}</td></tr><tr class="total-row"><td>Grand Total RAB</td><td class="number">${formatMoney(totalBarang + totalPagu)}</td></tr></tbody></table><div class="note">Rincian jumlah mengikuti kategori penerima pada setiap PM: siswa/guru untuk sekolah, guru/tendik dan siswa TK, serta Bumil/Busui/Balita untuk B3. Tarif porsi besar Rp10.000 dan porsi kecil Rp8.000. Belanja barang dihitung dari jumlah kebutuhan Ã— harga satuan.</div><div class="signatures"><div class="sign">Mengetahui<div class="sign-space"></div>(................................)</div><div class="sign">Disusun oleh<div class="sign-space"></div>(................................)</div></div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script></body></html>`;
  const reportWindow = window.open("", "_blank");
  if (!reportWindow)
    return showToast(
      "Izinkan pop-up browser untuk membuka dan mengunduh RAB",
      "error",
    );
  reportWindow.document.open();
  reportWindow.document.write(reportHtml);
  reportWindow.document.close();
  const grandTotalRow = [
    ...reportWindow.document.querySelectorAll(".summary tr"),
  ].find((row) => row.cells[0]?.textContent.trim() === "Grand Total RAB");
  if (grandTotalRow?.cells[1])
    grandTotalRow.cells[1].textContent = formatMoney(totalPagu - totalBarang);
  const reportHeader = reportWindow.document.querySelector(".header");
  const foundationHeader = reportHeader?.querySelector("strong");
  if (foundationHeader) {
    foundationHeader.textContent = kitchenProfile.foundationName || "";
    foundationHeader.hidden = !kitchenProfile.foundationName;
  }
  if (
    reportHeader &&
    (kitchenProfile.leftLogoDataUrl || kitchenProfile.foundationLogoDataUrl) &&
    /^data:image\/(?:webp|png|jpeg);base64,/i.test(
      kitchenProfile.leftLogoDataUrl || kitchenProfile.foundationLogoDataUrl,
    )
  ) {
    const logo = reportWindow.document.createElement("img");
    logo.className = "header-logo";
    logo.src =
      kitchenProfile.leftLogoDataUrl || kitchenProfile.foundationLogoDataUrl;
    logo.alt = "Logo kiri";
    reportHeader.insertBefore(logo, reportHeader.firstChild);
  }
  if (
    reportHeader &&
    kitchenProfile.rightLogoDataUrl &&
    /^data:image\/(?:webp|png|jpeg);base64,/i.test(
      kitchenProfile.rightLogoDataUrl,
    )
  ) {
    const logo = reportWindow.document.createElement("img");
    logo.className = "header-logo header-logo-right";
    logo.src = kitchenProfile.rightLogoDataUrl;
    logo.alt = "Logo kanan";
    reportHeader.appendChild(logo);
  }
  if (reportHeader && kitchenProfile.kitchenAddress) {
    const address = reportWindow.document.createElement("div");
    address.className = "header-detail";
    address.textContent = kitchenProfile.kitchenAddress;
    reportHeader.insertBefore(address, reportHeader.querySelector(".date"));
  }
  if (reportHeader && kitchenProfile.kitchenPhone) {
    const contact = reportWindow.document.createElement("div");
    contact.className = "header-detail";
    contact.textContent = `Kontak: ${kitchenProfile.kitchenPhone}`;
    reportHeader.insertBefore(contact, reportHeader.querySelector(".date"));
  }
  const reportStyle = reportWindow.document.querySelector("style");
  if (reportStyle)
    reportStyle.textContent +=
      ".header{position:relative;padding:4px 86px 8px;min-height:76px}.header-logo{position:absolute;left:4px;top:2px;width:72px;height:72px;object-fit:contain}.header-logo-right{left:auto;right:4px}.header-detail{font-size:10px;line-height:1.3;margin-top:2px}";
  closeRabModal();
};

function renderSupplierTable() {
  const tbody = document.getElementById("supplierTableBody");
  if (!tbody) return;

  if (!window.appState.suppliersLoaded) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-5 py-10 text-center"><span class="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700"><i class="fa-solid fa-spinner fa-spin"></i>Memuat data supplier dari Firebase...</span></td></tr>`;
    return;
  }

  if (!window.appState.suppliers.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-slate-400">Belum ada data supplier</td></tr>`;
    return;
  }

  tbody.innerHTML = window.appState.suppliers
    .map(
      (sup) => `
        <tr class="hover:bg-slate-50/80 transition-colors">
          <td class="py-3.5 px-5 font-bold text-slate-800">${sup.nama || "-"}</td>
          <td class="py-3.5 px-5 font-medium text-slate-600">${sup.kontak || "-"}</td>
          <td class="py-3.5 px-5 text-slate-600 max-w-xs truncate">${sup.alamat || "-"}</td>
          <td class="py-3.5 px-5">
            <span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">${sup.kategori || "Umum"}</span>
          </td>
          <td class="py-3.5 px-5">
            <div class="text-xs">
              <p class="font-bold text-slate-800">${sup.namaBank || "-"} : ${sup.noRekening || "-"}</p>
              <p class="text-[10px] text-slate-400">a.n ${sup.namaRekening || "-"}</p>
            </div>
          </td>
          <td class="py-3.5 px-5 text-right space-x-1">
            <button onclick="editSupplier('${sup.id}')" class="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Edit Supplier">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button onclick="promptDelete('supplier', '${sup.id}', '${sup.nama}')" class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Hapus Supplier">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </td>
        </tr>
      `,
    )
    .join("");
}

function updateMenuPhotoPreview(dataUrl = "", sizeBytes = 0, removed = false) {
  menuPhotoDataUrl = dataUrl;
  menuPhotoSizeBytes = Number(sizeBytes) || 0;
  menuPhotoRemoved = removed;
  const preview = document.getElementById("menuPhotoPreview");
  const removeButton = document.getElementById("menuPhotoRemove");
  const status = document.getElementById("menuPhotoStatus");
  if (preview) {
    preview.src = dataUrl;
    preview.classList.toggle("hidden", !dataUrl);
  }
  removeButton?.classList.toggle("hidden", !dataUrl);
  if (status)
    status.textContent = dataUrl
      ? `Foto siap disimpan (${Math.max(1, Math.ceil(menuPhotoSizeBytes / 1024))} KB).`
      : removed
        ? "Foto menu akan dihapus saat disimpan."
        : "JPG, PNG, atau WebP. Foto akan dikompres otomatis.";
}

window.handleMenuPhotoChange = async function (input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    input.value = "";
    showToast("Pilih foto menu dalam format JPG, PNG, atau WebP", "error");
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    input.value = "";
    showToast("Ukuran foto asli maksimal 20 MB", "error");
    return;
  }
  const requestVersion = ++menuPhotoRequestVersion;
  const status = document.getElementById("menuPhotoStatus");
  if (status)
    status.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Mengompres foto menu...';
  try {
    const compressed = await compressArrivalPhoto(file);
    if (requestVersion !== menuPhotoRequestVersion) return;
    updateMenuPhotoPreview(compressed.dataUrl, compressed.sizeBytes);
  } catch (error) {
    if (requestVersion !== menuPhotoRequestVersion) return;
    input.value = "";
    if (status)
      status.textContent = error.message || "Foto menu gagal diproses.";
    showToast(error.message || "Foto menu gagal diproses", "error");
  }
};

window.removeMenuPhoto = function () {
  menuPhotoRequestVersion += 1;
  const input = document.getElementById("menuFoto");
  if (input) input.value = "";
  updateMenuPhotoPreview("", 0, true);
};

function renderMenuTable() {
  const tbody = document.getElementById("menuTableBody");
  const search = document.getElementById("menuSearch");
  if (!tbody) return;

  if (!window.appState.menusLoaded) {
    tbody.innerHTML = `<tr><td colspan="9" class="px-5 py-10 text-center text-sky-700"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat data menu dari Firebase...</td></tr>`;
    return;
  }

  const query = (search?.value || "").trim().toLocaleLowerCase("id-ID");
  const menus = [...window.appState.menus]
    .filter((menu) =>
      `${menu.namaMenu || ""} ${menu.energi || ""} ${menu.protein || ""} ${menu.lemak || ""} ${menu.karbohidrat || ""} ${menu.serat || ""} ${menu.akg || ""}`
        .toLocaleLowerCase("id-ID")
        .includes(query),
    )
    .sort((a, b) =>
      String(b.tanggal || "").localeCompare(String(a.tanggal || "")),
    );

  if (!menus.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="px-5 py-10 text-center text-slate-400">${query ? "Menu tidak ditemukan" : "Belum ada menu. Tambahkan menu pertama."}</td></tr>`;
    renderMenuPagination(0);
    return;
  }

  const pageSize = window.appState.menuPageSize || 10;
  const pageCount = Math.max(1, Math.ceil(menus.length / pageSize));
  window.appState.menuPage = Math.min(
    Math.max(1, window.appState.menuPage || 1),
    pageCount,
  );
  const start = (window.appState.menuPage - 1) * pageSize;
  const visibleMenus = menus.slice(start, start + pageSize);
  tbody.innerHTML = visibleMenus
    .map(
      (menu) => `
    <tr class="hover:bg-slate-50/80 transition-colors">
      <td class="px-5 py-4 whitespace-nowrap font-medium text-slate-600">${escapeHtml(formatDateID(menu.tanggal || ""))}</td>
      <td class="px-5 py-4"><div class="flex min-w-48 items-center gap-3"><div class="flex h-12 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">${menu.fotoMenu ? `<img src="${escapeHtml(menu.fotoMenu)}" alt="Foto ${escapeHtml(menu.namaMenu || "menu")}" loading="lazy" class="h-full w-full object-cover"/>` : '<i class="fa-solid fa-utensils text-slate-300"></i>'}</div><p class="min-w-0 font-bold text-slate-800">${escapeHtml(menu.namaMenu || "-")}</p></div></td>
      <td class="px-4 py-4 text-slate-600">${escapeHtml(menu.energi || "-")}</td>
      <td class="px-4 py-4 text-slate-600">${escapeHtml(menu.protein || "-")}</td>
      <td class="px-4 py-4 text-slate-600">${escapeHtml(menu.lemak || "-")}</td>
      <td class="px-4 py-4 text-slate-600">${escapeHtml(menu.karbohidrat || "-")}</td>
      <td class="px-4 py-4 text-slate-600">${escapeHtml(menu.serat || "-")}</td>
      <td class="px-4 py-4 whitespace-nowrap text-slate-600">${menu.suhu === null || menu.suhu === undefined || menu.suhu === "" ? "-" : `${escapeHtml(menu.suhu)} °C`}</td>
      <td class="px-5 py-4 text-right whitespace-nowrap">
        <button type="button" onclick="editMenu('${escapeHtml(menu.id)}')" class="p-2 text-sky-600 hover:bg-sky-50 rounded-lg" title="Edit menu"><i class="fa-solid fa-pen-to-square"></i></button>
        <button type="button" onclick="deleteMenu('${escapeHtml(menu.id)}')" class="p-2 text-red-600 hover:bg-red-50 rounded-lg" title="Hapus menu"><i class="fa-solid fa-trash-can"></i></button>
      </td>
    </tr>`,
    )
    .join("");
  renderMenuPagination(menus.length);
}

function renderMenuPagination(total) {
  const container = document.getElementById("menuPagination");
  if (!container) return;
  const pageSize = window.appState.menuPageSize || 10;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(window.appState.menuPage || 1, pages);
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, total);
  container.innerHTML = `
    <div class="text-xs text-slate-500">Menampilkan <b>${first}-${last}</b> dari <b>${total}</b> menu</div>
    <div class="flex items-center gap-2">
      <label class="flex items-center gap-2 text-xs text-slate-500">Baris
        <select onchange="changeMenuPageSize(this.value)" class="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">
          ${[10, 25, 50].map((size) => `<option value="${size}" ${pageSize === size ? "selected" : ""}>${size}</option>`).join("")}
        </select>
      </label>
      <button type="button" onclick="changeMenuPage(-1)" ${page <= 1 ? "disabled" : ""} class="h-8 w-8 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40"><i class="fa-solid fa-chevron-left"></i></button>
      <span class="min-w-20 text-center text-xs text-slate-600">${page} / ${pages}</span>
      <button type="button" onclick="changeMenuPage(1)" ${page >= pages ? "disabled" : ""} class="h-8 w-8 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40"><i class="fa-solid fa-chevron-right"></i></button>
    </div>`;
}

window.changeMenuPage = function (direction) {
  window.appState.menuPage = Math.max(
    1,
    (window.appState.menuPage || 1) + Number(direction),
  );
  renderMenuTable();
};

window.changeMenuPageSize = function (size) {
  window.appState.menuPageSize = Number(size) || 10;
  window.appState.menuPage = 1;
  renderMenuTable();
};

window.openMenuModal = function (menuId = "") {
  const form = document.getElementById("formMenu");
  if (!form) return;
  form.reset();
  menuPhotoRequestVersion += 1;
  document.getElementById("menuFoto").value = "";
  updateMenuPhotoPreview();
  document.getElementById("menuId").value = "";
  document.getElementById("menuTanggal").value = getLocalDateString();
  document.getElementById("menuModalTitle").textContent = "Tambah Menu";
  if (menuId) {
    const menu = window.appState.menus.find((item) => item.id === menuId);
    if (!menu) return;
    document.getElementById("menuId").value = menu.id;
    document.getElementById("menuTanggal").value =
      menu.tanggal || getLocalDateString();
    document.getElementById("menuNama").value = menu.namaMenu || "";
    document.getElementById("menuSuhu").value =
      menu.suhu === null || menu.suhu === undefined ? "" : menu.suhu;
    updateMenuPhotoPreview(menu.fotoMenu || "", menu.fotoMenuSizeBytes || 0);
    for (const field of [
      "energi",
      "protein",
      "lemak",
      "karbohidrat",
      "serat",
    ]) {
      const input = document.getElementById(
        `menu${field[0].toUpperCase()}${field.slice(1)}`,
      );
      if (input) input.value = menu[field] || "";
    }
    document.getElementById("menuModalTitle").textContent = "Edit Menu";
  }
  document.getElementById("modalMenu").classList.remove("hidden");
};

window.closeMenuModal = function () {
  document.getElementById("modalMenu")?.classList.add("hidden");
  menuPhotoRequestVersion += 1;
  const photoInput = document.getElementById("menuFoto");
  if (photoInput) photoInput.value = "";
  updateMenuPhotoPreview();
};

window.editMenu = function (menuId) {
  window.openMenuModal(menuId);
};

window.saveMenu = async function (event) {
  event.preventDefault();
  const button = document.getElementById("saveMenuBtn");
  const id = document.getElementById("menuId").value || `menu_${Date.now()}`;
  const previous = window.appState.menus.find((menu) => menu.id === id);
  const temperatureValue = document.getElementById("menuSuhu").value.trim();
  const numericAkgFields = [
    "menuEnergi",
    "menuProtein",
    "menuLemak",
    "menuKarbohidrat",
    "menuSerat",
  ];
  const menu = {
    tanggal: document.getElementById("menuTanggal").value,
    namaMenu: document.getElementById("menuNama").value.trim(),
    suhu: temperatureValue === "" ? null : Number(temperatureValue),
    fotoMenu: menuPhotoRemoved
      ? ""
      : menuPhotoDataUrl || previous?.fotoMenu || "",
    fotoMenuSizeBytes: menuPhotoRemoved
      ? 0
      : menuPhotoSizeBytes || previous?.fotoMenuSizeBytes || 0,
    energi: Number(document.getElementById("menuEnergi").value),
    protein: Number(document.getElementById("menuProtein").value),
    lemak: Number(document.getElementById("menuLemak").value),
    karbohidrat: Number(document.getElementById("menuKarbohidrat").value),
    serat: Number(document.getElementById("menuSerat").value),
    updatedAt: new Date().toISOString(),
    ...(previous
      ? {}
      : {
          createdAt: new Date().toISOString(),
          createdBy: window.appState.user?.uid || "",
        }),
  };
  if (
    !menu.tanggal ||
    !menu.namaMenu ||
    numericAkgFields.some(
      (fieldId) => document.getElementById(fieldId).value.trim() === "",
    ) ||
    numericAkgFields.some(
      (fieldId) =>
        !Number.isFinite(Number(document.getElementById(fieldId).value)),
    )
  ) {
    showToast(
      "Tanggal, nama menu, dan semua komponen AKG wajib diisi",
      "error",
    );
    return;
  }
  if (
    temperatureValue !== "" &&
    (!Number.isFinite(menu.suhu) || menu.suhu < 0 || menu.suhu > 100)
  ) {
    showToast("Suhu menu harus berada di antara 0–100 °C", "error");
    return;
  }
  setButtonLoading(button, true, "Menyimpan...");
  try {
    await setDoc(doc(db, "menus", id), menu, { merge: true });
    showToast("Menu berhasil disimpan", "success");
    window.closeMenuModal();
  } catch (error) {
    console.error("Gagal menyimpan menu:", error);
    showToast(error.message || "Menu gagal disimpan ke Firebase", "error");
  } finally {
    setButtonLoading(button, false);
  }
};

window.deleteMenu = async function (menuId) {
  const menu = window.appState.menus.find((item) => item.id === menuId);
  if (!menu || !window.confirm(`Hapus menu "${menu.namaMenu}"?`)) return;
  try {
    await deleteDoc(doc(db, "menus", menuId));
    showToast("Menu berhasil dihapus", "success");
  } catch (error) {
    console.error("Gagal menghapus menu:", error);
    showToast(error.message || "Menu gagal dihapus", "error");
  }
};

function renderLimbahTable() {
  const tbody = document.getElementById("limbahTableBody");
  const search = document.getElementById("limbahSearch");
  if (!tbody) return;
  if (!window.appState.limbahLoaded) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-10 text-center text-sky-700"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat data limbah dari Firebase...</td></tr>`;
    return;
  }
  const query = (search?.value || "").trim().toLocaleLowerCase("id-ID");
  const items = [...window.appState.limbah]
    .filter((item) =>
      String(item.nama || "")
        .toLocaleLowerCase("id-ID")
        .includes(query),
    )
    .sort((a, b) =>
      String(b.tanggal || b.createdAt || "").localeCompare(
        String(a.tanggal || a.createdAt || ""),
      ),
    );
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-10 text-center text-slate-400">${query ? "Limbah tidak ditemukan" : "Belum ada data limbah. Tambahkan data pertama."}</td></tr>`;
    renderLimbahPagination(0);
    return;
  }
  const pageSize = window.appState.limbahPageSize || 10;
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  window.appState.limbahPage = Math.min(
    Math.max(1, window.appState.limbahPage || 1),
    pages,
  );
  const start = (window.appState.limbahPage - 1) * pageSize;
  tbody.innerHTML = items
    .slice(start, start + pageSize)
    .map((item) => {
      const photos = Array.isArray(item.fotoLimbah)
        ? item.fotoLimbah.slice(0, 4)
        : [];
      return `<tr class="hover:bg-slate-50/80"><td class="px-5 py-4 whitespace-nowrap">${escapeHtml(formatDateID(item.tanggal || String(item.createdAt || "").slice(0, 10)) || "-")}</td><td class="px-5 py-3"><div class="flex gap-1">${photos.length ? photos.map((photo, index) => `<img src="${escapeHtml(photo.dataUrl || "")}" alt="Foto ${escapeHtml(item.nama || "limbah")} ${index + 1}" loading="lazy" class="h-12 w-14 rounded-lg border border-slate-200 object-cover"/>`).join("") : '<span class="flex h-12 w-14 items-center justify-center rounded-lg bg-slate-50 text-slate-300"><i class="fa-solid fa-recycle"></i></span>'}</div></td><td class="px-5 py-4 font-bold text-slate-800">${escapeHtml(item.nama || "-")}</td><td class="px-5 py-4">${escapeHtml(Number(item.berat || 0).toLocaleString("id-ID", { maximumFractionDigits: 3 }))} kg</td><td class="px-5 py-4 text-right whitespace-nowrap"><button type="button" onclick="viewLimbah('${escapeHtml(item.id)}')" class="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Lihat limbah"><i class="fa-solid fa-eye"></i></button><button type="button" onclick="editLimbah('${escapeHtml(item.id)}')" class="p-2 text-sky-600 hover:bg-sky-50 rounded-lg" title="Edit limbah"><i class="fa-solid fa-pen-to-square"></i></button><button type="button" onclick="deleteLimbah('${escapeHtml(item.id)}')" class="p-2 text-red-600 hover:bg-red-50 rounded-lg" title="Hapus limbah"><i class="fa-solid fa-trash-can"></i></button></td></tr>`;
    })
    .join("");
  renderLimbahPagination(items.length);
}

function renderLimbahPagination(total) {
  const container = document.getElementById("limbahPagination");
  if (!container) return;
  const size = window.appState.limbahPageSize || 10;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(window.appState.limbahPage || 1, pages);
  const first = total ? (page - 1) * size + 1 : 0;
  const last = Math.min(page * size, total);
  container.innerHTML = `<div class="text-xs text-slate-500">Menampilkan <b>${first}-${last}</b> dari <b>${total}</b> limbah</div><div class="flex items-center gap-2"><label class="flex items-center gap-2 text-xs text-slate-500">Baris<select onchange="changeLimbahPageSize(this.value)" class="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">${[10, 25, 50].map((n) => `<option value="${n}" ${size === n ? "selected" : ""}>${n}</option>`).join("")}</select></label><button type="button" onclick="changeLimbahPage(-1)" ${page <= 1 ? "disabled" : ""} class="h-8 w-8 rounded-lg border border-slate-200 disabled:opacity-40"><i class="fa-solid fa-chevron-left"></i></button><span class="min-w-20 text-center text-xs">${page} / ${pages}</span><button type="button" onclick="changeLimbahPage(1)" ${page >= pages ? "disabled" : ""} class="h-8 w-8 rounded-lg border border-slate-200 disabled:opacity-40"><i class="fa-solid fa-chevron-right"></i></button></div>`;
}

window.changeLimbahPage = (direction) => {
  window.appState.limbahPage = Math.max(
    1,
    (window.appState.limbahPage || 1) + Number(direction),
  );
  renderLimbahTable();
};
window.changeLimbahPageSize = (size) => {
  window.appState.limbahPageSize = Number(size) || 10;
  window.appState.limbahPage = 1;
  renderLimbahTable();
};

function renderLimbahPhotoPreviews() {
  const container = document.getElementById("limbahPhotoPreviews");
  if (!container) return;
  container.innerHTML = limbahPhotos
    .map(
      (photo, index) =>
        `<div class="relative"><img src="${escapeHtml(photo.dataUrl)}" alt="Pratinjau foto limbah ${index + 1}" class="h-20 w-full rounded-lg border border-slate-200 object-cover"/><button type="button" onclick="removeLimbahPhoto(${index})" aria-label="Hapus foto ${index + 1}" class="absolute -right-1.5 -top-1.5 h-6 w-6 rounded-full bg-rose-600 text-white shadow"><i class="fa-solid fa-xmark"></i></button></div>`,
    )
    .join("");
  const status = document.getElementById("limbahPhotoStatus");
  if (status)
    status.textContent = `${limbahPhotos.length}/4 foto dipilih. JPG, PNG, atau WebP.`;
}

window.handleLimbahPhotoChange = async function (input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  if (limbahPhotos.length + files.length > 4) {
    input.value = "";
    showToast("Foto limbah maksimal 4", "error");
    return;
  }
  const version = ++limbahPhotoRequestVersion;
  const status = document.getElementById("limbahPhotoStatus");
  if (status)
    status.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Mengompres foto...';
  try {
    const compressed = [];
    for (const file of files) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
        throw new Error("Gunakan foto JPG, PNG, atau WebP.");
      if (file.size > 20 * 1024 * 1024)
        throw new Error("Ukuran foto asli maksimal 20 MB.");
      compressed.push(await compressArrivalPhoto(file));
    }
    if (version !== limbahPhotoRequestVersion) return;
    limbahPhotos = [...limbahPhotos, ...compressed].slice(0, 4);
    renderLimbahPhotoPreviews();
  } catch (error) {
    if (version !== limbahPhotoRequestVersion) return;
    showToast(error.message || "Foto gagal diproses", "error");
    if (status) status.textContent = error.message || "Foto gagal diproses.";
  } finally {
    input.value = "";
  }
};

window.removeLimbahPhoto = function (index) {
  limbahPhotos.splice(index, 1);
  renderLimbahPhotoPreviews();
};

window.openLimbahModal = function (id = "") {
  const form = document.getElementById("formLimbah");
  if (!form) return;
  form.reset();
  limbahPhotoRequestVersion += 1;
  limbahPhotos = [];
  document.getElementById("limbahId").value = "";
  document.getElementById("limbahTanggal").value = getLocalDateString();
  document.getElementById("limbahModalTitle").textContent = id
    ? "Edit Limbah"
    : "Tambah Limbah";
  if (id) {
    const item = window.appState.limbah.find((entry) => entry.id === id);
    if (!item) return;
    document.getElementById("limbahId").value = item.id;
    document.getElementById("limbahTanggal").value =
      item.tanggal ||
      String(item.createdAt || "").slice(0, 10) ||
      getLocalDateString();
    document.getElementById("limbahNama").value = item.nama || "";
    document.getElementById("limbahBerat").value = item.berat ?? "";
    limbahPhotos = Array.isArray(item.fotoLimbah)
      ? item.fotoLimbah.slice(0, 4)
      : [];
  }
  renderLimbahPhotoPreviews();
  const modal = document.getElementById("modalLimbah");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
};

window.closeLimbahModal = function () {
  const modal = document.getElementById("modalLimbah");
  modal?.classList.add("hidden");
  modal?.classList.remove("flex");
  limbahPhotoRequestVersion += 1;
};

window.editLimbah = (id) => window.openLimbahModal(id);

window.viewLimbah = function (id) {
  const item = window.appState.limbah.find((entry) => entry.id === id);
  if (!item) return;
  const photos = Array.isArray(item.fotoLimbah)
    ? item.fotoLimbah.slice(0, 4)
    : [];
  const photoHtml = photos.length
    ? photos
        .map(
          (photo, index) =>
            `<img src="${escapeHtml(photo.dataUrl || "")}" alt="Foto ${escapeHtml(item.nama || "limbah")} ${index + 1}" class="h-40 w-full rounded-xl border border-slate-200 object-cover"/>`,
        )
        .join("")
    : '<div class="col-span-full rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-400">Belum ada foto limbah.</div>';
  document.getElementById("limbahViewTitle").textContent =
    item.nama || "Detail Limbah";
  document.getElementById("limbahViewDetails").innerHTML =
    `<div><p class="text-xs text-slate-500">Tanggal</p><p class="mt-1 font-semibold text-slate-800">${escapeHtml(formatDateID(item.tanggal || String(item.createdAt || "").slice(0, 10)) || "-")}</p></div><div><p class="text-xs text-slate-500">Berat</p><p class="mt-1 font-semibold text-slate-800">${escapeHtml(Number(item.berat || 0).toLocaleString("id-ID", { maximumFractionDigits: 3 }))} kg</p></div>`;
  document.getElementById("limbahViewPhotos").innerHTML = photoHtml;
  const modal = document.getElementById("modalLimbahView");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
};

window.closeLimbahView = function () {
  const modal = document.getElementById("modalLimbahView");
  modal?.classList.add("hidden");
  modal?.classList.remove("flex");
};

window.saveLimbah = async function (event) {
  event.preventDefault();
  const nama = document.getElementById("limbahNama").value.trim();
  const tanggal = document.getElementById("limbahTanggal").value;
  const berat = Number(document.getElementById("limbahBerat").value);
  if (
    !tanggal ||
    !nama ||
    !Number.isFinite(berat) ||
    berat <= 0 ||
    limbahPhotos.length > 4
  ) {
    showToast(
      "Isi tanggal, nama limbah, dan berat lebih dari 0 kg; maksimal 4 foto",
      "error",
    );
    return;
  }
  const id =
    document.getElementById("limbahId").value || `limbah_${Date.now()}`;
  const previous = window.appState.limbah.find((item) => item.id === id);
  const now = new Date().toISOString();
  const data = {
    tanggal,
    nama,
    berat,
    fotoLimbah: limbahPhotos.slice(0, 4),
    updatedAt: now,
    ...(previous
      ? {}
      : { createdAt: now, createdBy: window.appState.user?.uid || "" }),
  };
  const button = document.getElementById("saveLimbahBtn");
  setButtonLoading(button, true, "Menyimpan...");
  try {
    await setDoc(doc(db, "limbah", id), data, { merge: true });
    showToast("Data limbah berhasil disimpan", "success");
    window.closeLimbahModal();
  } catch (error) {
    console.error("Gagal menyimpan limbah:", error);
    showToast(error.message || "Data limbah gagal disimpan", "error");
  } finally {
    setButtonLoading(button, false);
  }
};

window.deleteLimbah = async function (id) {
  const item = window.appState.limbah.find((entry) => entry.id === id);
  if (!item || !window.confirm(`Hapus data limbah "${item.nama}"?`)) return;
  try {
    await deleteDoc(doc(db, "limbah", id));
    showToast("Data limbah berhasil dihapus", "success");
  } catch (error) {
    console.error("Gagal menghapus limbah:", error);
    showToast(error.message || "Data limbah gagal dihapus", "error");
  }
};

let usersListenerStarted = false;

function setupUsersListener() {
  if (usersListenerStarted || !isSuperAdmin()) return;
  usersListenerStarted = true;
  window.appState.usersLoaded = false;
  renderUsersTable();
  onSnapshot(
    collection(db, "app_users"),
    (snapshot) => {
      window.appState.users = snapshot.docs
        .map((userDoc) => ({
          id: userDoc.id,
          ...userDoc.data(),
        }))
        .sort((a, b) =>
          String(a.email || a.id).localeCompare(String(b.email || b.id)),
        );
      window.appState.usersLoaded = true;
      renderUsersTable();
    },
    (error) => {
      console.error("Gagal memuat daftar pengguna:", error);
      window.appState.users = [];
      window.appState.usersLoaded = true;
      renderUsersTable();
      showToast(
        "Daftar pengguna gagal dimuat. Periksa Firestore Rules.",
        "error",
      );
    },
  );
}

function renderUsersTable() {
  const tbody = document.getElementById("usersTableBody");
  if (!tbody) return;
  if (!isSuperAdmin()) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-10 text-center text-rose-600">Halaman ini khusus Super Admin.</td></tr>`;
    return;
  }
  if (!window.appState.usersLoaded) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-10 text-center text-sky-700"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat akun yang diizinkan...</td></tr>`;
    return;
  }
  const pageSize = window.appState.userPageSize || 10;
  const pages = Math.max(1, Math.ceil(window.appState.users.length / pageSize));
  window.appState.userPage = Math.min(
    Math.max(1, window.appState.userPage || 1),
    pages,
  );
  const start = (window.appState.userPage - 1) * pageSize;
  const users = window.appState.users.slice(start, start + pageSize);
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-10 text-center text-slate-400">Belum ada akun yang diizinkan.</td></tr>`;
  } else {
    tbody.innerHTML = users
      .map((account) => {
        const isSelf =
          normalizeAccountEmail(account.email || account.id) ===
          normalizeAccountEmail(window.appState.user?.email);
        const roleLabel =
          account.role === USER_ROLES.SUPER_ADMIN
            ? "Super Admin"
            : "Admin Logistik";
        const accountKey = encodeURIComponent(account.id);
        return `<tr class="hover:bg-slate-50/80">
        <td class="px-5 py-4 font-semibold text-slate-800">${escapeHtml(account.email || account.id)} ${isSelf ? '<span class="ml-1 text-[10px] text-sky-600">(Anda)</span>' : ""}</td>
        <td class="px-5 py-4"><span class="rounded-full px-2.5 py-1 text-[10px] font-bold ${account.role === USER_ROLES.SUPER_ADMIN ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"}">${roleLabel}</span></td>
        <td class="px-5 py-4"><span class="rounded-full px-2.5 py-1 text-[10px] font-bold ${account.active === true ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}">${account.active === true ? "Aktif" : "Nonaktif"}</span></td>
        <td class="px-5 py-4 text-slate-500">${escapeHtml(account.createdAt ? formatDateID(String(account.createdAt).slice(0, 10)) : "-")}</td>
        <td class="px-5 py-4 text-right whitespace-nowrap">
          <button type="button" onclick="editAppUser(decodeURIComponent('${accountKey}'))" ${isSelf ? "disabled title='Tidak dapat mengubah akun sendiri'" : "title='Ubah akses pengguna'"} class="p-2 text-sky-600 hover:bg-sky-50 rounded-lg disabled:opacity-40"><i class="fa-solid fa-pen-to-square"></i></button>
          <button type="button" onclick="removeAppUser(decodeURIComponent('${accountKey}'))" ${isSelf ? "disabled title='Tidak dapat menghapus akun sendiri'" : "title='Hapus akses pengguna'"} class="p-2 text-rose-600 hover:bg-rose-50 rounded-lg disabled:opacity-40"><i class="fa-solid fa-user-xmark"></i></button>
        </td>
      </tr>`;
      })
      .join("");
  }
  renderUsersPagination();
}

function renderUsersPagination() {
  const container = document.getElementById("usersPagination");
  if (!container) return;
  const total = window.appState.users.length;
  const size = window.appState.userPageSize || 10;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(window.appState.userPage || 1, pages);
  container.innerHTML = `<div class="text-xs text-slate-500">${total ? (page - 1) * size + 1 : 0}-${Math.min(page * size, total)} dari ${total} akun</div><div class="flex items-center gap-2"><label class="flex items-center gap-2 text-xs text-slate-500">Baris<select onchange="changeUserPageSize(this.value)" class="rounded-lg border border-slate-200 bg-white px-2 py-1.5">${[10, 25, 50].map((n) => `<option value="${n}" ${n === size ? "selected" : ""}>${n}</option>`).join("")}</select></label><button type="button" onclick="changeUserPage(-1)" ${page <= 1 ? "disabled" : ""} class="h-8 w-8 rounded-lg border disabled:opacity-40"><i class="fa-solid fa-chevron-left"></i></button><span class="min-w-16 text-center text-xs">${page} / ${pages}</span><button type="button" onclick="changeUserPage(1)" ${page >= pages ? "disabled" : ""} class="h-8 w-8 rounded-lg border disabled:opacity-40"><i class="fa-solid fa-chevron-right"></i></button></div>`;
}

window.changeUserPage = function (direction) {
  window.appState.userPage = Math.max(
    1,
    (window.appState.userPage || 1) + Number(direction),
  );
  renderUsersTable();
};

window.changeUserPageSize = function (size) {
  window.appState.userPageSize = Number(size) || 10;
  window.appState.userPage = 1;
  renderUsersTable();
};

window.openAppUserModal = function (email = "") {
  if (!isSuperAdmin())
    return showToast(
      "Hanya Super Admin yang dapat mengelola pengguna",
      "error",
    );
  const form = document.getElementById("formAppUser");
  if (!form) return;
  form.reset();
  document.getElementById("appUserOriginalEmail").value = "";
  document.getElementById("appUserEmail").disabled = false;
  document.getElementById("appUserEmail").value = "";
  document.getElementById("appUserRole").value = USER_ROLES.LOGISTICS;
  document.getElementById("appUserActive").checked = true;
  document.getElementById("appUserModalTitle").textContent = "Tambah Pengguna";
  if (email) {
    const account = window.appState.users.find((item) => item.id === email);
    if (!account) return;
    document.getElementById("appUserOriginalEmail").value = account.id;
    document.getElementById("appUserEmail").value = account.email || account.id;
    document.getElementById("appUserEmail").disabled = true;
    document.getElementById("appUserRole").value =
      account.role || USER_ROLES.LOGISTICS;
    document.getElementById("appUserActive").checked = account.active === true;
    document.getElementById("appUserModalTitle").textContent =
      "Atur Akses Pengguna";
  }
  const modal = document.getElementById("modalAppUser");
  modal?.classList.remove("hidden");
  modal?.classList.add("flex");
};

window.editAppUser = function (email) {
  window.openAppUserModal(email);
};

window.closeAppUserModal = function () {
  const modal = document.getElementById("modalAppUser");
  modal?.classList.add("hidden");
  modal?.classList.remove("flex");
};

window.saveAppUser = async function (event) {
  event.preventDefault();
  if (!isSuperAdmin())
    return showToast(
      "Hanya Super Admin yang dapat mengelola pengguna",
      "error",
    );
  const email = normalizeAccountEmail(
    document.getElementById("appUserEmail").value,
  );
  const originalEmail = document.getElementById("appUserOriginalEmail").value;
  const role = document.getElementById("appUserRole").value;
  const active = document.getElementById("appUserActive").checked;
  if (
    !email ||
    !email.includes("@") ||
    ![USER_ROLES.SUPER_ADMIN, USER_ROLES.LOGISTICS].includes(role)
  ) {
    showToast("Email Google atau role tidak valid", "error");
    return;
  }
  const existing = window.appState.users.find(
    (account) => account.id === originalEmail,
  );
  if (
    existing &&
    existing.role === USER_ROLES.SUPER_ADMIN &&
    existing.active === true &&
    (!active || role !== USER_ROLES.SUPER_ADMIN)
  ) {
    const activeSuperAdmins = window.appState.users.filter(
      (account) =>
        account.role === USER_ROLES.SUPER_ADMIN && account.active === true,
    ).length;
    if (activeSuperAdmins <= 1)
      return showToast("Minimal harus ada satu Super Admin aktif", "error");
  }
  const button = document.getElementById("saveAppUserBtn");
  setButtonLoading(button, true, "Menyimpan...");
  try {
    const now = new Date().toISOString();
    await setDoc(
      doc(db, "app_users", originalEmail || email),
      {
        email,
        role,
        active,
        updatedAt: now,
        ...(existing
          ? {}
          : {
              createdAt: now,
              createdBy: normalizeAccountEmail(window.appState.user?.email),
            }),
      },
      { merge: true },
    );
    showToast("Akses pengguna berhasil disimpan", "success");
    window.closeAppUserModal();
  } catch (error) {
    console.error("Gagal menyimpan akses pengguna:", error);
    showToast(error.message || "Akses pengguna gagal disimpan", "error");
  } finally {
    setButtonLoading(button, false);
  }
};

window.removeAppUser = async function (email) {
  if (!isSuperAdmin())
    return showToast(
      "Hanya Super Admin yang dapat mengelola pengguna",
      "error",
    );
  const account = window.appState.users.find((item) => item.id === email);
  if (
    !account ||
    normalizeAccountEmail(account.email || account.id) ===
      normalizeAccountEmail(window.appState.user?.email)
  )
    return;
  if (
    account.role === USER_ROLES.SUPER_ADMIN &&
    account.active === true &&
    window.appState.users.filter(
      (item) => item.role === USER_ROLES.SUPER_ADMIN && item.active === true,
    ).length <= 1
  ) {
    return showToast("Minimal harus ada satu Super Admin aktif", "error");
  }
  if (!window.confirm(`Cabut akses untuk ${account.email || email}?`)) return;
  try {
    await deleteDoc(doc(db, "app_users", email));
    showToast("Akses akun sudah dicabut", "success");
  } catch (error) {
    console.error("Gagal mencabut akses pengguna:", error);
    showToast(error.message || "Akses akun gagal dicabut", "error");
  }
};

function getKitchenProfile() {
  return getSppHeaderSettings();
}

function getKitchenLocation() {
  try {
    const settings = getKitchenProfile();
    const latitude = Number(settings.kitchenLatitude);
    const longitude = Number(settings.kitchenLongitude);
    if (
      settings.kitchenLatitude == null ||
      settings.kitchenLatitude === "" ||
      settings.kitchenLongitude == null ||
      settings.kitchenLongitude === "" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    )
      return null;
    return {
      latitude,
      longitude,
      name: settings.kitchenName || "Dapur MBG",
      address: settings.kitchenAddress || "",
    };
  } catch {
    return null;
  }
}

function getPMCoordinates(pm) {
  if (
    pm.latitude == null ||
    pm.longitude == null ||
    pm.latitude === "" ||
    pm.longitude === ""
  )
    return null;
  const latitude = Number(pm.latitude);
  const longitude = Number(pm.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  )
    return null;
  return { latitude, longitude };
}

function getPMRouteRequestData(kitchen) {
  if (!kitchen) return null;
  const destinations = window.appState.pms
    .map((pm) => ({ pm, coordinates: getPMCoordinates(pm) }))
    .filter((item) => item.coordinates);
  if (!destinations.length) return null;
  const points = [
    `${kitchen.longitude},${kitchen.latitude}`,
    ...destinations.map(
      ({ coordinates }) => `${coordinates.longitude},${coordinates.latitude}`,
    ),
  ];
  const key = JSON.stringify([
    points,
    destinations.map(({ pm }) => String(pm.id)),
  ]);
  return { destinations, points, key };
}

async function loadPMRouteMetrics(requestData) {
  if (!requestData || window.appState.pmRouteLoadingKey === requestData.key)
    return;
  window.appState.pmRouteLoadingKey = requestData.key;
  const params = new URLSearchParams({
    sources: "0",
    destinations: requestData.destinations
      .map((_, index) => index + 1)
      .join(";"),
    annotations: "distance,duration",
  });
  const coordinates = requestData.points.join(";");
  try {
    const response = await fetch(
      `https://router.project-osrm.org/table/v1/driving/${coordinates}?${params.toString()}`,
    );
    if (!response.ok) throw new Error("Layanan rute tidak merespons.");
    const result = await response.json();
    if (
      result.code !== "Ok" ||
      !result.distances?.[0] ||
      !result.durations?.[0]
    ) {
      throw new Error("Rute jalan tidak ditemukan.");
    }
    window.appState.pmRouteMetrics = {
      key: requestData.key,
      byId: Object.fromEntries(
        requestData.destinations.map(({ pm }, index) => [
          String(pm.id),
          result.distances[0][index] == null ||
          result.durations[0][index] == null
            ? null
            : {
                distanceMeters: result.distances[0][index],
                durationSeconds: result.durations[0][index],
              },
        ]),
      ),
    };
  } catch (error) {
    window.appState.pmRouteMetrics = {
      key: requestData.key,
      error: true,
      byId: {},
    };
    console.warn("PM road route estimates could not be loaded:", error);
  } finally {
    if (window.appState.pmRouteLoadingKey === requestData.key) {
      window.appState.pmRouteLoadingKey = null;
    }
    const currentKitchen = getKitchenLocation();
    const currentRequest = getPMRouteRequestData(currentKitchen);
    if (currentRequest?.key === requestData.key) renderPMCards();
  }
}

function formatRouteDistance(meters) {
  return meters < 1000
    ? `${Math.round(meters).toLocaleString("id-ID")} m`
    : `${(meters / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} km`;
}

function formatRouteDuration(seconds) {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours
    ? `${hours} jam${minutes ? ` ${minutes} menit` : ""}`
    : `${totalMinutes} menit`;
}

function renderPMCards() {
  const container = document.getElementById("pmCardsContainer");
  if (!container) return;

  renderPMMap();
  renderPMSummary();
  const kitchen = getKitchenLocation();
  const routeRequest = getPMRouteRequestData(kitchen);
  if (
    routeRequest &&
    window.appState.pmRouteMetrics?.key !== routeRequest.key
  ) {
    loadPMRouteMetrics(routeRequest);
  }
  const routeMetrics =
    window.appState.pmRouteMetrics?.key === routeRequest?.key
      ? window.appState.pmRouteMetrics
      : null;
  const inactivePMs = window.appState.pms.filter(
    (pm) => pm.status === "Nonaktif",
  );

  if (!window.appState.pmsLoaded) {
    container.innerHTML = `<div class="md:col-span-2 lg:col-span-3 rounded-2xl border border-sky-100 bg-white py-10 text-center text-sm font-medium text-sky-700"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat data penerima manfaat dari Firebase...</div>`;
    return;
  }

  const activePMs = window.appState.pms.filter(
    (pm) => (pm.status || "Aktif") === "Aktif",
  );
  if (!activePMs.length && !inactivePMs.length) {
    container.innerHTML = `<div class="md:col-span-2 lg:col-span-3 text-center py-10 text-sm text-slate-400">Belum ada data penerima manfaat</div>`;
    return;
  }

  container.innerHTML = `${
    activePMs.length
      ? activePMs
          .map((pm) => {
            const accent =
              {
                SD: "bg-sky-500",
                TK: "bg-amber-500",
                SMP: "bg-violet-500",
                SMA: "bg-rose-500",
                B3: "bg-emerald-500",
              }[pm.jenis] || "bg-sky-500";
            const cardTotal = getPMTotal(pm);
            const mitraIncentive = cardTotal * 2000;
            const pmCoordinates = getPMCoordinates(pm);
            const routeMetric = routeMetrics?.byId?.[String(pm.id)];
            const routeIsLoading = Boolean(
              routeRequest &&
              !routeMetrics &&
              window.appState.pmRouteLoadingKey === routeRequest.key,
            );
            const travelInfo =
              !kitchen || !pmCoordinates
                ? "Atur koordinat dapur dan lokasi PM untuk melihat rute."
                : routeMetric
                  ? `Rute jalan ${formatRouteDistance(routeMetric.distanceMeters)} Â· estimasi ${formatRouteDuration(routeMetric.durationSeconds)}.`
                  : routeIsLoading
                    ? "Menghitung jarak dan waktu rute jalan..."
                    : "Estimasi rute tidak tersedia. Gunakan Direction untuk membuka navigasi.";
            const directionUrl =
              !kitchen || !pmCoordinates
                ? ""
                : `https://www.google.com/maps/dir/?api=1&origin=${kitchen.latitude},${kitchen.longitude}&destination=${pmCoordinates.latitude},${pmCoordinates.longitude}&travelmode=driving`;
            const breakdown =
              pm.jenis === "SD"
                ? `Kelas 1-3: ${pm.kelas13 || 0} | Kelas 4-6: ${pm.kelas46 || 0} | Guru/Tendik: ${pm.guruTendik || 0}`
                : pm.jenis === "B3"
                  ? `Balita: ${pm.balita || 0} | Bumil: ${pm.bumil || 0} | Busui: ${pm.busui || 0}`
                  : `Target: ${pm.target || 0} | Guru/Tendik: ${pm.guruTendik || 0}`;
            const stats =
              pm.jenis === "SD"
                ? `<div><b>${pm.kelas13 || 0}</b><span>Kelas 1-3</span></div><div><b>${pm.kelas46 || 0}</b><span>Kelas 4-6</span></div><div><b>${pm.guruTendik || 0}</b><span>Guru/Tendik</span></div>`
                : pm.jenis === "B3"
                  ? `<div><b>${pm.balita || 0}</b><span>Balita</span></div><div><b>${pm.bumil || 0}</b><span>Bumil</span></div><div><b>${pm.busui || 0}</b><span>Busui</span></div>`
                  : `<div><b>${pm.target || 0}</b><span>Penerima</span></div><div><b>${pm.guruTendik || 0}</b><span>Guru/Tendik</span></div>`;

            return `
        <article class="pm-card">
          <div class="pm-card-accent ${accent}"></div>
          <div class="pm-card-head">
            <span class="pm-type-badge"><i class="fa-solid ${pm.jenis === "B3" ? "fa-people-group" : "fa-school"}"></i>${pm.jenis || "PM"}</span>
            <span class="pm-status pm-status-on"><i class="fa-solid fa-circle"></i>Aktif</span>
          </div>
          <div class="pm-card-title">
            <div><h4>${pm.nama || "-"}</h4><p><i class="fa-solid fa-location-dot"></i>${pm.lokasi || "Lokasi belum diisi"}</p></div>
            <div class="pm-total"><b>${cardTotal.toLocaleString("id-ID")}</b><span>Total Porsi</span></div>
          </div>
          <div class="pm-card-stats">${stats}</div>
          <div class="pm-card-incentive"><div><span>Insentif Mitra</span><small>${cardTotal.toLocaleString("id-ID")} penerima × Rp2.000</small></div><b>Rp ${mitraIncentive.toLocaleString("id-ID")}</b></div>
          <p class="pm-card-breakdown">${breakdown}</p>
          <div class="pm-card-coordinates"><i class="fa-solid fa-location-crosshairs"></i>${pm.latitude ?? "-"}, ${pm.longitude ?? "-"}</div>
          <div class="pm-card-travel"><div class="pm-travel-icon"><i class="fa-solid fa-route"></i></div><div class="pm-travel-content"><span class="pm-travel-label">Rute perjalanan</span><p class="pm-travel-info">${travelInfo}</p>${directionUrl ? `<a class="pm-direction-button" href="${directionUrl}" target="_blank" rel="noopener"><i class="fa-solid fa-diamond-turn-right"></i><span>Buka petunjuk arah</span><i class="fa-solid fa-arrow-up-right-from-square pm-direction-external"></i></a>` : ""}</div></div>
          <div class="pm-card-actions">
            <button onclick="editPM('${pm.id}')" class="pm-edit-button"><i class="fa-solid fa-pen-to-square"></i>Edit Data</button>
            <button onclick="togglePMStatus('${pm.id}')" class="rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700" title="Nonaktifkan PM"><i class="fa-solid fa-ban mr-1"></i>Nonaktifkan</button>
            <button onclick="promptDelete('pm', '${pm.id}', '${pm.nama || "PM"}')" class="pm-delete-button" title="Hapus PM"><i class="fa-solid fa-trash-can"></i></button>
          </div>
        </article>
      `;
          })
          .join("")
      : '<div class="md:col-span-2 lg:col-span-3 rounded-xl border border-slate-200 bg-white py-6 text-center text-sm text-slate-500">Tidak ada PM aktif saat ini.</div>'
  }${inactivePMs.length ? `<div class="md:col-span-2 lg:col-span-3 rounded-xl border border-slate-200 bg-slate-100 p-4"><h3 class="text-xs font-bold text-slate-700">PM Nonaktif (${inactivePMs.length})</h3><div class="mt-2 space-y-2">${inactivePMs.map((pm) => `<div class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3 text-xs"><div><strong>${escapeHtml(pm.nama || "PM")}</strong><p class="mt-1 text-[10px] text-slate-500">Catatan: ${escapeHtml(pm.catatanNonaktif || "Tidak ada catatan")}${pm.dinonaktifkanPada ? ` Â· ${new Date(pm.dinonaktifkanPada).toLocaleDateString("id-ID", { dateStyle: "medium" })}` : ""}</p></div><button onclick="togglePMStatus('${escapeHtml(pm.id)}')" class="rounded-lg bg-emerald-50 px-3 py-2 text-[10px] font-bold text-emerald-700"><i class="fa-solid fa-rotate-left mr-1"></i>Aktifkan kembali</button></div>`).join("")}</div></div>` : ""}`;
}

function getPMTotal(pm) {
  if ((pm.status || "Aktif") !== "Aktif") return 0;
  if (pm.jenis === "SD") {
    return (
      Number(pm.kelas13 || 0) +
      Number(pm.kelas46 || 0) +
      Number(pm.guruTendik || 0)
    );
  }
  if (pm.jenis === "B3") {
    return (
      Number(pm.balita || 0) + Number(pm.bumil || 0) + Number(pm.busui || 0)
    );
  }
  return Number(pm.target || 0) + Number(pm.guruTendik || 0);
}

function renderPMMap() {
  const mapContainer = document.getElementById("pmMap");
  if (!mapContainer || !window.L) return;

  if (!window.appState.pmMap) {
    window.appState.pmMap = window.L.map(mapContainer, {
      zoomControl: false,
      attributionControl: true,
    }).setView([-2.5, 118], 5);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(window.appState.pmMap);
    window.appState.pmMapMarkers = window.L.layerGroup().addTo(
      window.appState.pmMap,
    );
  }

  window.appState.pmMapMarkers.clearLayers();
  const bounds = [];
  const kitchen = getKitchenLocation();
  const mapNote = document.getElementById("pmMapNote");
  if (mapNote) {
    mapNote.textContent = kitchen
      ? "Jarak dan waktu kartu dihitung dari rute jalan."
      : "Atur koordinat dapur di Pengaturan untuk menampilkan pin dan jarak.";
  }
  if (kitchen) {
    const kitchenIcon = window.L.divIcon({
      className: "pm-map-kitchen-marker",
      html: '<span><i class="fa-solid fa-utensils"></i></span>',
      iconSize: [40, 40],
      iconAnchor: [20, 38],
      popupAnchor: [0, -34],
    });
    window.L.marker([kitchen.latitude, kitchen.longitude], {
      icon: kitchenIcon,
    })
      .bindPopup(
        `<div class="pm-map-popup"><strong>${escapeHtml(kitchen.name)}</strong><span>${escapeHtml(kitchen.address || "Lokasi dapur")}</span></div>`,
      )
      .addTo(window.appState.pmMapMarkers);
    bounds.push([kitchen.latitude, kitchen.longitude]);
  }
  window.appState.pms
    .filter((pm) => (pm.status || "Aktif") === "Aktif")
    .forEach((pm) => {
      const coordinates = getPMCoordinates(pm);
      if (!coordinates) return;
      const { latitude, longitude } = coordinates;
      const markerConfig = {
        SD: { color: "#0284c7", icon: "fa-school" },
        TK: { color: "#f59e0b", icon: "fa-school" },
        SMP: { color: "#8b5cf6", icon: "fa-school" },
        SMA: { color: "#ef4444", icon: "fa-school" },
        B3: { color: "#10b981", icon: "fa-house-medical" },
      };
      const marker = markerConfig[pm.jenis] || markerConfig.SD;
      const markerIcon = window.L.divIcon({
        className: "pm-map-marker",
        html: `<span class="${pm.jenis === "B3" ? "pm-marker-health" : "pm-marker-school"}" style="--marker-color: ${marker.color}"><i class="fa-solid ${marker.icon}"></i></span>`,
        iconSize: [36, 44],
        iconAnchor: [18, 42],
        popupAnchor: [0, -38],
      });
      window.L.marker([latitude, longitude], { icon: markerIcon })
        .bindPopup(
          `<div class="pm-map-popup"><strong>${pm.nama || "Penerima Manfaat"}</strong><span>${pm.jenis || "PM"} &middot; ${pm.lokasi || "-"}</span><b>${getPMTotal(pm).toLocaleString("id-ID")} porsi total</b><button onclick="editPM('${pm.id}')">Edit data</button></div>`,
        )
        .addTo(window.appState.pmMapMarkers);
      bounds.push([latitude, longitude]);
    });

  if (bounds.length) {
    window.appState.pmMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  } else {
    window.appState.pmMap.setView([-2.5, 118], 5);
  }
  setTimeout(() => window.appState.pmMap?.invalidateSize(), 100);
}

function renderPMSummary() {
  const container = document.getElementById("pmSummaryContainer");
  if (!container) return;

  if (!window.appState.pmsLoaded) {
    container.innerHTML = `
      <div class="pm-summary-loading" role="status" aria-live="polite">
        <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
        <span>Memuat porsi, pagu, dan insentif mitra...</span>
      </div>
    `;
    return;
  }

  let porsiBesar = 0;
  let porsiKecil = 0;
  window.appState.pms
    .filter((pm) => (pm.status || "Aktif") === "Aktif")
    .forEach((pm) => {
      if (pm.jenis === "SD") {
        porsiBesar += Number(pm.kelas46 || 0);
        porsiKecil += Number(pm.kelas13 || 0);
        porsiBesar += Number(pm.guruTendik || 0);
      } else if (pm.jenis === "B3") {
        porsiBesar += Number(pm.bumil || 0) + Number(pm.busui || 0);
        porsiKecil += Number(pm.balita || 0);
      } else if (["SMP", "SMA"].includes(pm.jenis)) {
        porsiBesar += Number(pm.target || 0);
        porsiBesar += Number(pm.guruTendik || 0);
      } else if (pm.jenis === "TK") {
        porsiKecil += Number(pm.target || 0);
        porsiBesar += Number(pm.guruTendik || 0);
      }
    });
  const totalPagu = porsiBesar * 10000 + porsiKecil * 8000;
  const totalPenerima = window.appState.pms
    .filter((pm) => (pm.status || "Aktif") === "Aktif")
    .reduce((total, pm) => total + getPMTotal(pm), 0);
  const totalInsentifMitra = totalPenerima * 2000;

  container.innerHTML = `
    <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
      <p class="text-xs font-bold uppercase tracking-wider text-slate-400">Total Porsi Besar</p>
      <p class="text-2xl font-extrabold text-emerald-600 mt-2">${porsiBesar.toLocaleString("id-ID")}</p>
      <p class="text-[11px] text-slate-500 mt-1">Guru/Tendik TK-SMA, SD 4-6, SMP, SMA, Bumil, Busui</p>
    </div>
    <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
      <p class="text-xs font-bold uppercase tracking-wider text-slate-400">Total Porsi Kecil</p>
      <p class="text-2xl font-extrabold text-sky-600 mt-2">${porsiKecil.toLocaleString("id-ID")}</p>
      <p class="text-[11px] text-slate-500 mt-1">Balita, TK, SD 1-3</p>
    </div>
    <div class="bg-white p-5 rounded-2xl border border-amber-200 shadow-sm">
      <p class="text-xs font-bold uppercase tracking-wider text-slate-400">Total Pagu</p>
      <p class="text-2xl font-extrabold text-amber-600 mt-2">Rp ${totalPagu.toLocaleString("id-ID")}</p>
      <p class="text-[11px] text-slate-500 mt-1">Besar Rp10.000/porsi Â· Kecil Rp8.000/porsi</p>
    </div>
    <div class="bg-white p-5 rounded-2xl border border-emerald-200 shadow-sm">
      <p class="text-xs font-bold uppercase tracking-wider text-slate-400">Total Insentif Mitra</p>
      <p class="text-2xl font-extrabold text-emerald-700 mt-2">Rp ${totalInsentifMitra.toLocaleString("id-ID")}</p>
      <p class="text-[11px] text-slate-500 mt-1">${totalPenerima.toLocaleString("id-ID")} penerima aktif × Rp2.000</p>
    </div>
  `;
}

function buildDailyPMSnapshot(pms, date) {
  const pmDetails = pms
    .filter((pm) => (pm.status || "Aktif") === "Aktif")
    .map((pm) => {
      let porsiBesar = 0;
      let porsiKecil = 0;
      if (pm.jenis === "SD") {
        porsiBesar = Number(pm.kelas46 || 0) + Number(pm.guruTendik || 0);
        porsiKecil = Number(pm.kelas13 || 0);
      } else if (pm.jenis === "B3") {
        porsiBesar = Number(pm.bumil || 0) + Number(pm.busui || 0);
        porsiKecil = Number(pm.balita || 0);
      } else if (["SMP", "SMA"].includes(pm.jenis)) {
        porsiBesar = Number(pm.target || 0) + Number(pm.guruTendik || 0);
      } else if (pm.jenis === "TK") {
        porsiBesar = Number(pm.guruTendik || 0);
        porsiKecil = Number(pm.target || 0);
      }
      const totalPenerima = getPMTotal(pm);
      return {
        pmId: String(pm.id),
        nama: pm.nama || "PM tanpa nama",
        jenis: pm.jenis || "PM",
        totalPenerima,
        porsiBesar,
        porsiKecil,
        pagu: porsiBesar * 10000 + porsiKecil * 8000,
        insentifMitra: totalPenerima * 2000,
      };
    });
  const porsiBesar = pmDetails.reduce((sum, item) => sum + item.porsiBesar, 0);
  const porsiKecil = pmDetails.reduce((sum, item) => sum + item.porsiKecil, 0);
  const totalPenerima = pmDetails.reduce(
    (sum, item) => sum + item.totalPenerima,
    0,
  );
  return {
    date,
    pmCount: pmDetails.length,
    totalPenerima,
    porsiBesar,
    porsiKecil,
    totalPagu: porsiBesar * 10000 + porsiKecil * 8000,
    totalInsentifMitra: totalPenerima * 2000,
    pmDetails,
    updatedAt: new Date().toISOString(),
    updatedBy: normalizeAccountEmail(window.appState.user?.email),
  };
}

async function persistDailyPMSnapshot(date, pms = window.appState.pms) {
  const record = buildDailyPMSnapshot(pms, date);
  await setDoc(doc(db, "pm_daily_history", date), record);
  const records = new Map(
    (window.appState.pmDailyHistory || []).map((item) => [
      String(item.id),
      item,
    ]),
  );
  records.set(date, { id: date, ...record });
  window.appState.pmDailyHistory = [...records.values()];
  window.appState.pmDailyHistoryLoaded = true;
  renderPMHistory();
  return record;
}

function renderPMHistory(error = null) {
  const tbody = document.getElementById("pmHistoryRows");
  if (!tbody) return;
  const dateInput = document.getElementById("pmHistoryDate");
  if (dateInput && !dateInput.value) dateInput.value = getLocalDateString();
  if (!window.appState.pmDailyHistoryLoaded) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="px-5 py-8 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat riwayat PM...</td></tr>';
    return;
  }
  if (error) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="px-5 py-8 text-center text-rose-600">Riwayat tidak dapat dimuat. Periksa aturan Firestore koleksi pm_daily_history.</td></tr>';
    return;
  }
  const records = [...(window.appState.pmDailyHistory || [])].sort((a, b) =>
    String(b.date || b.id).localeCompare(String(a.date || a.id)),
  );
  if (!records.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="px-5 py-8 text-center text-slate-400">Belum ada rekap harian. Simpan data PM atau tekan “Rekap hari ini”.</td></tr>';
    return;
  }
  tbody.innerHTML = records
    .map((record) => {
      const date = String(record.date || record.id || "");
      const dateLabel = /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? new Date(`${date}T00:00:00`).toLocaleDateString("id-ID", {
            dateStyle: "long",
          })
        : date;
      const details = Array.isArray(record.pmDetails) ? record.pmDetails : [];
      const detailMarkup = details.length
        ? `<details class="mt-1"><summary class="cursor-pointer text-[10px] font-semibold text-sky-700">Lihat rincian PM</summary><div class="mt-2 space-y-1">${details.map((item) => `<div class="flex flex-wrap justify-between gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-2 py-1.5"><span>${escapeHtml(item.nama)} · ${escapeHtml(item.jenis)} · ${Number(item.totalPenerima || 0).toLocaleString("id-ID")} penerima</span><span>Pagu ${formatRupiah(item.pagu)} · Insentif ${formatRupiah(item.insentifMitra)}</span></div>`).join("")}</div></details>`
        : "";
      return `<tr class="border-t border-slate-100 align-top"><td class="px-5 py-3 font-semibold text-slate-700">${escapeHtml(dateLabel)}${detailMarkup}</td><td class="px-5 py-3 text-right">${Number(record.pmCount || 0).toLocaleString("id-ID")}</td><td class="px-5 py-3 text-right font-semibold">${Number(record.totalPenerima || 0).toLocaleString("id-ID")}</td><td class="px-5 py-3 text-right">${Number(record.porsiBesar || 0).toLocaleString("id-ID")}</td><td class="px-5 py-3 text-right">${Number(record.porsiKecil || 0).toLocaleString("id-ID")}</td><td class="px-5 py-3 text-right font-semibold text-amber-700">${formatRupiah(record.totalPagu || 0)}</td><td class="px-5 py-3 text-right font-semibold text-emerald-700">${formatRupiah(record.totalInsentifMitra || 0)}</td></tr>`;
    })
    .join("");
}

window.saveDailyPMSnapshot = async function () {
  const date =
    document.getElementById("pmHistoryDate")?.value || getLocalDateString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return showToast("Pilih tanggal rekap yang valid.", "error");
  if (!window.appState.pmsLoaded)
    return showToast("Data PM masih dimuat. Coba lagi sebentar.", "info");
  const button = document.querySelector(
    'button[onclick="saveDailyPMSnapshot()"]',
  );
  setButtonLoading(button, true, "Merekam...");
  try {
    await persistDailyPMSnapshot(date);
    showToast(
      `Rekap PM tanggal ${new Date(`${date}T00:00:00`).toLocaleDateString("id-ID", { dateStyle: "long" })} berhasil disimpan.`,
      "success",
    );
  } catch (error) {
    showToast(`Rekap gagal disimpan: ${error.message}`, "error");
  } finally {
    setButtonLoading(button, false);
  }
};

window.updatePMDeactivationNoteVisibility = updatePMDeactivationNoteVisibility;

window.togglePMStatus = async function (id) {
  const pm = window.appState.pms.find((item) => String(item.id) === String(id));
  if (!pm) return;
  const isActive = (pm.status || "Aktif") === "Aktif";
  let updatedPM;
  if (isActive) {
    const note = window.prompt(`Catatan penonaktifan ${pm.nama || "PM"}:`);
    if (note === null) return;
    if (!note.trim()) {
      showToast("Catatan penonaktifan wajib diisi", "error");
      return;
    }
    updatedPM = {
      ...pm,
      status: "Nonaktif",
      catatanNonaktif: note.trim(),
      dinonaktifkanPada: new Date().toISOString(),
    };
  } else {
    updatedPM = {
      ...pm,
      status: "Aktif",
      catatanNonaktif: "",
      dinonaktifkanPada: "",
    };
  }
  try {
    await setDoc(doc(db, "pms", String(pm.id)), updatedPM);
    window.appState.pms = window.appState.pms.map((item) =>
      String(item.id) === String(pm.id) ? updatedPM : item,
    );
    let historySaved = false;
    try {
      await persistDailyPMSnapshot(
        document.getElementById("pmHistoryDate")?.value || getLocalDateString(),
      );
      historySaved = true;
    } catch (historyError) {
      console.warn("PM status saved, but daily recap failed:", historyError);
    }
    renderPMCards();
    updateDashboardMetrics();
    showToast(
      historySaved
        ? isActive
          ? "PM dinonaktifkan dan rekap harian diperbarui"
          : "PM diaktifkan kembali dan rekap harian diperbarui"
        : "Status PM tersimpan, tetapi rekap hariannya gagal diperbarui",
      historySaved ? "success" : "error",
    );
  } catch (error) {
    showToast(error.message || "Status PM gagal disimpan", "error");
  }
};

window.openModalPM = function () {
  const form = document.getElementById("formPM");
  if (!form) return;
  form.reset();
  document.getElementById("inputPMId").value = "";
  document.getElementById("inputCatatanNonaktifPM").value = "";
  document.getElementById("modalPMTitle").innerText = "Tambah Penerima Manfaat";
  renderPMTargetFields();
  document.getElementById("modalPM").classList.remove("hidden");
};

function updatePMDeactivationNoteVisibility() {
  const status = document.getElementById("inputStatusPM")?.value;
  const wrap = document.getElementById("pmDeactivationNoteWrap");
  wrap?.classList.toggle("hidden", status !== "Nonaktif");
}

window.editPM = function (id) {
  const pm = window.appState.pms.find((item) => String(item.id) === String(id));
  if (!pm) return;
  document.getElementById("inputPMId").value = pm.id;
  document.getElementById("inputJenisPM").value = pm.jenis || "SD";
  document.getElementById("inputStatusPM").value = pm.status || "Aktif";
  const deactivationNoteField = document.getElementById(
    "inputCatatanNonaktifPM",
  );
  if (deactivationNoteField)
    deactivationNoteField.value = pm.catatanNonaktif || "";
  updatePMDeactivationNoteVisibility();
  document.getElementById("inputNamaPM").value = pm.nama || "";
  document.getElementById("inputLokasiPM").value = pm.lokasi || "";
  document.getElementById("inputLatitudePM").value = pm.latitude ?? "";
  document.getElementById("inputLongitudePM").value = pm.longitude ?? "";
  document.getElementById("modalPMTitle").innerText = "Edit Penerima Manfaat";
  renderPMTargetFields();
  const values =
    pm.jenis === "SD"
      ? {
          inputKelas13PM: pm.kelas13,
          inputKelas46PM: pm.kelas46,
          inputGuruTendikPM: pm.guruTendik,
        }
      : pm.jenis === "B3"
        ? {
            inputBalitaPM: pm.balita,
            inputBumilPM: pm.bumil,
            inputBusuiPM: pm.busui,
          }
        : { inputTargetPM: pm.target, inputGuruTendikPM: pm.guruTendik };
  Object.entries(values).forEach(([fieldId, value]) => {
    const field = document.getElementById(fieldId);
    if (field) field.value = value ?? 0;
  });
  updatePMTotalInput();
  document.getElementById("modalPM").classList.remove("hidden");
};

window.renderPMTargetFields = function () {
  const typeInput = document.getElementById("inputJenisPM");
  const container = document.getElementById("pmTargetFields");
  if (!typeInput || !container) return;

  const fields =
    typeInput.value === "SD"
      ? [
          ["inputKelas13PM", "Jumlah Siswa Kelas 1-3", "210"],
          ["inputKelas46PM", "Jumlah Siswa Kelas 4-6", "200"],
          ["inputGuruTendikPM", "Jumlah Guru/Tendik", "0"],
        ]
      : typeInput.value === "B3"
        ? [
            ["inputBalitaPM", "Jumlah Balita", "0"],
            ["inputBumilPM", "Jumlah Bumil", "0"],
            ["inputBusuiPM", "Jumlah Busui", "0"],
          ]
        : [
            ["inputTargetPM", "Target Penerima", "450"],
            ...(["TK", "SMP", "SMA"].includes(typeInput.value)
              ? [["inputGuruTendikPM", "Jumlah Guru/Tendik", "0"]]
              : []),
          ];

  container.innerHTML = fields
    .map(
      ([id, label, placeholder]) => `
        <div>
          <label class="block font-semibold text-slate-700 mb-1">${label}</label>
          <input id="${id}" required min="0" type="number" placeholder="${placeholder}" class="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl outline-none" />
        </div>
      `,
    )
    .join("");
  container.oninput = updatePMTotalInput;
  updatePMTotalInput();
};

function updatePMTotalInput() {
  const totalField = document.getElementById("inputTotalPenerimaPM");
  const fields = document.getElementById("pmTargetFields");
  if (!totalField || !fields) return;
  const total = [...fields.querySelectorAll('input[type="number"]')].reduce(
    (sum, input) => sum + (Number(input.value) || 0),
    0,
  );
  totalField.value = String(total);
}

window.closeModalPM = function () {
  document.getElementById("modalPM")?.classList.add("hidden");
};

window.useCurrentLocationPM = function () {
  if (!navigator.geolocation) {
    showToast("Browser tidak mendukung lokasi perangkat", "error");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      document.getElementById("inputLatitudePM").value =
        position.coords.latitude.toFixed(6);
      document.getElementById("inputLongitudePM").value =
        position.coords.longitude.toFixed(6);
      showToast("Lokasi berhasil diambil", "success");
    },
    () =>
      showToast(
        "Lokasi tidak dapat diambil. Isi koordinat secara manual.",
        "error",
      ),
    { enableHighAccuracy: true, timeout: 10000 },
  );
};

window.savePM = async function (event) {
  event.preventDefault();
  const id = document.getElementById("inputPMId").value || "pm_" + Date.now();
  const jenis = document.getElementById("inputJenisPM").value;
  const breakdown =
    jenis === "SD"
      ? {
          kelas13: Number(document.getElementById("inputKelas13PM").value),
          kelas46: Number(document.getElementById("inputKelas46PM").value),
          guruTendik: Number(
            document.getElementById("inputGuruTendikPM").value,
          ),
        }
      : jenis === "B3"
        ? {
            balita: Number(document.getElementById("inputBalitaPM").value),
            bumil: Number(document.getElementById("inputBumilPM").value),
            busui: Number(document.getElementById("inputBusuiPM").value),
          }
        : {
            target: Number(document.getElementById("inputTargetPM").value),
            ...(["TK", "SMP", "SMA"].includes(jenis)
              ? {
                  guruTendik: Number(
                    document.getElementById("inputGuruTendikPM").value,
                  ),
                }
              : {}),
          };
  const existingPM =
    window.appState.pms.find((item) => String(item.id) === String(id)) || {};
  const pmStatus = document.getElementById("inputStatusPM").value;
  const deactivationNote =
    document.getElementById("inputCatatanNonaktifPM")?.value.trim() || "";
  if (pmStatus === "Nonaktif" && !deactivationNote) {
    showToast("Isi catatan alasan penonaktifan PM", "error");
    return;
  }
  if (pmStatus === "Aktif" && existingPM.status === "Nonaktif") {
    const confirmed = window.confirm(
      "Aktifkan kembali PM ini? Jumlah porsi dan pagu akan dihitung kembali.",
    );
    if (!confirmed) return;
  }
  const data = {
    id,
    jenis,
    nama: document.getElementById("inputNamaPM").value.trim(),
    target:
      jenis === "SD"
        ? breakdown.kelas13 + breakdown.kelas46
        : jenis === "B3"
          ? breakdown.balita + breakdown.bumil + breakdown.busui
          : breakdown.target,
    ...breakdown,
    totalPenerima: Object.values(breakdown).reduce(
      (sum, value) => sum + (Number(value) || 0),
      0,
    ),
    lokasi: document.getElementById("inputLokasiPM").value.trim(),
    latitude: Number(document.getElementById("inputLatitudePM").value),
    longitude: Number(document.getElementById("inputLongitudePM").value),
    status: pmStatus,
    catatanNonaktif: pmStatus === "Nonaktif" ? deactivationNote : "",
    dinonaktifkanPada:
      pmStatus === "Nonaktif"
        ? existingPM.dinonaktifkanPada || new Date().toISOString()
        : "",
  };

  const submitButton = event.submitter;
  setButtonLoading(submitButton, true, "Menyimpan...");
  try {
    await setDoc(doc(db, "pms", id), data);
    upsertPMInState(data);
    const recapDate =
      document.getElementById("pmHistoryDate")?.value || getLocalDateString();
    let historySaved = false;
    try {
      await persistDailyPMSnapshot(recapDate);
      historySaved = true;
    } catch (historyError) {
      console.warn("PM saved, but daily recap failed:", historyError);
    }
    renderPMCards();
    updateDashboardMetrics();
    showToast(
      historySaved
        ? "Data PM dan rekap hariannya berhasil disimpan"
        : "Data PM tersimpan, tetapi rekap harian gagal. Periksa aturan pm_daily_history.",
      historySaved ? "success" : "error",
    );
    closeModalPM();
  } catch (err) {
    upsertPMInState(data);
    renderPMCards();
    updateDashboardMetrics();
    showToast("Data PM disimpan secara lokal", "info");
    closeModalPM();
  } finally {
    setButtonLoading(submitButton, false);
  }
};

function upsertPMInState(pm) {
  const uniquePMs = new Map();
  [...window.appState.pms, pm].forEach((item) =>
    uniquePMs.set(String(item.id), item),
  );
  window.appState.pms = [...uniquePMs.values()];
}

function renderDokumenTable() {
  const tbody = document.getElementById("dokumenTableBody");
  if (!tbody) return;
  renderDriveQuota();

  const files = window.appState.dokumen;
  const pageCount = Math.max(
    1,
    Math.ceil(files.length / window.appState.drivePageSize),
  );
  window.appState.drivePage = Math.min(window.appState.drivePage, pageCount);
  const pageStart =
    (window.appState.drivePage - 1) * window.appState.drivePageSize;
  const pageFiles = files.slice(
    pageStart,
    pageStart + window.appState.drivePageSize,
  );
  const pageLabel = document.getElementById("drivePageLabel");
  const countLabel = document.getElementById("driveFilesCount");
  const previousButton = document.getElementById("drivePreviousPage");
  const nextButton = document.getElementById("driveNextPage");
  const pageSizeSelect = document.getElementById("drivePageSize");
  if (pageLabel)
    pageLabel.textContent = `Halaman ${window.appState.drivePage} / ${pageCount}`;
  if (countLabel)
    countLabel.textContent = `${files.length.toLocaleString("id-ID")} file`;
  if (previousButton) previousButton.disabled = window.appState.drivePage <= 1;
  if (nextButton) nextButton.disabled = window.appState.drivePage >= pageCount;
  if (pageSizeSelect)
    pageSizeSelect.value = String(window.appState.drivePageSize);

  document
    .getElementById("driveLayoutGridBtn")
    ?.classList.toggle(
      "drive-view-active",
      window.appState.driveLayout === "grid",
    );
  document
    .getElementById("driveLayoutListBtn")
    ?.classList.toggle(
      "drive-view-active",
      window.appState.driveLayout === "list",
    );

  if (!window.appState.dokumen.length) {
    if (
      !window.appState.driveLoaded &&
      window.appState.user &&
      window.appState.driveAccessToken
    ) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-sm font-medium text-sky-700"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat file dari Google Drive...</td></tr>`;
      return;
    }
    const emptyMessage = !window.appState.user
      ? "Login Google untuk melihat file Drive."
      : !window.appState.driveAccessToken
        ? "Login web tetap aktif. Klik Sambungkan Drive untuk memperbarui sesi Google Drive."
        : "Tidak ada file di Google Drive.";
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400">${emptyMessage}</td></tr>`;
    return;
  }

  if (window.appState.driveLayout === "grid") {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4"><div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">${pageFiles
      .map((file) => {
        const fileId = escapeHtml(file.id);
        const title = escapeHtml(file.name || "-");
        const category = escapeHtml(getDriveCategory(file));
        const compactType = getShortFileType(file);
        const icon = isDriveImage(file) ? "fa-image" : "fa-file-lines";
        return `<article class="drive-file-card"><div class="flex items-start justify-between gap-3"><button onclick="showDriveFileDetails('${fileId}')" class="drive-file-icon"><i class="fa-solid ${icon}"></i></button><span class="drive-file-type">${escapeHtml(compactType)}</span></div><button onclick="showDriveFileDetails('${fileId}')" class="drive-grid-title">${title}</button><span class="drive-file-category">${category}</span><div class="drive-grid-meta"><span>${formatFileSize(file.size)}</span><span>${formatDriveDate(file.modifiedTime)}</span></div><div class="drive-grid-actions"><button onclick="downloadDriveFile('${fileId}', this)" title="Download"><i class="fa-solid fa-download"></i></button><button onclick="handleDriveFileAction('edit','${fileId}')" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button><button onclick="handleDriveFileAction('delete','${fileId}')" title="Pindahkan ke Sampah"><i class="fa-solid fa-trash-can"></i></button></div></article>`;
      })
      .join("")}</div></td></tr>`;
    return;
  }

  tbody.innerHTML = pageFiles
    .map((documentItem) => {
      const fileId = escapeHtml(documentItem.id);
      const title = escapeHtml(documentItem.name || "-");
      const category = escapeHtml(getDriveCategory(documentItem));
      const mimeType = escapeHtml(getShortFileType(documentItem));
      const icon = isDriveImage(documentItem) ? "fa-image" : "fa-file-lines";
      return `
        <tr class="hover:bg-slate-50/80 transition-colors">
          <td class="py-3.5 px-5"><button onclick="showDriveFileDetails('${fileId}')" class="text-left font-bold text-slate-800 hover:text-sky-700"><i class="fa-solid ${icon} text-sky-600 mr-2"></i>${title}</button></td>
          <td class="py-3.5 px-5"><span class="drive-table-category">${category}</span></td>
          <td class="py-3.5 px-5 whitespace-nowrap">${formatDriveDate(documentItem.createdTime)}</td>
          <td class="py-3.5 px-5 whitespace-nowrap">${formatDriveDate(documentItem.modifiedTime)}</td>
          <td class="py-3.5 px-5 text-right whitespace-nowrap">${formatFileSize(documentItem.size)}</td>
          <td class="py-3.5 px-5 max-w-24 truncate" title="${escapeHtml(documentItem.mimeType || "-")}"><span class="drive-file-type">${escapeHtml(mimeType)}</span></td>
          <td class="py-3.5 px-5 text-right whitespace-nowrap"><button onclick="downloadDriveFile('${fileId}', this)" class="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg" title="Download"><i class="fa-solid fa-download"></i></button><button onclick="handleDriveFileAction('edit','${fileId}')" class="p-2 text-sky-600 hover:bg-sky-50 rounded-lg" title="Edit metadata"><i class="fa-solid fa-pen-to-square"></i></button><button onclick="handleDriveFileAction('delete','${fileId}')" class="p-2 text-red-600 hover:bg-red-50 rounded-lg" title="Pindahkan ke Sampah"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>
      `;
    })
    .join("");
}

window.setDriveLayout = function (layout) {
  window.appState.driveLayout = layout === "grid" ? "grid" : "list";
  renderDokumenTable();
};

window.changeDrivePage = function (direction) {
  const maxPage = Math.max(
    1,
    Math.ceil(window.appState.dokumen.length / window.appState.drivePageSize),
  );
  window.appState.drivePage = Math.min(
    maxPage,
    Math.max(1, window.appState.drivePage + direction),
  );
  renderDokumenTable();
};

window.changeDrivePageSize = function (value) {
  window.appState.drivePageSize = Number(value) || 10;
  window.appState.drivePage = 1;
  renderDokumenTable();
};

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function renderMasterBarangTable() {
  const tbody = document.getElementById("masterBarangTableBody");
  if (!tbody) return;
  const pagination = document.getElementById("masterBarangPagination");
  if (!window.appState.masterBarangLoaded) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-10 text-center text-sky-700"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat master barang...</td></tr>`;
    if (pagination) pagination.innerHTML = "";
    return;
  }
  if (window.appState.masterBarangError) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-8 text-center text-amber-800">${escapeHtml(window.appState.masterBarangError)}</td></tr>`;
    if (pagination) pagination.innerHTML = "";
    return;
  }
  const query = (document.getElementById("masterBarangSearch")?.value || "")
    .trim()
    .toLocaleLowerCase("id-ID");
  const category =
    document.getElementById("masterBarangFilterCategory")?.value || "ALL";
  const filterKey = `${category}|${query}`;
  if (window.appState.masterBarangFilterKey !== filterKey) {
    window.appState.masterBarangFilterKey = filterKey;
    window.appState.masterBarangPage = 1;
  }
  const items = (window.appState.masterBarang || [])
    .filter((item) => category === "ALL" || item.kategori === category)
    .filter((item) =>
      `${item.nama || ""} ${item.satuan || ""}`
        .toLocaleLowerCase("id-ID")
        .includes(query),
    )
    .sort((a, b) =>
      String(a.nama || "").localeCompare(String(b.nama || ""), "id"),
    );
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-8 text-center text-slate-400">${query ? "Master barang tidak ditemukan." : "Belum ada master barang. Tambahkan barang untuk digunakan pada form barang."}</td></tr>`;
    if (pagination) pagination.innerHTML = "";
    return;
  }
  const pageSize = Number(window.appState.masterBarangPageSize) || 10;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  window.appState.masterBarangPage = Math.min(
    pageCount,
    Math.max(1, Number(window.appState.masterBarangPage) || 1),
  );
  const pageStart = (window.appState.masterBarangPage - 1) * pageSize;
  const visibleItems = items.slice(pageStart, pageStart + pageSize);
  tbody.innerHTML = visibleItems
    .map((item) => {
      const id = encodeURIComponent(String(item.id));
      const categoryLabel =
        item.kategori === "operasional" ? "Operasional" : "Bahan Baku";
      const updatedAt = item.updatedAt
        ? new Date(item.updatedAt).toLocaleDateString("id-ID")
        : "-";
      return `<tr class="hover:bg-slate-50"><td class="px-5 py-4 font-bold text-slate-800">${escapeHtml(item.nama || "-")}</td><td class="px-5 py-4"><span class="rounded-full ${item.kategori === "operasional" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"} px-2.5 py-1 text-[10px] font-bold">${categoryLabel}</span></td><td class="px-5 py-4">${escapeHtml(item.satuan || "-")}</td><td class="px-5 py-4">${escapeHtml(updatedAt)}</td><td class="px-5 py-4 text-right"><button type="button" onclick="editMasterBarang(decodeURIComponent('${id}'))" class="rounded-lg p-2 text-sky-700 hover:bg-sky-50" title="Edit master"><i class="fa-solid fa-pen-to-square"></i></button><button type="button" onclick="deleteMasterBarang(decodeURIComponent('${id}'))" class="rounded-lg p-2 text-rose-600 hover:bg-rose-50" title="Hapus master"><i class="fa-solid fa-trash-can"></i></button></td></tr>`;
    })
    .join("");
  if (pagination) {
    const firstItem = pageStart + 1;
    const lastItem = Math.min(pageStart + pageSize, items.length);
    pagination.innerHTML = `<div class="text-xs text-slate-500">Menampilkan ${firstItem}-${lastItem} dari ${items.length} master</div><div class="flex items-center gap-2"><label class="flex items-center gap-2 text-xs text-slate-500">Baris<select onchange="changeMasterBarangPageSize(this.value)" class="rounded-lg border border-slate-200 bg-white px-2 py-1.5"><option value="10" ${pageSize === 10 ? "selected" : ""}>10</option><option value="25" ${pageSize === 25 ? "selected" : ""}>25</option><option value="50" ${pageSize === 50 ? "selected" : ""}>50</option></select></label><button type="button" onclick="changeMasterBarangPage(-1)" ${window.appState.masterBarangPage <= 1 ? "disabled" : ""} aria-label="Halaman sebelumnya" class="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><i class="fa-solid fa-chevron-left"></i></button><span class="min-w-20 text-center text-xs font-semibold text-slate-600">${window.appState.masterBarangPage} / ${pageCount}</span><button type="button" onclick="changeMasterBarangPage(1)" ${window.appState.masterBarangPage >= pageCount ? "disabled" : ""} aria-label="Halaman berikutnya" class="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><i class="fa-solid fa-chevron-right"></i></button></div>`;
  }
}

window.renderMasterBarangTable = renderMasterBarangTable;

window.changeMasterBarangPage = function (direction) {
  window.appState.masterBarangPage = Math.max(
    1,
    (Number(window.appState.masterBarangPage) || 1) + Number(direction),
  );
  renderMasterBarangTable();
};

window.changeMasterBarangPageSize = function (value) {
  window.appState.masterBarangPageSize = Number(value) || 10;
  window.appState.masterBarangPage = 1;
  renderMasterBarangTable();
};

window.openMasterBarangModal = function (id = "") {
  const form = document.getElementById("masterBarangForm");
  if (!form) return;
  form.reset();
  document.getElementById("masterBarangId").value = id;
  const item = window.appState.masterBarang.find(
    (entry) => String(entry.id) === String(id),
  );
  document.getElementById("masterBarangCategory").value =
    item?.kategori || "bahan_baku";
  document.getElementById("masterBarangName").value = item?.nama || "";
  document.getElementById("masterBarangUnit").value = item?.satuan || "";
  document.getElementById("masterBarangModalTitle").textContent = id
    ? "Edit Master Barang"
    : "Tambah Master Barang";
  document.getElementById("masterBarangModal").classList.remove("hidden");
  document.getElementById("masterBarangModal").classList.add("flex");
};

window.editMasterBarang = function (id) {
  window.openMasterBarangModal(id);
};

window.closeMasterBarangModal = function () {
  document.getElementById("masterBarangModal")?.classList.add("hidden");
  document.getElementById("masterBarangModal")?.classList.remove("flex");
};

window.saveMasterBarang = async function (event) {
  event.preventDefault();
  const id =
    document.getElementById("masterBarangId").value || `master_${Date.now()}`;
  const category = document.getElementById("masterBarangCategory").value;
  const name = document.getElementById("masterBarangName").value.trim();
  const unit = document.getElementById("masterBarangUnit").value.trim();
  const duplicate = window.appState.masterBarang.some(
    (item) =>
      String(item.id) !== id &&
      item.kategori === category &&
      String(item.nama || "")
        .trim()
        .toLocaleLowerCase("id-ID") === name.toLocaleLowerCase("id-ID"),
  );
  if (duplicate)
    return showToast("Nama barang sudah ada pada kategori tersebut", "error");
  const existing = window.appState.masterBarang.find(
    (item) => String(item.id) === id,
  );
  const data = {
    kategori: category,
    nama: name,
    satuan: unit,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const submitButton = event.submitter;
  setButtonLoading(submitButton, true, "Menyimpan...");
  try {
    await setDoc(doc(db, "master_items", id), data);
    window.closeMasterBarangModal();
    showToast("Master barang berhasil disimpan", "success");
  } catch (error) {
    showToast(error.message || "Master barang gagal disimpan", "error");
  } finally {
    setButtonLoading(submitButton, false);
  }
};

window.deleteMasterBarang = async function (id) {
  const item = window.appState.masterBarang.find(
    (entry) => String(entry.id) === String(id),
  );
  if (!item || !window.confirm(`Hapus master barang "${item.nama}"?`)) return;
  try {
    await deleteDoc(doc(db, "master_items", String(id)));
    showToast("Master barang berhasil dihapus", "success");
  } catch (error) {
    showToast(error.message || "Master barang gagal dihapus", "error");
  }
};

window.refreshMasterBarangOptions = function (fallbackItem = null) {
  const select = document.getElementById("inputMasterBarang");
  if (!select) return;
  const category = isOperationalPage() ? "operasional" : "bahan_baku";
  const editingId = document.getElementById("barangId")?.value || "";
  const currentItem =
    fallbackItem ||
    (editingId
      ? getCurrentBarangItems().find(
          (item) => String(item.id) === String(editingId),
        )
      : null);
  const matchingItems = (window.appState.masterBarang || [])
    .filter((item) => item.kategori === category)
    .sort((a, b) =>
      String(a.nama || "").localeCompare(String(b.nama || ""), "id"),
    );
  const linkedMaster = currentItem
    ? matchingItems.find(
        (item) =>
          (currentItem.masterItemId &&
            String(item.id) === String(currentItem.masterItemId)) ||
          (String(item.nama || "")
            .trim()
            .toLocaleLowerCase("id-ID") ===
            String(currentItem.nama || currentItem.name || "")
              .trim()
              .toLocaleLowerCase("id-ID") &&
            String(item.satuan || "")
              .trim()
              .toLocaleLowerCase("id-ID") ===
              String(currentItem.satuan || "")
                .trim()
                .toLocaleLowerCase("id-ID")),
      )
    : null;
  const selectedValue = select.value;
  const hasFallback = currentItem && !linkedMaster;
  const placeholder = !window.appState.masterBarangLoaded
    ? "Memuat master barang..."
    : window.appState.masterBarangError
      ? "Master barang tidak dapat diakses"
      : matchingItems.length
        ? "Pilih barang dari master"
        : "Belum ada master pada kategori ini";
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${matchingItems.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.nama)} · ${escapeHtml(item.satuan)}</option>`).join("")}`;
  if (hasFallback) {
    const fallbackValue = `legacy:${currentItem.id}`;
    select.add(
      new Option(
        `${currentItem.nama || currentItem.name || "Barang lama"} · ${currentItem.satuan || "unit"} (belum di master)`,
        fallbackValue,
      ),
    );
    select.value = fallbackValue;
    window.selectMasterBarangForEntry(fallbackValue, currentItem);
  } else if (linkedMaster) {
    select.value = String(linkedMaster.id);
    window.selectMasterBarangForEntry(select.value);
  } else if (matchingItems.some((item) => String(item.id) === selectedValue)) {
    select.value = selectedValue;
  } else {
    select.value = "";
    window.selectMasterBarangForEntry("");
  }
};

window.selectMasterBarangForEntry = function (masterId, fallbackItem = null) {
  const nameInput = document.getElementById("inputNamaBarang");
  const unitInput = document.getElementById("inputSatuanBarang");
  const item = window.appState.masterBarang.find(
    (entry) => String(entry.id) === String(masterId),
  );
  if (item) {
    if (nameInput) nameInput.value = item.nama || "";
    if (unitInput) unitInput.value = item.satuan || "";
  } else if (String(masterId || "").startsWith("legacy:") && fallbackItem) {
    if (nameInput)
      nameInput.value = fallbackItem.nama || fallbackItem.name || "";
    if (unitInput) unitInput.value = fallbackItem.satuan || "";
  } else {
    if (nameInput) nameInput.value = "";
    if (unitInput) unitInput.value = "";
  }
};

window.openModalBarang = function () {
  document.getElementById("formBarang").reset();
  document.getElementById("barangId").value = "";
  window.refreshMasterBarangOptions();
  document.getElementById("modalBarangTitle").innerText = isOperationalPage()
    ? "Tambah Barang Operasional"
    : "Tambah Barang Baru";
  document.getElementById("inputTanggalBarang").value = new Date()
    .toISOString()
    .split("T")[0];
  document.getElementById("modalBarang").classList.remove("hidden");
};

function formatRupiah(value) {
  const amount = Number(String(value ?? "").replace(/\D/g, ""));
  return amount ? `Rp ${amount.toLocaleString("id-ID")}` : "Rp 0";
}

window.formatHargaBarang = function (input) {
  input.value = formatRupiah(input.value);
};

window.closeModalBarang = function () {
  document.getElementById("modalBarang").classList.add("hidden");
};

window.openDetailBarang = function (id) {
  const item = getCurrentBarangItems().find((b) => String(b.id) === String(id));
  if (!item) return;
  window.appState.selectedBarangId = item.id;

  const latestArrival = getLatestArrival(item);
  const firebasePhoto =
    item.statusAdmin === "ACC"
      ? latestArrival?.photoDataUrl ||
        (latestArrival?.photoId
          ? window.appState.arrivalPhotoCache?.[latestArrival.photoId]
          : "") ||
        latestArrival?.photoUrl ||
        item.fotoPenerimaan ||
        item.foto ||
        item.fotoUrl ||
        item.imageUrl ||
        (latestArrival?.photoId ? "" : item.img) ||
        ""
      : "";
  document.getElementById("detailFoto").src = firebasePhoto;
  if (!firebasePhoto && latestArrival?.photoId && item.statusAdmin === "ACC") {
    document.getElementById("detailFoto").classList.remove("hidden");
    document.getElementById("detailFoto").src = "";
    getDoc(doc(db, "barang_arrival_photos", String(latestArrival.photoId)))
      .then((photoSnapshot) => {
        const photoData = photoSnapshot.exists() ? photoSnapshot.data() : null;
        const dataUrl =
          photoData?.dataUrl ||
          photoData?.base64 ||
          photoData?.foto ||
          photoData?.image ||
          "";
        if (!dataUrl) return;
        window.appState.arrivalPhotoCache ||= {};
        window.appState.arrivalPhotoCache[latestArrival.photoId] = dataUrl;
        if (String(window.appState.selectedBarangId) === String(item.id)) {
          const photoElement = document.getElementById("detailFoto");
          photoElement.src = dataUrl;
          photoElement.classList.remove("hidden");
        }
      })
      .catch((error) => console.warn("Could not load arrival photo:", error));
  }
  document.getElementById("detailFoto").onerror = () => {
    document.getElementById("detailFoto").classList.add("hidden");
  };
  document
    .getElementById("detailFoto")
    .classList.toggle("hidden", !firebasePhoto);
  document.getElementById("detailNama").innerText =
    item.nama || item.name || "-";
  document.getElementById("detailTipeBadge").innerText = item.tipe || "Utama";
  document.getElementById("detailHarga").innerText = formatRupiah(item.harga);
  document.getElementById("detailTanggal").innerText = item.tanggal || "-";
  document.getElementById("detailKebutuhan").innerText = item.kebutuhan || 0;
  document.getElementById("detailDatang").innerText =
    getItemReceivedQuantity(item);
  document.getElementById("detailSatuan").innerText = item.satuan || "-";
  document.getElementById("detailStatusAdmin").innerText =
    item.statusAdmin || "Pending";
  document.getElementById("detailStatusSuperAdmin").innerText =
    item.statusSuperAdmin || "Pending";
  document
    .getElementById("approveAdminBtn")
    .classList.toggle("hidden", item.statusAdmin === "ACC");
  document
    .getElementById("approveSuperAdminBtn")
    .classList.toggle("hidden", item.statusSuperAdmin === "ACC");

  document.getElementById("modalDetailBarang").classList.remove("hidden");
};

window.closeDetailBarang = function () {
  document.getElementById("modalDetailBarang").classList.add("hidden");
};

window.editBarang = function (id) {
  const item = getCurrentBarangItems().find((b) => String(b.id) === String(id));
  if (!item) return;

  document.getElementById("barangId").value = item.id;
  window.refreshMasterBarangOptions(item);
  document.getElementById("inputNamaBarang").value =
    item.nama || item.name || "";
  document.getElementById("inputTanggalBarang").value = item.tanggal || "";
  document.getElementById("inputTipeBarang").value = item.tipe || "Utama";
  document.getElementById("inputHargaBarang").value = item.harga
    ? formatRupiah(item.harga)
    : "";
  document.getElementById("inputSatuanBarang").value = item.satuan || "";
  document.getElementById("inputKebutuhanBarang").value = item.kebutuhan || "";

  document.getElementById("modalBarangTitle").innerText = isOperationalPage()
    ? "Edit Barang Operasional"
    : "Edit Data Barang";
  document.getElementById("modalBarang").classList.remove("hidden");
};

window.saveBarang = async function (e) {
  e.preventDefault();
  const id = document.getElementById("barangId").value || "b_" + Date.now();
  const currentItems = getCurrentBarangItems();
  const existing = currentItems.find((b) => String(b.id) === String(id)) || {};
  const masterSelection = document.getElementById("inputMasterBarang").value;
  const selectedMaster = window.appState.masterBarang.find(
    (item) => String(item.id) === String(masterSelection),
  );
  const expectedCategory = isOperationalPage() ? "operasional" : "bahan_baku";
  const isLegacySelection = masterSelection.startsWith("legacy:");
  if (
    (!existing.id && !selectedMaster) ||
    (selectedMaster && selectedMaster.kategori !== expectedCategory)
  )
    return showToast(
      "Pilih master barang sesuai kategori halaman ini",
      "error",
    );
  if (isLegacySelection && !existing.id)
    return showToast(
      "Pilih barang dari Master Barang sebelum menyimpan",
      "error",
    );

  const data = {
    id,
    nama:
      selectedMaster?.nama || document.getElementById("inputNamaBarang").value,
    masterItemId: selectedMaster?.id || existing.masterItemId || "",
    kategoriBarang: expectedCategory,
    tanggal: document.getElementById("inputTanggalBarang").value,
    tipe: document.getElementById("inputTipeBarang").value,
    harga: Number(
      document.getElementById("inputHargaBarang").value.replace(/\D/g, ""),
    ),
    kebutuhan: Number(
      document.getElementById("inputKebutuhanBarang")?.value ||
        existing.kebutuhan ||
        0,
    ),
    satuan:
      selectedMaster?.satuan ||
      document.getElementById("inputSatuanBarang").value.trim(),
    datang: existing.datang || 0,
    stockHistory: Array.isArray(existing.stockHistory)
      ? existing.stockHistory
      : [],
    arrivalHistory: Array.isArray(existing.arrivalHistory)
      ? existing.arrivalHistory
      : [],
    statusAdmin: existing.statusAdmin || "Pending",
    statusSuperAdmin: existing.statusSuperAdmin || "Pending",
    img: existing.img || "",
  };

  try {
    await setDoc(doc(db, getCurrentBarangCollection(), id), data);
    showToast(
      isOperationalPage()
        ? "Data barang operasional berhasil disimpan!"
        : "Data barang berhasil disimpan!",
      "success",
    );
  } catch (err) {
    const idx = currentItems.findIndex((b) => String(b.id) === String(id));
    if (idx >= 0) currentItems[idx] = data;
    else currentItems.unshift(data);
    renderBarangTable();
    if (!isOperationalPage()) renderStockTable();
    showToast(
      isOperationalPage()
        ? "Barang operasional disimpan secara lokal"
        : "Disimpan secara lokal",
      "info",
    );
  }
  closeModalBarang();
};

window.approveBarang = async function (id, statusField) {
  const currentItems = getCurrentBarangItems();
  const item = currentItems.find((barang) => String(barang.id) === String(id));
  if (!item) return;

  const updatedItem = { ...item, [statusField]: "ACC" };
  try {
    await setDoc(
      doc(db, getCurrentBarangCollection(), String(id)),
      updatedItem,
    );
  } catch (err) {
    const index = currentItems.findIndex(
      (barang) => String(barang.id) === String(id),
    );
    if (index >= 0) currentItems[index] = updatedItem;
    renderBarangTable();
    updateDashboardMetrics();
  }

  openDetailBarang(id);
  showToast("Data berhasil di-approve", "success");
};

window.openModalSupplier = function () {
  document.getElementById("formSupplier").reset();
  document.getElementById("supplierId").value = "";
  document.getElementById("modalSupplierTitle").innerText =
    "Tambah Supplier Mitra";
  document.getElementById("modalSupplier").classList.remove("hidden");
};

window.closeModalSupplier = function () {
  document.getElementById("modalSupplier").classList.add("hidden");
};

window.editSupplier = function (id) {
  const sup = window.appState.suppliers.find(
    (s) => String(s.id) === String(id),
  );
  if (!sup) return;

  document.getElementById("supplierId").value = sup.id;
  document.getElementById("inputNamaSupplier").value = sup.nama || "";
  document.getElementById("inputKontakSupplier").value = sup.kontak || "";
  document.getElementById("inputKategoriSupplier").value = sup.kategori || "";
  document.getElementById("inputAlamatSupplier").value = sup.alamat || "";
  document.getElementById("inputNamaBank").value = sup.namaBank || "";
  document.getElementById("inputNoRekening").value = sup.noRekening || "";
  document.getElementById("inputNamaRekening").value = sup.namaRekening || "";

  document.getElementById("modalSupplierTitle").innerText =
    "Edit Data Supplier";
  document.getElementById("modalSupplier").classList.remove("hidden");
};

window.saveSupplier = async function (e) {
  e.preventDefault();
  const id = document.getElementById("supplierId").value || "s_" + Date.now();

  const data = {
    id,
    nama: document.getElementById("inputNamaSupplier").value,
    kontak: document.getElementById("inputKontakSupplier").value,
    kategori: document.getElementById("inputKategoriSupplier").value,
    alamat: document.getElementById("inputAlamatSupplier").value,
    namaBank: document.getElementById("inputNamaBank").value,
    noRekening: document.getElementById("inputNoRekening").value,
    namaRekening: document.getElementById("inputNamaRekening").value,
  };

  try {
    await setDoc(doc(db, "suppliers", id), data);
    showToast("Data supplier berhasil disimpan!", "success");
  } catch (err) {
    const idx = window.appState.suppliers.findIndex(
      (s) => String(s.id) === String(id),
    );
    if (idx >= 0) window.appState.suppliers[idx] = data;
    else window.appState.suppliers.unshift(data);
    renderSupplierTable();
    showToast("Supplier disimpan secara lokal", "info");
  }
  closeModalSupplier();
};

window.promptDelete = function (type, id, name) {
  window.appState.pendingDelete = { type, id, name };
  document.getElementById("deleteConfirmText").innerText =
    `Apakah Anda yakin ingin menghapus ${type} "${name}"?`;
  document.getElementById("modalConfirmDelete").classList.remove("hidden");
  document.getElementById("modalConfirmDelete").classList.add("flex");
};

window.promptStockDelete = function (id) {
  const item = window.appState.inventoryItems.find(
    (entry) => String(entry.id) === String(id),
  );
  if (!item) return;
  window.appState.pendingDelete = {
    type: "inventory_item",
    id: item.id,
    name: item.nama || item.name || "Barang",
  };
  document.getElementById("deleteConfirmText").innerText =
    `Hapus ${item.nama || item.name || "barang stok"} beserta saldo dan seluruh riwayatnya?`;
  document.getElementById("modalConfirmDelete").classList.remove("hidden");
  document.getElementById("modalConfirmDelete").classList.add("flex");
};

window.closeConfirmDelete = function () {
  document.getElementById("modalConfirmDelete").classList.add("hidden");
  window.appState.pendingDelete = null;
};

window.executePendingDelete = async function () {
  const pending = window.appState.pendingDelete;
  if (!pending) return;

  const confirmButton = document.getElementById("deleteConfirmBtn");
  setButtonLoading(confirmButton, true, "Menghapus...");

  const { type, id, name } = pending;
  const colName =
    type === "inventory_item"
      ? "inventory_items"
      : type === "barang"
        ? "mbg_items"
        : type === "operasional"
          ? "operational_items"
          : type === "supplier"
            ? "suppliers"
            : type === "pm"
              ? "pms"
              : type;

  try {
    await deleteDoc(doc(db, colName, String(id)));
    let deleteMessage = `${name} telah dihapus dari database`;
    if (type === "inventory_item") {
      window.appState.inventoryItems = window.appState.inventoryItems.filter(
        (item) => String(item.id) !== String(id),
      );
      renderStockTable();
      renderAdminPwaStock();
      renderAdminPwaDashboard();
    } else if (type === "barang") {
      window.appState.barang = window.appState.barang.filter(
        (item) => String(item.id) !== String(id),
      );
      renderBarangTable();
      renderStockTable();
      renderAdminPwaStock();
      renderAdminPwaDashboard();
    } else if (type === "operasional") {
      window.appState.barangOperasional =
        window.appState.barangOperasional.filter(
          (item) => String(item.id) !== String(id),
        );
      renderBarangTable();
    } else if (type === "pm") {
      window.appState.pms = window.appState.pms.filter(
        (pm) => String(pm.id) !== String(id),
      );
      renderPMCards();
      try {
        await persistDailyPMSnapshot(
          document.getElementById("pmHistoryDate")?.value ||
            getLocalDateString(),
        );
        deleteMessage = `${name} dihapus dan rekap harian diperbarui`;
      } catch (historyError) {
        console.warn("PM deleted, but daily recap failed:", historyError);
        deleteMessage = `${name} dihapus, tetapi rekap harian gagal diperbarui`;
      }
    }
    showToast(
      deleteMessage,
      type === "pm" && deleteMessage.includes("gagal") ? "error" : "success",
    );
  } catch (err) {
    if (type === "supplier") {
      window.appState.suppliers = window.appState.suppliers.filter(
        (s) => String(s.id) !== String(id),
      );
      renderSupplierTable();
    } else if (type === "pm") {
      window.appState.pms = window.appState.pms.filter(
        (pm) => String(pm.id) !== String(id),
      );
      renderPMCards();
    }
    if (type === "inventory_item")
      showToast(
        err.message || "Barang stok gagal dihapus dari database",
        "error",
      );
    else if (type === "barang" || type === "operasional")
      showToast(err.message || "Barang gagal dihapus dari database", "error");
    else showToast(`${name} dihapus secara lokal`, "info");
  } finally {
    setButtonLoading(confirmButton, false);
  }
  closeConfirmDelete();
  updateDashboardMetrics();
};

window.addEventListener("load", () => {
  if (isOperationalPage()) {
    document.title = "Kelola Operasional | MBG System";
    document.getElementById("pageTitle").textContent =
      "Kelola Barang Operasional";
    document.getElementById("pageSubTitle").textContent =
      "Data kebutuhan barang operasional seperti tali rafia, masker, tisu, dan lainnya";
    document.querySelector("main section h2").textContent =
      "Daftar Barang Operasional";
    document.querySelector("#inputNamaBarang").placeholder =
      "Contoh: Tali rafia, masker, tisu";
    document.querySelector(
      "#inputNamaBarang",
    ).previousElementSibling.textContent = "Nama Barang Operasional";
    document.querySelector(
      'button[onclick="openModalBarang()"] span',
    ).textContent = "Tambah Barang Operasional";
    document
      .querySelector('button[onclick="openRabModal()"]')
      ?.classList.add("hidden");
  }

  const now = new Date();
  const options = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  const currentDateElement = document.getElementById("currentDateStr");
  if (currentDateElement) {
    currentDateElement.innerText = now.toLocaleDateString("id-ID", options);
  }

  const adminDateFilter = document.getElementById("adminArrivalFilterDate");
  if (adminDateFilter && !adminDateFilter.value)
    adminDateFilter.value = getLocalDateString();

  const arrivalPhotoInput = document.getElementById("adminArrivalPhoto");
  const dropZone = document.getElementById("adminArrivalDropZone");
  const arrivalSubmitButton = document.getElementById(
    "adminArrivalSubmitButton",
  );
  let arrivalPhotoValidationRequest = 0;
  const applyArrivalPhoto = (photo) => {
    const preview = document.getElementById("adminArrivalPhotoPreview");
    const photoName = document.getElementById("adminArrivalPhotoName");
    const validation = document.getElementById("adminArrivalPhotoValidation");
    const requestId = ++arrivalPhotoValidationRequest;
    if (arrivalSubmitButton) arrivalSubmitButton.disabled = true;
    if (adminArrivalPhotoPreviewUrl) {
      URL.revokeObjectURL(adminArrivalPhotoPreviewUrl);
      adminArrivalPhotoPreviewUrl = null;
    }
    if (!photo || !preview) {
      preview?.classList.add("hidden");
      if (photoName)
        photoName.textContent = "JPG, PNG, atau WebP Â· Maksimal 20 MB";
      if (validation)
        validation.textContent =
          "Pilih foto JPG, PNG, atau WebP. Foto harus lolos validasi dan kompresi sebelum disimpan.";
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(photo.type)) {
      showToast("Pilih file gambar JPG, PNG, atau WebP", "error");
      arrivalPhotoInput.value = "";
      preview.classList.add("hidden");
      if (validation)
        validation.textContent =
          "Format tidak didukung. Gunakan foto JPG, PNG, atau WebP.";
      return;
    }
    if (photo.size > 20 * 1024 * 1024) {
      showToast("Ukuran foto asli maksimal 20 MB", "error");
      arrivalPhotoInput.value = "";
      preview.classList.add("hidden");
      if (validation)
        validation.textContent = "Foto terlalu besar. Maksimal 20 MB.";
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(photo);
    arrivalPhotoInput.files = transfer.files;
    adminArrivalPhotoPreviewUrl = URL.createObjectURL(photo);
    preview.src = adminArrivalPhotoPreviewUrl;
    preview.classList.remove("hidden");
    if (photoName) photoName.textContent = photo.name;
    if (validation)
      validation.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Memvalidasi dan mengompres foto...';
    compressArrivalPhoto(photo)
      .then((compressed) => {
        if (requestId !== arrivalPhotoValidationRequest) return;
        if (validation)
          validation.innerHTML = `<i class="fa-solid fa-circle-check mr-1 text-emerald-600"></i>Foto valid Â· Asli ${formatFileSize(photo.size)} Â· Setelah kompresi ${formatFileSize(compressed.sizeBytes)} Â· ${compressed.width}Ã—${compressed.height}px`;
        if (arrivalSubmitButton) arrivalSubmitButton.disabled = false;
      })
      .catch((error) => {
        if (requestId !== arrivalPhotoValidationRequest) return;
        if (validation)
          validation.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-1 text-rose-600"></i>${escapeHtml(error.message || "Foto gagal divalidasi")}`;
        if (arrivalSubmitButton) arrivalSubmitButton.disabled = true;
      });
  };
  arrivalPhotoInput?.addEventListener("change", () => {
    applyArrivalPhoto(arrivalPhotoInput.files?.[0]);
  });
  ["dragenter", "dragover"].forEach((eventName) =>
    dropZone?.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("border-sky-500", "bg-sky-50");
    }),
  );
  ["dragleave", "drop"].forEach((eventName) =>
    dropZone?.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("border-sky-500", "bg-sky-50");
    }),
  );
  dropZone?.addEventListener("drop", (event) => {
    const photo = [...(event.dataTransfer?.files || [])].find((file) =>
      file.type.startsWith("image/"),
    );
    if (!photo) {
      showToast("Seret file gambar ke area foto", "error");
      return;
    }
    applyArrivalPhoto(photo);
  });
  arrivalPhotoInput?.closest("form")?.addEventListener("reset", () => {
    arrivalPhotoValidationRequest++;
    if (arrivalSubmitButton) arrivalSubmitButton.disabled = false;
    document
      .getElementById("adminArrivalPhotoValidation")
      ?.classList.remove("text-rose-600", "text-emerald-700");
  });

  setupInstallPrompt();
  renderFirebaseInfo();
  renderDriveQuota();
  window.showAdminPwaTab?.("dashboard");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .catch(() => {});
  }
});
