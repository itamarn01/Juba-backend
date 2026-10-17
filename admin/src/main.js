import { createClient } from "@supabase/supabase-js";
import "./style.css";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const PAGE_SIZE = 50;
const ONLINE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const state = { page: 0, search: "", filter: "all", hasNext: false };

// --- Helpers ---------------------------------------------------------------

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const timeAgo = (iso) => {
  if (!iso) return "-";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק'`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `לפני ${hours} שע'`;
  const days = Math.round(hours / 24);
  return `לפני ${days} ימים`;
};

const formatDate = (iso) =>
  iso
    ? new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })
    : "-";

let toastTimer = null;
const showToast = (message, isError = false) => {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("error-toast", isError);
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2500);
};

// --- Auth ------------------------------------------------------------------

const showLogin = (message = "") => {
  $("app").classList.add("hidden");
  $("login").classList.remove("hidden");
  $("login-error").textContent = message;
};

const showApp = async () => {
  const { data, error } = await supabase.from("admins").select("user_id").maybeSingle();
  if (error || !data) {
    await supabase.auth.signOut();
    showLogin("המשתמש הזה אינו מנהל. הוסף אותו לטבלת admins.");
    return;
  }
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  refresh();
};

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login-error").textContent = "";
  const { error } = await supabase.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  if (error) {
    $("login-error").textContent = error.message;
    return;
  }
  showApp();
});

$("logout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  showLogin();
});

// --- Stats -----------------------------------------------------------------

const loadStats = async () => {
  const { data, error } = await supabase.rpc("admin_stats");
  if (error) {
    showToast(error.message, true);
    return;
  }
  const tipTotals = data.tip_totals.length
    ? data.tip_totals.map((t) => `${Number(t.total).toFixed(2)} ${t.currency}`).join(" · ")
    : "0";
  const cards = [
    ["מחוברים עכשיו", data.online, "online"],
    ["פעילים היום", data.active_today],
    ["פעילים השבוע", data.active_week],
    ["חדשים השבוע", data.new_week],
    ["סה\"כ מכשירים", data.devices],
    ["בלי פרסומות", data.ads_disabled],
    ["טיפים", data.tips],
    ["סה\"כ טיפים", tipTotals],
  ];
  $("stats").innerHTML = cards
    .map(
      ([label, value, kind]) => `
        <div class="stat ${kind ?? ""}">
          <span class="stat-value">${escapeHtml(value)}</span>
          <span class="stat-label">${escapeHtml(label)}</span>
        </div>`
    )
    .join("");
};

// --- Devices ---------------------------------------------------------------

const loadDevices = async () => {
  let query = supabase
    .from("device_overview")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .range(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE);

  if (state.search) query = query.ilike("id_text", `%${state.search}%`);
  if (state.filter === "online") {
    query = query.gt("last_seen_at", new Date(Date.now() - ONLINE_MS).toISOString());
  } else if (state.filter === "today") {
    query = query.gt("last_seen_at", new Date(Date.now() - DAY_MS).toISOString());
  } else if (state.filter === "tippers") {
    query = query.gt("tips_count", 0);
  } else if (state.filter === "adfree") {
    query = query.eq("ads_disabled", true);
  }

  const { data, error } = await query;
  if (error) {
    showToast(error.message, true);
    return;
  }
  // One extra row was requested to know whether a next page exists.
  state.hasNext = data.length > PAGE_SIZE;
  const rows = data.slice(0, PAGE_SIZE);

  $("devices-body").innerHTML = rows.length
    ? rows
        .map((device) => {
          const online = Date.now() - new Date(device.last_seen_at).getTime() < ONLINE_MS;
          return `
            <tr>
              <td class="mono">
                <span class="dot ${online ? "dot-online" : ""}" title="${online ? "מחובר" : ""}"></span>
                <button class="link copy" data-copy="${device.id}" title="${device.id}">${device.id.slice(0, 8)}</button>
              </td>
              <td title="${escapeHtml(formatDate(device.last_seen_at))}">${timeAgo(device.last_seen_at)}</td>
              <td>${formatDate(device.created_at)}</td>
              <td>${device.launches}</td>
              <td>${escapeHtml(device.app_version ?? "-")}</td>
              <td>${escapeHtml([device.language, device.region].filter(Boolean).join("-") || "-")}</td>
              <td>${device.tips_count ? `☕ ${device.tips_count}` : "-"}</td>
              <td>
                <label class="switch" title="${device.ads_disabled ? "פרסומות כבויות" : "פרסומות פעילות"}">
                  <input type="checkbox" data-ads="${device.id}" ${device.ads_disabled ? "" : "checked"} />
                  <span class="slider"></span>
                </label>
              </td>
              <td>
                <input class="note" data-note="${device.id}" value="${escapeHtml(device.note ?? "")}" placeholder="..." />
              </td>
            </tr>`;
        })
        .join("")
    : `<tr><td colspan="9" class="empty">אין מכשירים</td></tr>`;

  $("page-label").textContent = `עמוד ${state.page + 1}`;
  $("prev").disabled = state.page === 0;
  $("next").disabled = !state.hasNext;
};

const updateDevice = async (id, values, successMessage) => {
  const { error } = await supabase.from("devices").update(values).eq("id", id);
  if (error) {
    showToast(error.message, true);
    return false;
  }
  showToast(successMessage);
  return true;
};

$("devices-body").addEventListener("change", async (event) => {
  const target = event.target;
  if (target.dataset.ads) {
    const adsDisabled = !target.checked;
    const saved = await updateDevice(
      target.dataset.ads,
      { ads_disabled: adsDisabled },
      adsDisabled ? "הפרסומות כובו למכשיר הזה" : "הפרסומות הופעלו למכשיר הזה"
    );
    if (saved) loadStats();
    else target.checked = !target.checked;
  } else if (target.dataset.note) {
    updateDevice(target.dataset.note, { note: target.value.trim() || null }, "ההערה נשמרה");
  }
});

$("devices-body").addEventListener("click", async (event) => {
  const id = event.target.dataset.copy;
  if (!id) return;
  await navigator.clipboard.writeText(id);
  showToast("המזהה הועתק");
});

let searchTimer = null;
$("search").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = event.target.value.trim().toLowerCase();
    state.page = 0;
    loadDevices();
  }, 300);
});

$("filter").addEventListener("change", (event) => {
  state.filter = event.target.value;
  state.page = 0;
  loadDevices();
});

$("prev").addEventListener("click", () => {
  state.page = Math.max(0, state.page - 1);
  loadDevices();
});

$("next").addEventListener("click", () => {
  state.page += 1;
  loadDevices();
});

// --- Tips ------------------------------------------------------------------

const loadTips = async () => {
  const { data, error } = await supabase
    .from("tips")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    showToast(error.message, true);
    return;
  }
  $("tips-body").innerHTML = data.length
    ? data
        .map(
          (tip) => `
            <tr>
              <td>${formatDate(tip.created_at)}</td>
              <td>${escapeHtml(tip.product_id)}</td>
              <td>${escapeHtml(tip.display_price ?? [tip.price, tip.currency].filter(Boolean).join(" "))}</td>
              <td class="mono">${
                tip.device_id
                  ? `<button class="link copy" data-copy="${tip.device_id}">${tip.device_id.slice(0, 8)}</button>`
                  : "-"
              }</td>
              <td class="mono small">${escapeHtml(tip.order_id ?? "-")}</td>
            </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="empty">עדיין אין טיפים</td></tr>`;
};

$("tips-body").addEventListener("click", async (event) => {
  const id = event.target.dataset.copy;
  if (!id) return;
  await navigator.clipboard.writeText(id);
  showToast("המזהה הועתק");
});

// --- Tabs & refresh --------------------------------------------------------

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    const tab = button.dataset.tab;
    $("devices-tab").classList.toggle("hidden", tab !== "devices");
    $("tips-tab").classList.toggle("hidden", tab !== "tips");
  });
});

const refresh = () => {
  loadStats();
  loadDevices();
  loadTips();
};

$("refresh").addEventListener("click", refresh);

// Keep "online now" fresh while the panel is open, but not while a note is
// being typed (the refresh would redraw the table under the cursor).
setInterval(() => {
  const editing = document.activeElement?.classList.contains("note");
  if (!document.hidden && !editing && !$("app").classList.contains("hidden")) refresh();
}, 60000);

// --- Start -----------------------------------------------------------------

const { data: sessionData } = await supabase.auth.getSession();
if (sessionData.session) showApp();
else showLogin();
