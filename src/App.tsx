import { Component, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ChangeEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity, ArrowDownToLine, ArrowUpFromLine, Bell, BookMarked, BookOpen,
  CalendarDays, Camera, ChartNoAxesCombined, Check, ChevronDown, CircleDollarSign,
  Clock3, Download, FileAudio, FileText, GraduationCap, Languages, Moon,
  KeyRound, LayoutDashboard, LibraryBig, LogOut, Menu, MoreHorizontal, Package, Plus, Search,
  RotateCcw, Settings, ShieldCheck, SlidersHorizontal, Sun, Trash2, Users, X,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from "recharts";
import { api, download, request, type ApiRecord } from "./api";
import i18n from "./i18n";
import { useSettings, type LibrarySettings } from "./SettingsContext";
import { CameraScanner } from "./CameraScanner";

type Page = "dashboard" | "books" | "students" | "staff" | "circulation" | "returns" | "reservations" | "inventory" | "media" | "reports" | "settings";
type CrudPage = Exclude<Page, "dashboard" | "circulation" | "returns" | "reservations" | "reports" | "settings">;
type Row = ApiRecord & { [key: string]: unknown };
type Stats = {
  totalBooks: number; borrowedBooks: number; activeStudents: number; overdueBooks: number;
  borrowersThisMonth: number; finesCollected: number;
  borrowingTrends: { month: string; borrowed: number; returned: number }[];
  categories: { name: string; value: number }[];
  recentLoans: Row[];
};
type FormField = { id?: string; key: string; label: string; labelAm?: string | null; type: string; required?: boolean; entity?: string; placeholder?: string };
type Account = { id: string; name: string; email: string; role: string; patronId?: string; patronType?: "STUDENT" | "TEACHER"; memberCode?: string };
type PortalReservation = Row & { status: "REQUESTED" | "RESERVED" | "FULFILLED" | "CANCELLED"; book: Row };
type StaffReservation = PortalReservation & { patron: Row };

function savedAccount(): Account | null {
  try {
    const value = localStorage.getItem("library-user");
    return value ? JSON.parse(value) as Account : null;
  } catch {
    localStorage.removeItem("library-user");
    return null;
  }

}

const navItems: { page: Page; icon: typeof LayoutDashboard; label: string; section: "main" | "manage" }[] = [
  { page: "dashboard", icon: LayoutDashboard, label: "dashboard", section: "main" },
  { page: "books", icon: BookOpen, label: "books", section: "manage" },
  { page: "students", icon: GraduationCap, label: "students", section: "manage" },
  { page: "staff", icon: Users, label: "staff", section: "manage" },
  { page: "circulation", icon: ArrowUpFromLine, label: "borrowBooks", section: "manage" },
  { page: "returns", icon: RotateCcw, label: "returnBooks", section: "manage" },
  { page: "reservations", icon: BookMarked, label: "reservationQueue", section: "manage" },
  { page: "inventory", icon: Package, label: "inventory", section: "manage" },
  { page: "media", icon: FileAudio, label: "media", section: "manage" },
  { page: "reports", icon: ChartNoAxesCombined, label: "reports", section: "main" },
  { page: "settings", icon: Settings, label: "settings", section: "main" },
];

const mediaCategories = ["Textbooks", "Reference", "Fiction", "Research Papers", "Course Material", "Other"];

const pageConfig: Record<CrudPage, {
  endpoint: string; title: string; description: string; icon: typeof BookOpen; fields: FormField[];
}> = {
  books: {
    endpoint: "/books", title: "booksManagement", description: "searchAndManage", icon: BookMarked,
    fields: [
      { key: "title", label: "title", type: "text", required: true },
      { key: "author", label: "author", type: "text", required: true },
      { key: "isbn", label: "isbn", type: "text" },
      { key: "category", label: "category", type: "text" },
      { key: "copies", label: "quantity", type: "number", required: true },
      { key: "shelfLocation", label: "location", type: "text" },
      { key: "description", label: "description", type: "text" },
      { key: "publisher", label: "publisher", type: "text" },
      { key: "publishedYear", label: "publishedYear", type: "number" },
    ],
  },
  students: {
    endpoint: "/patrons?type=STUDENT", title: "students", description: "searchAndManagePeople", icon: GraduationCap,
    fields: [
      { key: "name", label: "name", type: "text", required: true },
      { key: "email", label: "email", type: "email", required: true },
      { key: "phone", label: "phone", type: "tel" },
      { key: "grade", label: "grade", type: "text" },
      { key: "memberCode", label: "memberCode", type: "text", placeholder: "memberCodePlaceholder" },
    ],
  },
  staff: {
    endpoint: "/patrons?type=TEACHER", title: "staff", description: "searchAndManagePeople", icon: Users,
    fields: [
      { key: "name", label: "name", type: "text", required: true },
      { key: "email", label: "email", type: "email", required: true },
      { key: "phone", label: "phone", type: "tel" },
      { key: "department", label: "department", type: "text" },
      { key: "memberCode", label: "memberCode", type: "text", placeholder: "memberCodePlaceholder" },
    ],
  },
  inventory: {
    endpoint: "/inventory", title: "inventoryManagement", description: "browseInventory", icon: Package,
    fields: [
      { key: "name", label: "asset", type: "text", required: true },
      { key: "category", label: "category", type: "text", required: true },
      { key: "quantity", label: "quantity", type: "number", required: true },
      { key: "location", label: "location", type: "text" },
      { key: "condition", label: "condition", type: "select", required: true },
      { key: "value", label: "value", type: "number" },
      { key: "purchaseDate", label: "purchaseDate", type: "date" },
      { key: "notes", label: "notes", type: "text" },
    ],
  },
  media: {
    endpoint: "/media", title: "mediaHub", description: "resourcesDescription", icon: FileAudio,
    fields: [
      { key: "title", label: "title", type: "text", required: true },
      { key: "author", label: "author", type: "text" },
      { key: "mediaType", label: "type", type: "select", required: true },
    ],
  },
};

const colors = ["#518970", "#92b49c", "#d2a66a", "#afc6b6", "#7896a1"];
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"];
const amharicMonths = ["ጃን", "ፌብ", "ማር", "ኤፕ", "ሜይ", "ጁን", "ጁላይ", "ኦገስት", "ሴፕ", "ኦክቶ", "ኖቬ"];
const toText = (value: unknown) => (value == null ? "" : String(value));
const localizeMonths = <T extends { month: string },>(data: T[]) => data.map((item) => {
  const index = monthNames.indexOf(item.month);
  return { ...item, month: i18n.language === "am" && index >= 0 ? amharicMonths[index] : item.month };
});
const dateAfterDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function Brand({ libraryName }: { libraryName: string }) {
  const { t } = useTranslation();
  return <div className="brand">
    <div className="brand-mark"><LibraryBig size={20} strokeWidth={1.8} /></div>
    <div><div className="brand-name">{libraryName}</div><div className="brand-caption">{t("tagline")}</div></div>
  </div>;
}

function ThemeButton({ darkMode, onToggle }: { darkMode: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return <button className="lang-button theme-button" aria-label={t(darkMode ? "lightMode" : "darkMode")} title={t(darkMode ? "lightMode" : "darkMode")} onClick={onToggle}>
    {darkMode ? <Sun size={14} /> : <Moon size={14} />}<span>{t(darkMode ? "lightMode" : "darkMode")}</span>
  </button>;
}

function Login({ onLogin, libraryName, darkMode, onToggleTheme }: {
  onLogin: (token: string, user: Account) => void; libraryName: string; darkMode: boolean; onToggleTheme: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"staff" | "member">("staff");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.post<{ token: string; user: Account }>("/auth/login", { identifier, password, mode });
      localStorage.setItem("library-token", result.token);
      localStorage.setItem("library-user", JSON.stringify(result.user));
      onLogin(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="login-wrap">
    <form className="login-card" onSubmit={submit}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><Brand libraryName={libraryName} /><div className="toolbar-group"><ThemeButton darkMode={darkMode} onToggle={onToggleTheme} /><button type="button" className="lang-button" onClick={() => { void i18n.changeLanguage(i18n.language === "en" ? "am" : "en"); }}><Languages size={13} />{i18n.language === "en" ? t("amharic") : t("english")}</button></div></div>
      <h1 className="page-title">{t("signIn")}</h1>
      <p className="page-description">{t(mode === "member" ? "memberSignInHelp" : "signInHelp")}</p>
      <div className="login-modes" role="tablist" aria-label={t("signInAs")}>
        <button type="button" role="tab" aria-selected={mode === "staff"} className={`login-mode ${mode === "staff" ? "active" : ""}`} onClick={() => { setMode("staff"); setIdentifier(""); setError(""); }}>{t("staffLogin")}</button>
        <button type="button" role="tab" aria-selected={mode === "member"} className={`login-mode ${mode === "member" ? "active" : ""}`} onClick={() => { setMode("member"); setIdentifier(""); setError(""); }}>{t("memberLogin")}</button>
      </div>
      <div className="field" style={{ marginBottom: 13 }}><label htmlFor="login-identifier">{t(mode === "member" ? "memberCodeOrEmail" : "emailAddress")}</label><input id="login-identifier" type={mode === "staff" ? "email" : "text"} autoComplete="username" placeholder={t(mode === "member" ? "memberCodeOrEmailPlaceholder" : "emailPlaceholder")} required value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></div>
      <div className="field"><label htmlFor="login-password">{t("password")}</label><input id="login-password" type="password" autoComplete="current-password" placeholder={t("passwordPlaceholder")} required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
      {error && <div className="login-error" role="alert">{error}</div>}
      <button className="button button-primary" disabled={busy}>{busy ? t("loading") : t("signIn")}</button>
    </form>
  </div>;
}

function App() {
  const { t } = useTranslation();
  const { settings: librarySettings, setSettings: setLibrarySettings, language, setLanguage, saveSettings, changeAdminPassword } = useSettings();
  const [token, setToken] = useState(() => localStorage.getItem("library-token"));
  const [currentUser, setCurrentUser] = useState<Account | null>(savedAccount);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("library-theme") === "dark");
  const [sessionLoading, setSessionLoading] = useState(Boolean(localStorage.getItem("library-token")) && !savedAccount());
  const [page, setPage] = useState<Page>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [records, setRecords] = useState<Row[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mediaPreview, setMediaPreview] = useState<{ title: string; type: string; url: string } | null>(null);
  const [borrowers, setBorrowers] = useState<Row[]>([]);
  const [availableBooks, setAvailableBooks] = useState<Row[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [customFields, setCustomFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [mediaCategoryFilter, setMediaCategoryFilter] = useState("ALL");
  const [modal, setModal] = useState<"record" | "borrow" | "field" | "fine" | "account" | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [accountPatron, setAccountPatron] = useState<Row | null>(null);
  const [editingField, setEditingField] = useState<FormField | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const [scannerMode, setScannerMode] = useState<"issue" | "return" | null>(null);
  const loadSequence = useRef(0);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("library-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    const unauthenticated = () => {
      localStorage.removeItem("library-user");
      setCurrentUser(null);
      setToken(null);
    };
    window.addEventListener("library:unauthorized", unauthenticated);
    return () => window.removeEventListener("library:unauthorized", unauthenticated);
  }, []);

  useEffect(() => {
    if (!token || currentUser) return;
    let cancelled = false;
    void api.get<Account>("/auth/me").then((account) => {
      if (cancelled) return;
      localStorage.setItem("library-user", JSON.stringify(account));
      setCurrentUser(account);
    }).catch(() => {
      if (cancelled) return;
      localStorage.removeItem("library-token");
      localStorage.removeItem("library-user");
      setToken(null);
    }).finally(() => {
      if (!cancelled) setSessionLoading(false);
    });
    return () => { cancelled = true; };
  }, [token, currentUser]);

  const loanStatusFilter = page === "circulation" ? statusFilter : "ALL";
  const load = useCallback(async () => {
    if (!token || !currentUser || currentUser.role === "MEMBER") return;
    const sequence = ++loadSequence.current;
    const isCurrentLoad = () => sequence === loadSequence.current;
    setLoading(true);
    setError("");
    try {
      if (page === "dashboard" || page === "reports") {
        const dashboard = await api.get<Stats>("/dashboard");
        if (isCurrentLoad()) setStats(dashboard);
      } else if (page === "settings") {
        const [fields, settings] = await Promise.all([
          api.get<FormField[]>("/custom-fields"),
          api.get<LibrarySettings>("/admin/settings"),
        ]);
        if (isCurrentLoad()) {
          setCustomFields(fields);
          setLibrarySettings(settings);
        }
      } else if (page === "circulation") {
        const loans = await api.get<Row[]>(`/loans?status=${encodeURIComponent(loanStatusFilter)}`);
        if (isCurrentLoad()) setRecords(loans);
      } else if (page === "returns") {
        const loans = await api.get<Row[]>("/loans?status=ACTIVE");
        if (isCurrentLoad()) setRecords(loans);
      } else if (page === "reservations") {
        const reservations = await api.get<Row[]>("/reservations");
        if (isCurrentLoad()) setRecords(reservations);
      } else {
        const config = pageConfig[page];
        const params = new URLSearchParams();
        if (query.trim()) params.set("search", query.trim());
        const url = `${config.endpoint}${config.endpoint.includes("?") ? "&" : "?"}${params.toString()}`;
        const nextRecords = await api.get<Row[]>(url);
        if (isCurrentLoad()) setRecords(nextRecords);
        if (page === "books" || page === "students" || page === "staff" || page === "inventory") {
          const fields = await api.get<FormField[]>(`/custom-fields?entity=${page === "books" ? "BOOK" : page === "inventory" ? "INVENTORY" : "PATRON"}`);
          if (isCurrentLoad()) setCustomFields(fields);
        }
      }
    } catch (err) {
      if (isCurrentLoad()) setError(err instanceof Error ? err.message : t("apiOffline"));
    } finally {
      if (isCurrentLoad()) setLoading(false);
    }
  }, [token, currentUser, page, query, loanStatusFilter, t]);

  useEffect(() => {
    const debounce = ["books", "students", "staff", "inventory", "media"].includes(page) ? 250 : 0;
    const timer = window.setTimeout(() => { void load(); }, debounce);
    return () => window.clearTimeout(timer);
  }, [page, load]);

  useEffect(() => {
    if (page !== "dashboard") return;
    const interval = window.setInterval(() => { void load(); }, 60_000);
    return () => window.clearInterval(interval);
  }, [page, load]);

  useEffect(() => {
    if (page !== "reservations") return;
    const interval = window.setInterval(() => { void load(); }, 15_000);
    return () => window.clearInterval(interval);
  }, [page, load]);

  const isDataPage = page !== "dashboard" && page !== "reports" && page !== "settings" && page !== "reservations";
  const visibleRecords = useMemo(() => {
    if (page === "returns") {
      const active = records.filter((record) => toText(record.status) !== "RETURNED");
      const filtered = statusFilter === "ALL" ? active : active.filter((record) => toText(record.status) === statusFilter);
      if (!query.trim()) return filtered;
      const search = query.trim().toLowerCase();
      return filtered.filter((record) => ["title", "author", "borrowerName", "memberCode"].some((key) => toText(record[key]).toLowerCase().includes(search)));
    }
    if (page === "media") {
      return records.filter((record) =>
        (statusFilter === "ALL" || toText(record.mediaType) === statusFilter) &&
        (mediaCategoryFilter === "ALL" || toText(record.category) === mediaCategoryFilter),
      );
    }
    if (!isDataPage || page !== "books") return records;
    if (statusFilter === "AVAILABLE") return records.filter((record) => Number(record.availableCopies ?? record.copies) > 0);
    if (statusFilter === "BORROWED") return records.filter((record) => Number(record.availableCopies ?? 0) < Number(record.copies ?? 0));
    return records;
  }, [records, page, isDataPage, statusFilter, mediaCategoryFilter, query]);

  if (!token) return <Login libraryName={librarySettings.libraryName} darkMode={darkMode} onToggleTheme={() => setDarkMode((enabled) => !enabled)} onLogin={(value, account) => { setToken(value); setCurrentUser(account); }} />;
  if (sessionLoading || !currentUser) return <div className="loading-state">{t("loading")}</div>;

  const signOut = () => {
    localStorage.removeItem("library-token");
    localStorage.removeItem("library-user");
    setCurrentUser(null);
    setToken(null);
  };

  if (currentUser.role === "MEMBER") return <SelfServicePortal user={currentUser} libraryName={librarySettings.libraryName} darkMode={darkMode} onToggleTheme={() => setDarkMode((enabled) => !enabled)} onSignOut={signOut} />;

  const changeLanguage = () => { void setLanguage(language === "en" ? "am" : "en"); };
  const selectedItem = navItems.find((item) => item.page === page);

  function startCreate() {
    setEditing(null);
    setForm({});
    setModal("record");
  }

  function startEdit(record: Row) {
    setEditing(record);
    const values: Record<string, string> = {};
    Object.entries(record).forEach(([key, value]) => {
      if (typeof value === "string" || typeof value === "number") values[key] = String(value);
    });
    if (record.customFields) {
      const customValues = typeof record.customFields === "string"
        ? JSON.parse(record.customFields) as Record<string, unknown>
        : record.customFields as Record<string, unknown>;
      Object.entries(customValues).forEach(([key, value]) => { values[key] = toText(value); });
    }
    setForm(values);
    setModal("record");
  }

  async function saveRecord(event: FormEvent) {
    event.preventDefault();
    if (page === "dashboard" || page === "reports" || page === "settings" || page === "circulation" || page === "returns" || page === "reservations") return;
    const config = pageConfig[page];
    setBusy(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {};
      for (const field of config.fields) {
        const value = form[field.key];
        if (value !== undefined && value !== "") payload[field.key] = field.type === "number" ? Number(value) : value;
      }
      const customValues = Object.fromEntries(customFields
        .filter((field) => form[field.key] !== undefined && form[field.key] !== "")
        .map((field) => [field.key, form[field.key]]));
      if (Object.keys(customValues).length) payload.customFields = customValues;
      if (page === "students" || page === "staff") {
        payload.type = page === "students" ? "STUDENT" : "TEACHER";
        if (form.password) payload.password = form.password;
      }
      if (page === "books" && !payload.copies) payload.copies = 1;
      if (editing) await api.put(`${config.endpoint.split("?")[0]}/${editing.id}`, payload);
      else await api.post(config.endpoint.split("?")[0], payload);
      setModal(null);
      setSuccess(t("recordSaved"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save record.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRecord(record: Row) {
    if (page === "dashboard" || page === "reports" || page === "settings" || page === "circulation" || page === "returns" || page === "reservations") return;
    if (page === "media") {
      if (!window.confirm("Are you sure you want to delete this media file?")) return;
    } else if (!window.confirm(`Delete "${toText(record.title || record.name)}"?`)) return;
    try {
      await api.delete(`${pageConfig[page].endpoint.split("?")[0]}/${record.id}`);
      if (page === "media") setRecords((current) => current.filter((item) => item.id !== record.id));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete record.");
    }
  }

  async function returnLoan(loan: Row) {
    try {
      await api.post(`/loans/items/${loan.loanItemId || loan.id}/return`, {});
      setSuccess(t("returnSuccess"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to return this book.");
    }
  }

  async function returnSelectedLoans() {
    if (!selectedIds.length) return;
    setBusy(true);
    setError("");
    try {
      const returned = await api.post<{ fine: number }[]>("/loans/return", { itemIds: selectedIds });
      const totalFine = returned.reduce((total, item) => total + Number(item.fine), 0);
      setSelectedIds([]);
      setSuccess(`${t("returnBatchSuccess")} ${t("fine")}: ${totalFine.toFixed(2)} ${t("ethiopianBirr")}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to return selected books.");
    } finally {
      setBusy(false);
    }
  }

  async function clearBorrowingHistory() {
    if (!window.confirm(t("confirmClearHistory"))) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.delete<{ deletedCount: number }>("/borrowings/clear");
      setSuccess(`${result.deletedCount} ${t("historyRecordsCleared")}`);
      setSelectedIds([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("unableToClearHistory"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteBorrowing(record: Row) {
    if (!window.confirm("Are you sure you want to delete this record?")) return;
    setBusy(true);
    setError("");
    try {
      await api.delete(`/borrowings/${record.loanItemId || record.id}`);
      setSuccess(t("recordDeleted"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("unableToDeleteRecord"));
    } finally {
      setBusy(false);
    }
  }

  async function updateReservation(reservation: Row, status: "RESERVED" | "FULFILLED" | "CANCELLED") {
    setBusy(true);
    setError("");
    try {
      await api.put(`/reservations/${reservation.id}`, {
        status,
        ...(status === "FULFILLED" ? { dueDate: dateAfterDays(14) } : {}),
      });
      setSuccess(t(status === "RESERVED" ? "reservationApprovedNotice" : status === "FULFILLED" ? "reservationIssuedNotice" : "reservationCancelledNotice"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("reservationFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteReservation(reservation: Row) {
    if (!window.confirm("Are you sure you want to delete this reservation?")) return;
    setBusy(true);
    setError("");
    try {
      await api.delete(`/reservations/${reservation.id}`);
      setRecords((current) => current.filter((record) => record.id !== reservation.id));
      setSuccess(t("reservationDeleted"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("reservationFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function clearReservationHistory() {
    if (!window.confirm("Are you sure you want to clear reservation history?")) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.delete<{ deletedCount: number }>("/reservations/clear");
      setRecords((current) => current.filter((record) => record.status === "REQUESTED" || record.status === "RESERVED"));
      setSuccess(`${result.deletedCount} ${t("reservationHistoryCleared")}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("reservationFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function saveLibrarySettings(next: LibrarySettings) {
    setBusy(true);
    setError("");
    try {
      await saveSettings(next);
      setSuccess(t("settingsSaved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save library settings.");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await changeAdminPassword(currentPassword, newPassword);
      setSuccess(t("passwordChanged"));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("passwordChangeFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function collectFine(loan: Row) {
    setForm({ loanItemId: loan.id, amount: toText(loan.fineRemaining) });
    setModal("fine");
  }

  async function payFine(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post(`/loans/items/${form.loanItemId}/fines/pay`, { amount: Number(form.amount) });
      setModal(null);
      setSuccess(t("finePaymentSaved"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record fine payment.");
    } finally {
      setBusy(false);
    }
  }

  async function openBorrowModal() {
    setError("");
    setForm({ dueDate: dateAfterDays(14), bookIds: "" });
    setModal("borrow");
    try {
      const [people, books] = await Promise.all([api.get<Row[]>("/patrons"), api.get<Row[]>("/books")]);
      setBorrowers(people.filter((person) => person.active !== false));
      setAvailableBooks(books.filter((book) => Number(book.availableCopies) > 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load borrowers and books.");
    }
  }

  function openPortalAccount(record: Row) {
    setAccountPatron(record);
    setForm({ password: "" });
    setModal("account");
  }

  async function savePortalAccount(event: FormEvent) {
    event.preventDefault();
    if (!accountPatron) return;
    setBusy(true);
    try {
      await api.post(`/patrons/${accountPatron.id}/account`, { password: form.password });
      setModal(null);
      setSuccess(t("accountCreated"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the patron portal account.");
    } finally {
      setBusy(false);
    }
  }

  function startScanning(mode: "issue" | "return") {
    setError("");
    setScannerMode(mode);
  }

  async function handleScannedCode(code: string) {
    const mode = scannerMode;
    setScannerMode(null);
    if (mode === "issue") {
      const book = availableBooks.find((candidate) => candidate.id === code || candidate.isbn === code);
      if (!book) { setError(t("barcodeNotFound")); return; }
      const selected = (form.bookIds || "").split(",").filter(Boolean);
      if (!selected.includes(book.id)) setForm({ ...form, bookIds: [...selected, book.id].join(",") });
      setSuccess(t("scanSuccess"));
      return;
    }
    if (mode === "return") {
      try {
        const result = await api.post<{ title: string; borrowerName: string }>("/loans/scan/return", { code });
        setSuccess(`${t("scanReturned")} ${result.title} · ${result.borrowerName}`);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("barcodeNotFound"));
      }
    }
  }

  async function previewMedia(record: Row) {
    setError("");
    try {
      const blob = await download(`/media/${record.id}/file`);
      const url = URL.createObjectURL(blob);
      setMediaPreview({ title: toText(record.title), type: toText(record.mediaType), url });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open media.");
    }
  }

  function closeMediaPreview() {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview.url);
    setMediaPreview(null);
  }

  async function deleteSelected() {
    if (page === "dashboard" || page === "reports" || page === "settings" || page === "circulation" || page === "returns" || page === "reservations" || !selectedIds.length || !window.confirm(`Delete ${selectedIds.length} selected records?`)) return;
    setBusy(true);
    try {
      for (const id of selectedIds) await api.delete(`${pageConfig[page].endpoint.split("?")[0]}/${id}`);
      setSelectedIds([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete selected records.");
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((selected) => selected.includes(id) ? selected.filter((current) => current !== id) : [...selected, id]);
  }

  async function exportFile(format: "xlsx" | "docx") {
    const XLSX = await import("xlsx");
    const rows = visibleRecords.map((record) => {
      const values = Object.fromEntries(Object.entries(record).filter(([key]) => !["id", "createdAt", "updatedAt"].includes(key)));
      return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : value]));
    });
    if (format === "xlsx") {
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, page);
      XLSX.writeFile(workbook, `library-${page}.xlsx`);
    } else {
      const { Document, Packer, Paragraph, Table, TableCell, TableRow, WidthType } = await import("docx");
      const keys = rows.length ? Object.keys(rows[0]) : ["No records"];
      const tableRows = [keys, ...rows.map((row) => keys.map((key) => toText(row[key])))].map((cells) =>
        new TableRow({ children: cells.map((cell) => new TableCell({ children: [new Paragraph(cell)] })) }),
      );
      const doc = new Document({ sections: [{ children: [
        new Paragraph({ text: `Library ${page}`, heading: "Heading1" }),
        new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
      ] }] });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `library-${page}.docx`;
      link.click();
      URL.revokeObjectURL(url);
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || page === "dashboard" || page === "reports" || page === "settings" || page === "circulation" || page === "returns" || page === "reservations") return;
    if (file.size > 5 * 1024 * 1024) {
      setError(t("importFileLimit"));
      return;
    }
    setBusy(true);
    try {
      let rows: Record<string, unknown>[];
      if (file.name.toLowerCase().endsWith(".docx")) {
        const mammoth = await import("mammoth/mammoth.browser");
        const converted = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
        const html = new DOMParser().parseFromString(converted.value, "text/html");
        const tableRows = Array.from(html.querySelector("table")?.rows || []);
        if (tableRows.length < 2) throw new Error("The Word document must contain a table with a header row and at least one record.");
        const headings = Array.from(tableRows[0].cells, (cell) => cell.textContent?.trim() || "");
        rows = tableRows.slice(1).map((row) => Object.fromEntries(
          headings.map((heading, index) => [heading, row.cells[index]?.textContent?.trim() || ""]),
        ));
      } else {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", sheetRows: 5001 });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!worksheet) throw new Error("The spreadsheet does not contain a worksheet.");
        const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
        if (range.e.r > 5000 || range.e.c >= 50) throw new Error("The spreadsheet is limited to 5,000 rows and 50 columns.");
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
      }
      if (rows.length > 5000) throw new Error(t("importRowsLimit"));
      const baseEndpoint = pageConfig[page].endpoint.split("?")[0];
      const coreKeys = new Set([...pageConfig[page].fields.map((field) => field.key), "customFields"]);
      const customKeys = new Set(customFields.map((field) => field.key));
      for (const row of rows) {
        if (page === "students" || page === "staff") row.type = page === "students" ? "STUDENT" : "TEACHER";
        const customValues = typeof row.customFields === "string" ? JSON.parse(row.customFields || "{}") as Record<string, unknown> : {};
        for (const [key, value] of Object.entries(row)) {
          if (coreKeys.has(key) || ["id", "createdAt", "updatedAt", "type", "active", "availableCopies"].includes(key)) continue;
          if (!customKeys.has(key)) throw new Error(`Unknown import column "${key}". Add it as a custom field first.`);
          customValues[key] = value;
        }
        const payload = Object.fromEntries(Object.entries(row).filter(([key]) => coreKeys.has(key)));
        if (Object.keys(customValues).length) payload.customFields = customValues;
        if (page === "students" || page === "staff") payload.type = page === "students" ? "STUDENT" : "TEACHER";
        await api.post(baseEndpoint, payload);
      }
      setSuccess(`${rows.length} ${t("recordsImported")}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to import this file.");
    } finally {
      setBusy(false);
    }
  }

  async function addCustomField(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const entity = form.entity || (page === "books" ? "BOOK" : page === "inventory" ? "INVENTORY" : "PATRON");
      const values = { label: form.label, labelAm: form.labelAm || null, type: form.type || "text", required: form.required === "true" };
      if (editingField?.id) await api.put(`/custom-fields/${editingField.id}`, values);
      else await api.post("/custom-fields", {
        ...values,
        key: form.label?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        entity,
      });
      setModal(null);
      setEditingField(null);
      setForm({});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add custom field.");
    } finally {
      setBusy(false);
    }
  }

  async function removeCustomField(id: string) {
    try {
      await api.delete(`/custom-fields/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove this field.");
    }
  }

  async function issueBooks(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post("/loans", {
        patronId: form.patronId,
        bookIds: form.bookIds?.split(",").map((id) => id.trim()).filter(Boolean),
        dueDate: form.dueDate,
      });
      setModal(null);
      setForm({});
      setSuccess(t("borrowSuccess"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create loan.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadMedia(event: ChangeEvent<HTMLInputElement>, category: string) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const data = new FormData();
    data.append("file", file);
    data.append("title", file.name.replace(/\.[^.]+$/, ""));
    data.append("category", category);
    try {
      await request("/media/upload", { method: "POST", body: data });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to upload media.");
    }
  }

  const pageTitle = selectedItem ? t(selectedItem.label) : t("dashboard");

  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
      <Brand libraryName={librarySettings.libraryName} />
      <div className="nav-caption">{t("overview")}</div>
      <nav className="nav-list">
        {navItems.filter((item) => item.section === "main" && (item.page !== "settings" || currentUser.role === "ADMIN")).map((item) => {
          const Icon = item.icon;
          return <button key={item.page} className={`nav-item ${page === item.page ? "active" : ""}`} onClick={() => { setPage(item.page); setMenuOpen(false); setQuery(""); setSelectedIds([]); setStatusFilter("ALL"); setMediaCategoryFilter("ALL"); }}>
            <Icon size={15} strokeWidth={1.8} />{t(item.label)}
          </button>;
        })}
      </nav>
      <div className="nav-caption" style={{ marginTop: 18 }}>{t("adminSettings")}</div>
      <nav className="nav-list">
        {navItems.filter((item) => item.section === "manage").map((item) => {
          const Icon = item.icon;
          return <button key={item.page} className={`nav-item ${page === item.page ? "active" : ""}`} onClick={() => { setPage(item.page); setMenuOpen(false); setQuery(""); setSelectedIds([]); setStatusFilter("ALL"); setMediaCategoryFilter("ALL"); }}>
            <Icon size={15} strokeWidth={1.8} />{t(item.label)}
            {item.page === "circulation" && stats?.overdueBooks ? <span className="nav-count">{stats.overdueBooks}</span> : null}
          </button>;
        })}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-tip"><div className="sidebar-tip-title">{t("digitalLibrary")}</div><div className="sidebar-tip-text">{t("resourcesDescription")}</div></div>
        <div className="profile">
          <div className="avatar">AD</div><div style={{ minWidth: 0, flex: 1 }}><div className="profile-name">{t("admin")}</div><div className="profile-role">{t("adminSettings")}</div></div>
          <button className="icon-button" aria-label={t("signOut")} title={t("signOut")} onClick={signOut}><LogOut size={15} /></button>
        </div>
        {t("footerNotice") && <footer className="app-footer">{t("footerNotice")}</footer>}
      </div>
    </aside>
    <main className="main-content">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMenuOpen(!menuOpen)}><Menu size={18} /></button>
          <div className="breadcrumb"><span>{t("appName")}</span><span style={{ margin: "0 8px" }}>/</span><strong>{pageTitle}</strong></div>
        </div>
        <div className="topbar-right">
          <label className="search-top"><Search size={14} /><input aria-label={t("search")} placeholder={t("search")} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <button className="icon-button" aria-label={t("notifications")} title={t("notifications")} onClick={() => { setPage("circulation"); setStatusFilter("OVERDUE"); }}><Bell size={15} />{stats?.overdueBooks ? <span className="notify-dot" /> : null}</button>
          <ThemeButton darkMode={darkMode} onToggle={() => setDarkMode((enabled) => !enabled)} />
          <button className="lang-button" onClick={changeLanguage}><Languages size={13} /><span>{i18n.language === "en" ? "EN" : "አማ"}</span><ChevronDown size={12} /></button>
        </div>
      </header>
      <div className="page-content">
        {(error || success) && <div className={`notice ${success && !error ? "notice-success" : ""}`} role={error ? "alert" : "status"}>
          {error || success}<button className="row-action" style={{ float: "right" }} onClick={() => { setError(""); setSuccess(""); }} aria-label="Dismiss"><X size={13} /></button>
        </div>}
        <PageErrorBoundary key={page} t={t}>
        <div className="page-transition">
        {page === "dashboard" && <Dashboard stats={stats} loading={loading} t={t} onNavigate={setPage} />}
        {page === "reports" && <Reports stats={stats} loading={loading} t={t} />}
        {page === "reservations" && <ReservationsPage records={visibleRecords as StaffReservation[]} loading={loading} query={query} setQuery={setQuery} busy={busy} t={t}
          onUpdate={(reservation, status) => void updateReservation(reservation, status)} onDelete={(reservation) => void deleteReservation(reservation)}
          onClearHistory={() => void clearReservationHistory()} />}
        {page === "settings" && <SettingsPage fields={customFields} loading={loading} t={t} settings={librarySettings} busy={busy} onSave={saveLibrarySettings}
          onChangeLanguage={setLanguage} onChangePassword={changePassword}
          onAdd={() => { setEditingField(null); setForm({}); setModal("field"); }}
          onEdit={(field) => { setEditingField(field); setForm({ label: field.label, labelAm: field.labelAm || "", type: field.type, entity: field.entity || "BOOK", required: String(Boolean(field.required)) }); setModal("field"); }}
          onRemove={removeCustomField} />}
        {page !== "dashboard" && page !== "reports" && page !== "settings" && page !== "reservations" && <DataPage
          page={page} records={visibleRecords} loading={loading} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          mediaCategoryFilter={mediaCategoryFilter} setMediaCategoryFilter={setMediaCategoryFilter}
          onCreate={page === "circulation" ? openBorrowModal : startCreate}
          onEdit={startEdit} onDelete={deleteRecord} onReturn={returnLoan} onCollectFine={collectFine} onPortalAccount={openPortalAccount}
          onScanReturn={() => startScanning("return")} onExport={exportFile} onImport={importFile} onUpload={uploadMedia} onPreview={previewMedia}
          selectedIds={selectedIds} onToggleSelected={toggleSelected} onDeleteSelected={deleteSelected} onReturnSelected={returnSelectedLoans}
          onDeleteBorrowing={deleteBorrowing} onClearHistory={clearBorrowingHistory} busy={busy} t={t}
        />}
        </div>
        </PageErrorBoundary>
      </div>
    </main>
    {scannerMode && <CameraScanner onClose={() => setScannerMode(null)} onScan={handleScannedCode} />}
    {mediaPreview && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeMediaPreview(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ width: "min(900px,100%)" }}>
        <div className="modal-head"><div className="modal-title">{mediaPreview.title}</div><button className="row-action" aria-label={t("cancel")} onClick={closeMediaPreview}><X size={17} /></button></div>
        {mediaPreview.type === "PDF" ? <iframe title={mediaPreview.title} src={mediaPreview.url} style={{ width: "100%", height: "70vh", border: "1px solid #edf0f1", borderRadius: 6 }} /> : <audio controls src={mediaPreview.url} style={{ width: "100%", margin: "34px 0" }}>Audio playback is not supported by this browser.</audio>}
      </div>
    </div>}
    {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head"><div className="modal-title">{modal === "borrow" ? t("issueBooks") : modal === "field" ? editingField ? t("editField") : t("addField") : modal === "fine" ? t("collectFine") : modal === "account" ? accountPatron?.hasPortalAccount ? t("resetPortalPassword") : t("setPortalPassword") : editing ? t("save") : isDataPage && page === "books" ? t("addBook") : isDataPage && page === "students" ? t("addStudent") : t("addRecord")}</div>
          <button className="row-action" aria-label={t("cancel")} onClick={() => setModal(null)}><X size={17} /></button></div>
        {modal === "account" ? <form onSubmit={savePortalAccount}>
          <p className="page-description">{t("accountPasswordHelp")}</p>
          <div className="form-grid"><FieldInput label={t("password")} name="portal-password" value={form.password || ""} onChange={(value) => setForm({ ...form, password: value })} type="password" required /></div>
          <div className="modal-actions"><button type="button" className="button" onClick={() => setModal(null)}>{t("cancel")}</button><button className="button button-primary" disabled={busy}>{t("save")}</button></div>
        </form> : modal === "fine" ? <form onSubmit={payFine}>
          <div className="form-grid"><FieldInput label={`${t("fine")} · ${t("ethiopianBirr")}`} name="amount" value={form.amount || ""} onChange={(value) => setForm({ ...form, amount: value })} required type="number" /></div>
          <div className="modal-actions"><button type="button" className="button" onClick={() => setModal(null)}>{t("cancel")}</button><button className="button button-primary" disabled={busy}>{t("collectFine")}</button></div>
        </form> : modal === "borrow" ? <form onSubmit={issueBooks}>
          <div className="form-grid">
            <FieldSelect label={t("selectBorrower")} value={form.patronId || ""} onChange={(value) => setForm({ ...form, patronId: value })} options={[["", t("selectBorrower")], ...borrowers.map((person) => [person.id, `${toText(person.name)} · ${toText(person.memberCode)}`] as [string, string])]} />
            <div className="book-picker-wrap">
              <SearchableBookSelect books={availableBooks} selected={(form.bookIds || "").split(",").filter(Boolean)} onChange={(ids) => setForm({ ...form, bookIds: ids.join(",") })} t={t} />
              <button type="button" className="button" onClick={() => startScanning("issue")}><Camera size={13} />{t("scanToIssue")}</button>
            </div>
            <FieldInput label={t("dueDate")} name="dueDate" value={form.dueDate || ""} onChange={(value) => setForm({ ...form, dueDate: value })} required type="date" />
          </div>
          <div className="modal-actions"><button type="button" className="button" onClick={() => setModal(null)}>{t("cancel")}</button><button className="button button-primary" disabled={busy}>{t("issueBooks")}</button></div>
        </form> : modal === "field" ? <form onSubmit={addCustomField}>
          <div className="form-grid">
            <FieldInput label={t("fieldLabelEn")} name="label" value={form.label || ""} onChange={(value) => setForm({ ...form, label: value })} required />
            <FieldInput label={t("fieldLabelAm")} name="labelAm" value={form.labelAm || ""} onChange={(value) => setForm({ ...form, labelAm: value })} />
            <FieldSelect label={t("fieldType")} value={form.type || "text"} onChange={(value) => setForm({ ...form, type: value })} options={[["text", t("fieldText")], ["number", t("fieldNumber")], ["date", t("fieldDate")], ["select", t("fieldSelect")], ["email", t("fieldEmail")]]} />
            <FieldSelect label={t("entity")} value={form.entity || "BOOK"} disabled={Boolean(editingField)} onChange={(value) => setForm({ ...form, entity: value })} options={[["BOOK", t("books")], ["PATRON", t("userManagement")], ["INVENTORY", t("inventory")]]} />
            <FieldSelect label={t("requiredField")} value={form.required || "false"} onChange={(value) => setForm({ ...form, required: value })} options={[["false", t("no")], ["true", t("yes")]]} />
          </div>
          <div className="modal-actions"><button type="button" className="button" onClick={() => setModal(null)}>{t("cancel")}</button><button className="button button-primary" disabled={busy}>{t("save")}</button></div>
        </form> : isDataPage && page !== "circulation" && page !== "returns" && <form onSubmit={saveRecord}>
          <div className="form-grid">
            {[...pageConfig[page].fields, ...customFields.map((field) => ({ ...field, label: field.label }))].map((field) => (
              field.type === "select" ? <FieldSelect key={field.key} label={customFields.some((custom) => custom.key === field.key) ? (i18n.language === "am" ? field.labelAm || field.label : field.label) : t(field.label)} value={form[field.key] || (field.key === "condition" ? "GOOD" : "")} onChange={(value) => setForm({ ...form, [field.key]: value })} options={field.key === "condition" ? [["NEW", t("newAsset")], ["GOOD", t("good")], ["NEEDS_REPAIR", t("repair")], ["WRITTEN_OFF", t("writtenOff")]] : [["PDF", "PDF"], ["AUDIO", "Audio"]]} />
                : <FieldInput key={field.key} label={customFields.some((custom) => custom.key === field.key) ? (i18n.language === "am" ? field.labelAm || field.label : field.label) : t(field.label)} name={field.key} value={form[field.key] || ""} type={field.type === "number" || field.type === "email" || field.type === "date" || field.type === "tel" ? field.type : "text"} step={field.key === "value" ? "0.01" : undefined} required={field.required} placeholder={field.placeholder ? t(field.placeholder) : undefined} onChange={(value) => setForm({ ...form, [field.key]: value })} />))}
            {(page === "students" || page === "staff") && <>
              <FieldInput label={t("portalPassword")} name="patron-portal-password" value={form.password || ""} onChange={(value) => setForm({ ...form, password: value })} type="password" placeholder={t("portalPasswordPlaceholder")} minLength={12} autoComplete="new-password" />
              <p className="form-help">{t("patronPasswordHelp")}</p>
            </>}
          </div>
          <div className="modal-actions"><button type="button" className="button" onClick={() => setModal(null)}>{t("cancel")}</button><button className="button button-primary" disabled={busy}>{t("save")}</button></div>
        </form>}
      </div>
    </div>}
  </div>;
}

function FieldInput({ label, name, value, onChange, type = "text", step, required, placeholder, minLength, maxLength, autoComplete }: {
  label: string; name: string; value: string; type?: string; step?: string; required?: boolean; placeholder?: string; minLength?: number; maxLength?: number; autoComplete?: string; onChange: (value: string) => void;
}) {
  return <div className="field"><label htmlFor={`field-${name}`}>{label}</label><input id={`field-${name}`} type={type} step={step} value={value} required={required} minLength={minLength} maxLength={maxLength} autoComplete={autoComplete} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></div>;
}

class PageErrorBoundary extends Component<{ children: ReactNode; t: (key: string) => string }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("Page rendering failed.", error);
  }

  render() {
    if (this.state.hasError) {
      return <section className="notice" role="alert">{this.props.t("pageRenderError")} <button className="button" onClick={() => this.setState({ hasError: false })}>{this.props.t("retry")}</button></section>;
    }
    return this.props.children;
  }
}

function FieldSelect({ label, value, onChange, options, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; options: [string, string][]; disabled?: boolean;
}) {
  return <div className="field"><label>{label}</label><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map(([option, title]) => <option key={option} value={option}>{title}</option>)}</select></div>;
}

function SearchableBookSelect({ books, selected, onChange, t }: {
  books: Row[]; selected: string[]; onChange: (ids: string[]) => void; t: (key: string) => string;
}) {
  const [search, setSearch] = useState("");
  const visible = books.filter((book) => `${toText(book.title)} ${toText(book.author)} ${toText(book.isbn)}`.toLowerCase().includes(search.trim().toLowerCase()));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((current) => current !== id) : [...selected, id]);
  return <div className="field book-picker">
    <label>{t("selectBooks")}</label>
    <label className="table-search book-picker-search"><Search size={14} /><input aria-label={t("searchAvailableBooks")} placeholder={t("searchAvailableBooks")} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    <div className="book-picker-list" role="group" aria-label={t("selectBooks")}>
      {visible.length ? visible.map((book) => <label className="book-picker-option" key={book.id}>
        <input type="checkbox" checked={selected.includes(book.id)} onChange={() => toggle(book.id)} />
        <span><strong>{toText(book.title)}</strong><small>{toText(book.author)} · {toText(book.availableCopies)} {t("availableCopiesLabel")}</small></span>
      </label>) : <div className="book-picker-empty">{t("noBooks")}</div>}
    </div>
    <div className="book-picker-footer">{selected.length} {t("selectedBooks")}</div>
  </div>;
}

function SelfServicePortal({ user, libraryName, darkMode, onToggleTheme, onSignOut }: {
  user: Account; libraryName: string; darkMode: boolean; onToggleTheme: () => void; onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"dashboard" | "catalog" | "loans" | "reservations">("dashboard");
  const [books, setBooks] = useState<Row[]>([]);
  const [loans, setLoans] = useState<Row[]>([]);
  const [reservations, setReservations] = useState<PortalReservation[]>([]);
  const [media, setMedia] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState({ catalog: true, loans: true, reservations: true, media: true });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [preview, setPreview] = useState<{ title: string; type: string; url: string } | null>(null);
  const [busyReservation, setBusyReservation] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading((state) => ({ ...state, catalog: true }));
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      void api.get<Row[]>(`/books?${params.toString()}`).then((result) => {
        if (!cancelled) setBooks(result);
      }).catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : t("apiOffline"));
      }).finally(() => { if (!cancelled) setLoading((state) => ({ ...state, catalog: false })); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, t]);

  useEffect(() => {
    let cancelled = false;
    const loadPortalData = async () => {
      const loaders = [
        api.get<Row[]>("/portal/loans").then((result) => { if (!cancelled) setLoans(result); })
          .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : t("apiOffline")); })
          .finally(() => { if (!cancelled) setLoading((state) => ({ ...state, loans: false })); }),
        api.get<PortalReservation[]>("/portal/reservations").then((result) => { if (!cancelled) setReservations(result); })
          .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : t("apiOffline")); })
          .finally(() => { if (!cancelled) setLoading((state) => ({ ...state, reservations: false })); }),
        api.get<Row[]>("/media").then((result) => { if (!cancelled) setMedia(result); })
          .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : t("apiOffline")); })
          .finally(() => { if (!cancelled) setLoading((state) => ({ ...state, media: false })); }),
      ];
      await Promise.all(loaders);
    };
    void loadPortalData();
    return () => { cancelled = true; };
  }, [t]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const changeLanguage = () => { void i18n.changeLanguage(i18n.language === "en" ? "am" : "en"); };
  const activeLoans = loans.filter((loan) => loan.status !== "RETURNED");
  const loanHistory = loans.filter((loan) => loan.status === "RETURNED");
  const activeReservations = reservations.filter((item) => item.status === "REQUESTED" || item.status === "RESERVED");
  const currentFine = activeLoans.reduce((sum, loan) => sum + Number(loan.fineRemaining || 0), 0);

  async function requestReservation(bookId: string) {
    setBusyReservation(bookId);
    setError("");
    setSuccess("");
    try {
      await api.post("/portal/reservations", { bookId });
      setReservations(await api.get<PortalReservation[]>("/portal/reservations"));
      setSuccess(t("reservationRequested"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("reservationFailed"));
    } finally {
      setBusyReservation("");
    }
  }

  async function cancelReservation(id: string) {
    setBusyReservation(id);
    setError("");
    try {
      await api.post(`/portal/reservations/${id}/cancel`, {});
      setReservations(await api.get<PortalReservation[]>("/portal/reservations"));
      setSuccess(t("reservationCancelled"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("reservationFailed"));
    } finally {
      setBusyReservation("");
    }
  }

  async function openMedia(item: Row) {
    setError("");
    try {
      if (preview) URL.revokeObjectURL(preview.url);
      const blob = await download(`/media/${item.id}/file`);
      setPreview({ title: toText(item.title), type: toText(item.mediaType), url: URL.createObjectURL(blob) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("mediaUnavailable"));
    }
  }

  return <div className="portal-shell">
    <header className="topbar portal-topbar">
      <Brand libraryName={libraryName} />
      <div className="topbar-right"><span className="portal-user">{user.name}</span>
        <ThemeButton darkMode={darkMode} onToggle={onToggleTheme} />
        <button className="lang-button" onClick={changeLanguage}><Languages size={13} />{i18n.language === "en" ? "EN" : "አማ"}</button>
        <button className="button" onClick={onSignOut}><LogOut size={13} />{t("signOut")}</button>
      </div>
    </header>
    <main className="portal-content">
      <div className="page-heading"><div><div className="eyebrow">{t(user.patronType === "TEACHER" ? "teacherPortal" : "studentPortal")}</div><h1 className="page-title">{t("welcomeMember")}, {user.name}</h1><p className="page-description">{t("portalDescription")}</p></div></div>
      {error && <div className="notice" role="alert">{error}<button className="row-action" style={{ float: "right" }} onClick={() => setError("")}><X size={13} /></button></div>}
      {success && <div className="notice notice-success" role="status">{success}<button className="row-action" style={{ float: "right" }} onClick={() => setSuccess("")}><X size={13} /></button></div>}
      <div className="portal-tabs">
        <button className={`nav-item ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}><LayoutDashboard size={15} />{t("dashboard")}</button>
        <button className={`nav-item ${tab === "catalog" ? "active" : ""}`} onClick={() => setTab("catalog")}><BookOpen size={15} />{t("catalogPortal")}</button>
        <button className={`nav-item ${tab === "loans" ? "active" : ""}`} onClick={() => setTab("loans")}><ArrowUpFromLine size={15} />{t("myLoans")}</button>
        <button className={`nav-item ${tab === "reservations" ? "active" : ""}`} onClick={() => setTab("reservations")}><BookMarked size={15} />{t("myReservations")}{activeReservations.length > 0 && <span className="nav-count">{activeReservations.length}</span>}</button>
      </div>
      <div key={tab} className="page-transition">
        {tab === "dashboard" && <>
          <div className="portal-stats-grid">
            <section className="panel portal-stat"><div className="stat-label">{t("activeLoans")}</div><strong>{loading.loans ? "…" : activeLoans.length}</strong></section>
            <section className="panel portal-stat"><div className="stat-label">{t("overdueBooks")}</div><strong>{loading.loans ? "…" : activeLoans.filter((loan) => loan.status === "OVERDUE").length}</strong></section>
            <section className="panel portal-stat"><div className="stat-label">{t("fineBalance")}</div><strong>{loading.loans ? "…" : `${currentFine.toFixed(2)} ${t("ethiopianBirr")}`}</strong></section>
            <section className="panel portal-stat"><div className="stat-label">{t("borrowingHistory")}</div><strong>{loading.loans ? "…" : loanHistory.length}</strong></section>
          </div>
          <PortalLoanTable loans={activeLoans.slice(0, 5)} loading={loading.loans} emptyLabel={t("noActiveLoans")} t={t} />
          <PortalMediaSection media={media.slice(0, 4)} loading={loading.media} onOpen={openMedia} t={t} />
        </>}
        {tab === "catalog" && <>
          <section className="panel portal-search-panel"><label className="table-search"><Search size={14} /><input aria-label={t("searchBooks")} placeholder={t("searchBooks")} value={query} onChange={(event) => setQuery(event.target.value)} /></label><span>{books.length} {t("books").toLowerCase()}</span></section>
          {loading.catalog ? <div className="loading-state">{t("loading")}</div> : books.length ? <div className="portal-book-grid">{books.map((book) => {
            const activeRequest = activeReservations.find((reservation) => reservation.bookId === book.id);
            return <article className="panel portal-book" key={book.id}>
              <div className="portal-book-cover"><BookOpen size={23} /></div>
              <div className="portal-book-category">{toText(book.category) || t("books")}</div>
              <h2>{toText(book.title)}</h2><div className="portal-book-author">{toText(book.author)}</div>
              {toText(book.description) && <p className="portal-book-description">{toText(book.description)}</p>}
              {toText(book.shelfLocation) && <div className="portal-shelf">{t("shelfLocation")}: {toText(book.shelfLocation)}</div>}
              <div className="portal-availability"><span className={`availability-dot ${Number(book.availableCopies) > 0 ? "in-stock" : ""}`} />{Number(book.availableCopies) > 0 ? `${toText(book.availableCopies)} ${t("availableCopiesLabel")}` : t("unavailable")}</div>
              <button className="button button-primary portal-request-button" disabled={Boolean(activeRequest) || busyReservation === book.id} onClick={() => void requestReservation(book.id)}>
                {busyReservation === book.id ? t("loading") : activeRequest ? t("requestPending") : t("requestReservation")}
              </button>
            </article>;
          })}</div> : <div className="panel empty-state">{t("noBooks")}</div>}
          <PortalMediaSection media={media} loading={loading.media} onOpen={openMedia} t={t} />
        </>}
        {tab === "loans" && <div className="portal-loans-stack">
          <PortalLoanTable loans={activeLoans} loading={loading.loans} emptyLabel={t("noActiveLoans")} t={t} />
          <PortalLoanTable loans={loanHistory} loading={loading.loans} emptyLabel={t("noLoanHistory")} history t={t} />
        </div>}
        {tab === "reservations" && <section className="panel">
          <div className="panel-head"><div><div className="panel-title">{t("myReservations")}</div><div className="panel-subtitle">{t("reservationHelp")}</div></div></div>
          {loading.reservations ? <div className="loading-state">{t("loading")}</div> : reservations.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>{t("title")}</th><th>{t("author")}</th><th>{t("date")}</th><th>{t("status")}</th><th>{t("actions")}</th></tr></thead><tbody>
            {reservations.map((reservation) => <tr key={reservation.id}><td>{toText(reservation.book.title)}</td><td>{toText(reservation.book.author)}</td><td>{toText(reservation.requestedAt).slice(0, 10)}</td><td><Status value={reservation.status} t={t} /></td><td>{activeReservations.some((item) => item.id === reservation.id) && <button className="button" disabled={busyReservation === reservation.id} onClick={() => void cancelReservation(reservation.id)}>{t("cancelReservation")}</button>}</td></tr>)}
          </tbody></table></div> : <div className="empty-state">{t("noReservations")}</div>}
        </section>}
      </div>
      {t("footerNotice") && <footer className="app-footer">{t("footerNotice")}</footer>}
    </main>
    {preview && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ width: "min(900px,100%)" }}>
        <div className="modal-head"><div className="modal-title">{preview.title}</div><button className="row-action" aria-label={t("cancel")} onClick={() => setPreview(null)}><X size={17} /></button></div>
        {preview.type === "PDF" ? <iframe title={preview.title} src={preview.url} style={{ width: "100%", height: "70vh", border: "1px solid #edf0f1", borderRadius: 6 }} /> : <audio controls src={preview.url} style={{ width: "100%", margin: "34px 0" }}>Audio playback is not supported by this browser.</audio>}
      </div>
    </div>}
  </div>;
}

function PortalLoanTable({ loans, loading, emptyLabel, history = false, t }: {
  loans: Row[]; loading: boolean; emptyLabel: string; history?: boolean; t: (key: string) => string;
}) {
  return <section className="panel portal-loan-panel">
    <div className="panel-head"><div><div className="panel-title">{t(history ? "borrowingHistory" : "activeLoans")}</div><div className="panel-subtitle">{t(history ? "pastTransactions" : "myBorrowedBooks")}</div></div></div>
    {loading ? <div className="loading-state">{t("loading")}</div> : loans.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>{t("title")}</th><th>{t("author")}</th><th>{t("issuedAt")}</th><th>{history ? t("returned") : t("dueDate")}</th><th>{t("status")}</th><th>{t("fineBalance")}</th></tr></thead><tbody>
      {loans.map((loan) => <tr key={loan.id}><td>{toText(loan.title)}</td><td>{toText(loan.author)}</td><td>{toText(loan.issuedAt).slice(0, 10)}</td><td>{toText(history ? loan.returnedAt : loan.dueDate).slice(0, 10)}</td><td><Status value={toText(loan.status)} t={t} /></td><td>{Number(loan.fineRemaining).toFixed(2)} {t("ethiopianBirr")}</td></tr>)}
    </tbody></table></div> : <div className="empty-state">{emptyLabel}</div>}
  </section>;
}

function PortalMediaSection({ media, loading, onOpen, t }: {
  media: Row[]; loading: boolean; onOpen: (record: Row) => void; t: (key: string) => string;
}) {
  return <section className="panel portal-media-panel">
    <div className="panel-head"><div><div className="panel-title">{t("digitalResources")}</div><div className="panel-subtitle">{t("digitalResourcesHelp")}</div></div></div>
    {loading ? <div className="loading-state">{t("loading")}</div> : media.length ? <div className="portal-media-grid">{media.map((item) => <article className="portal-media-item" key={item.id}>
      <div className="portal-media-icon">{toText(item.mediaType) === "PDF" ? <FileText size={17} /> : <FileAudio size={17} />}</div>
      <div className="portal-media-info"><strong>{toText(item.title)}</strong><small>{toText(item.author) || toText(item.mediaType)}</small><span className="media-category-badge">{toText(item.category) || "Other"}</span></div>
      <button className="button" onClick={() => void onOpen(item)}>{t("previewMedia")}</button>
    </article>)}</div> : <div className="empty-state">{t("noDigitalResources")}</div>}
  </section>;
}

function Dashboard({ stats, loading, t, onNavigate }: { stats: Stats | null; loading: boolean; t: (key: string) => string; onNavigate: (page: Page) => void }) {
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12
    ? "Good morning, Admin"
    : currentHour < 18
      ? "Good afternoon, Admin"
      : "Good evening, Admin";
  const rawChartData = stats?.borrowingTrends?.length ? stats.borrowingTrends : monthNames.map((month) => ({ month, borrowed: 0, returned: 0 }));
  const chartData = localizeMonths(rawChartData);
  const categories = stats?.categories || [];
  const cards = [
    { label: t("totalBooks"), value: stats?.totalBooks ?? "—", icon: BookOpen, tint: "#e9f2ed", color: "#52876f" },
    { label: t("borrowed"), value: stats?.borrowedBooks ?? "—", icon: ArrowUpFromLine, tint: "#f8f0e7", color: "#b5824f" },
    { label: t("activeStudents"), value: stats?.activeStudents ?? "—", icon: Users, tint: "#edf0f8", color: "#7184ae" },
    { label: t("overdue"), value: stats?.overdueBooks ?? "—", icon: Clock3, tint: "#f9ebea", color: "#bb625b" },
  ];
  return <>
    <div className="page-heading"><div><div className="eyebrow">{t("overview")}</div><h1 className="page-title">{greeting}</h1><p className="page-description">{t("welcomeSub")}</p></div>
      <div className="heading-actions"><button className="button" onClick={() => onNavigate("reports")}><CalendarDays size={13} /> {t("thisMonth")} <ChevronDown size={12} /></button><button className="button button-primary" onClick={() => onNavigate("circulation")}><Plus size={14} /> {t("issueBooks")}</button></div>
    </div>
    <div className="stats-grid">{cards.map(({ label, value, icon: Icon, tint, color }) => <div className="stat-card" key={label}>
      <div className="stat-top"><span className="stat-label">{label}</span><div className="stat-icon" style={{ background: tint, color }}><Icon size={15} /></div></div>
      <div className="stat-value">{loading ? "…" : value}</div><div className="stat-foot">{t("liveData")}</div>
    </div>)}</div>
    <div className="chart-grid">
      <section className="panel">
        <div className="panel-head"><div><div className="panel-title">{t("borrowingActivity")}</div><div className="panel-subtitle">{t("chartsNote")}</div></div>
          <div className="chart-key"><span className="key-item"><i className="key-dot" /> {t("borrowed")}</span><span className="key-item"><i className="key-dot soft" /> {t("returned")}</span></div></div>
        <div className="panel-content" style={{ height: 205 }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 10, right: 6, left: -23, bottom: 0 }}>
          <defs><linearGradient id="greenFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#61957c" stopOpacity={0.18} /><stop offset="95%" stopColor="#61957c" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid stroke="#f0f2f1" vertical={false} /><XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: "#a4abad", fontSize: 9 }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: "#a4abad", fontSize: 9 }} /><Tooltip contentStyle={{ border: "1px solid #edf0ee", borderRadius: 7, fontSize: 10 }} />
          <Area type="monotone" dataKey="borrowed" stroke="#518970" strokeWidth={2} fill="url(#greenFill)" /><Area type="monotone" dataKey="returned" stroke="#bad0c1" strokeWidth={1.5} fill="transparent" />
        </AreaChart></ResponsiveContainer></div>
      </section>
      <section className="panel">      <div className="panel-head"><div><div className="panel-title">{t("popularCategories")}</div><div className="panel-subtitle">{t("borrowedByCategory")}</div></div><button className="row-action" aria-label={t("actions")}><MoreHorizontal size={16} /></button></div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 112 }}>
          {categories.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categories} dataKey="value" nameKey="name" innerRadius={31} outerRadius={47} paddingAngle={3} stroke="none">{categories.map((_, index) => <Cell key={index} fill={colors[index % colors.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer> : <div className="empty-state" style={{ padding: 10 }}>{t("noCategoryActivity")}</div>}
        </div>
        <div className="category-list">{categories.slice(0, 4).map((category, index) => <div className="category-row" key={category.name}><span className="category-name">{category.name}</span><div className="category-track"><div className="category-fill" style={{ width: `${Math.min(100, category.value)}%`, background: colors[index % colors.length] }} /></div><span className="category-value">{category.value}%</span></div>)}</div>
      </section>
    </div>
    <section className="panel activity-panel">    <div className="panel-head"><div><div className="panel-title">{t("recentActivity")}</div><div className="panel-subtitle">{t("latestCheckouts")}</div></div><button className="button" onClick={() => onNavigate("circulation")}>{t("viewAll")} <ArrowDownToLine size={12} /></button></div>
      <div className="table-wrap"><table className="activity-table"><thead><tr><th>{t("bookCatalog")}</th><th>{t("borrower")}</th><th>{t("dueDate")}</th><th>{t("status")}</th></tr></thead><tbody>
        {stats?.recentLoans?.slice(0, 4).map((loan) => <tr key={loan.id}><td><div className="book-info"><div className="book-cover">{toText(loan.title).slice(0, 1)}</div><div><div className="book-title">{toText(loan.title)}</div><div className="book-meta">{toText(loan.author)}</div></div></div></td><td>{toText(loan.borrowerName)}</td><td>{toText(loan.dueDate).slice(0, 10)}</td><td><Status value={toText(loan.status)} t={t} /></td></tr>)}
        {!stats?.recentLoans?.length && !loading && <tr><td colSpan={4}><div className="empty-state">{t("noRecords")}</div></td></tr>}
      </tbody></table></div>
    </section>
  </>;
}

function Status({ value, t }: { value: string; t: (key: string) => string }) {
  const key = value.toLowerCase().replaceAll("_", "-");
  const display = value === "AVAILABLE" ? t("available") : value === "BORROWED" ? t("borrowedStatus") : value === "OVERDUE" ? t("overdue") : value === "RETURNED" ? t("returned") : value === "CHECKED_OUT" ? t("checkedOut")
    : value === "REQUESTED" ? t("reservationPending") : value === "RESERVED" ? t("reservationApproved") : value === "FULFILLED" ? t("reservationIssued") : value === "CANCELLED" ? t("reservationCancelledStatus") : value.replaceAll("_", " ").toLowerCase();
  const localized = value === "GOOD" ? t("good") : value === "NEW" ? t("newAsset") : value === "NEEDS_REPAIR" ? t("repair") : value === "WRITTEN_OFF" ? t("writtenOff") : value === "PDF" ? "PDF" : value === "AUDIO" ? t("audio") : display;
  return <span className={`status-pill status-${key}`}>{localized}</span>;
}

function ReservationsPage({ records, loading, query, setQuery, busy, t, onUpdate, onDelete, onClearHistory }: {
  records: StaffReservation[]; loading: boolean; query: string; setQuery: (value: string) => void; busy: boolean;
  t: (key: string) => string; onUpdate: (reservation: Row, status: "RESERVED" | "FULFILLED" | "CANCELLED") => void;
  onDelete: (reservation: Row) => void; onClearHistory: () => void;
}) {
  const search = query.trim().toLowerCase();
  const visible = records.filter((reservation) => !search ||
    `${toText(reservation.patron?.name)} ${toText(reservation.book?.title)} ${reservation.status}`.toLowerCase().includes(search));
  return <>
    <div className="page-heading"><div><div className="eyebrow">{t("appName")} · {t("adminSettings")}</div><h1 className="page-title">{t("reservationQueue")}</h1><p className="page-description">{t("reservationQueueHelp")}</p></div></div>
    <section className="panel">
      <div className="toolbar"><div className="toolbar-group" style={{ flex: 1 }}><label className="table-search"><Search size={14} /><input aria-label={t("search")} placeholder={t("searchReservations")} value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
        <span className="reservation-count">{records.filter((item) => item.status === "REQUESTED" || item.status === "RESERVED").length} {t("activeReservations")}</span>
        <button className="button" disabled={busy} onClick={onClearHistory}><Trash2 size={13} />{t("clearHistory")}</button>
      </div>
      <div className="table-wrap"><table className="data-table reservation-table"><thead><tr><th>{t("patron")}</th><th>{t("title")}</th><th>{t("requestDate")}</th><th>{t("status")}</th><th>{t("actions")}</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={5}><div className="loading-state">{t("loading")}</div></td></tr> : visible.length ? visible.map((reservation) => {
          const active = reservation.status === "REQUESTED" || reservation.status === "RESERVED";
          return <tr key={reservation.id}><td>{toText(reservation.patron?.name) || "—"}</td><td>{toText(reservation.book?.title) || "—"}</td><td>{new Date(toText(reservation.requestedAt)).toLocaleDateString()}</td><td><Status value={reservation.status} t={t} /></td>
            <td><div className="reservation-actions">
              {reservation.status === "REQUESTED" && <button className="button" disabled={busy} onClick={() => onUpdate(reservation, "RESERVED")}>{t("approveReservation")}</button>}
              {active && <button className="button button-primary" disabled={busy} onClick={() => onUpdate(reservation, "FULFILLED")}>{t("approveAndIssue")}</button>}
              {active && <button className="button button-danger" disabled={busy} onClick={() => onUpdate(reservation, "CANCELLED")}>{t("cancelReservation")}</button>}
              <button className="row-action" title={t("delete")} aria-label={t("delete")} disabled={busy} onClick={() => onDelete(reservation)}><Trash2 size={14} /></button>
            </div></td></tr>;
        }) : <tr><td colSpan={5}><div className="empty-state">{query.trim() ? t("noMatchingReservations") : t("noReservations")}</div></td></tr>}
      </tbody></table></div>
    </section>
  </>;
}

function DataPage({ page, records, loading, query, setQuery, statusFilter, setStatusFilter, mediaCategoryFilter, setMediaCategoryFilter, onCreate, onEdit, onDelete, onReturn, onCollectFine, onPortalAccount, onScanReturn, onExport, onImport, onUpload, onPreview, selectedIds, onToggleSelected, onDeleteSelected, onReturnSelected, onDeleteBorrowing, onClearHistory, busy, t }: {
  page: Exclude<Page, "dashboard" | "reports" | "settings" | "reservations">; records: Row[]; loading: boolean; query: string; setQuery: (value: string) => void;
  statusFilter: string; setStatusFilter: (value: string) => void; mediaCategoryFilter: string; setMediaCategoryFilter: (value: string) => void;
  onCreate: () => void; onEdit: (record: Row) => void; onDelete: (record: Row) => void;
  onReturn: (record: Row) => void; onCollectFine: (record: Row) => void; onPortalAccount: (record: Row) => void; onScanReturn: () => void; onExport: (format: "xlsx" | "docx") => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void; onUpload: (event: ChangeEvent<HTMLInputElement>, category: string) => void; onPreview: (record: Row) => void;
  selectedIds: string[]; onToggleSelected: (id: string) => void; onDeleteSelected: () => void; onReturnSelected: () => void;
  onDeleteBorrowing: (record: Row) => void; onClearHistory: () => void; busy: boolean; t: (key: string) => string;
}) {
  const config = page === "circulation" ? { title: "borrowBooks", description: "", icon: ArrowUpFromLine } :
    page === "returns" ? { title: "returnBooks", description: "fineCalculated", icon: RotateCcw } : pageConfig[page];
  const isCirculation = page === "circulation";
  const isReturnPage = page === "returns";
  const isMedia = page === "media";
  const isInventory = page === "inventory";
  const isPeople = page === "students" || page === "staff";
  const [uploadCategory, setUploadCategory] = useState("Other");
  const headers = isCirculation || isReturnPage
    ? [["title", "title"], ["borrowerName", "borrower"], ["memberCode", "id"], ["dueDate", "dueDate"], ["status", "status"], ["fineRemaining", "fine"]]
    : isPeople
      ? [["name", "name"], ["memberCode", "ID"], ["email", "email"], ["phone", "phone"], ["grade", page === "students" ? "grade" : "category"], ["status", "status"]]
      : isInventory
        ? [["name", "asset"], ["category", "category"], ["quantity", "quantity"], ["location", "location"], ["condition", "condition"]]
        : isMedia
          ? [["title", "title"], ["mediaType", "type"], ["category", "category"], ["fileName", "file"], ["createdAt", "date"]]
          : [["title", "title"], ["author", "author"], ["category", "category"], ["isbn", "isbn"], ["availableCopies", "available"]];
  const searchPlaceholder = page === "books" ? t("searchBooks") : page === "students" ? t("searchStudents") : t("search");

  return <>
    <div className="page-heading"><div><div className="eyebrow">{t("appName")} · {t("adminSettings")}</div><h1 className="page-title">{t(config.title)}</h1>{config.description && <p className="page-description">{t(config.description)}</p>}</div>
      <div className="heading-actions">{isMedia ? <>
        <label className="media-upload-category"><span>{t("category")}</span><select aria-label={t("category")} value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value)}>{mediaCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        <label className="button button-primary"><Plus size={13} />{t("uploadMedia")}<input type="file" accept=".pdf,.mp3,.wav,.m4a,.ogg" hidden onChange={(event) => onUpload(event, uploadCategory)} /></label>
      </> : isCirculation ? <><button className="button button-primary" onClick={onCreate}><Plus size={13} />{t("issueBooks")}</button><button className="button" disabled={busy} onClick={onClearHistory}><Trash2 size={13} />{t("clearHistory")}</button></> : isReturnPage ? <><button className="button" onClick={onScanReturn}><Camera size={13} />{t("scanToReturn")}</button><button className="button" disabled={busy} onClick={onClearHistory}><Trash2 size={13} />{t("clearHistory")}</button></> : <button className="button button-primary" onClick={onCreate}><Plus size={13} />{page === "books" ? t("addBook") : page === "students" ? t("addStudent") : t("addRecord")}</button>}</div>
    </div>
    <section className="panel">
      <div className="toolbar">
        <div className="toolbar-group" style={{ flex: 1 }}>
          <label className="table-search"><Search size={14} /><input aria-label={searchPlaceholder} placeholder={searchPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          {(isCirculation || isReturnPage || page === "books") && <select aria-label={t("filter")} className="select-control" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="ALL">{t("all")}</option>{isCirculation ? <><option value="ACTIVE">{t("activeLoans")}</option><option value="OVERDUE">{t("overdue")}</option><option value="RETURNED">{t("history")}</option></> : isReturnPage ? <><option value="CHECKED_OUT">{t("checkedOut")}</option><option value="OVERDUE">{t("overdue")}</option></> : <><option value="AVAILABLE">{t("available")}</option><option value="BORROWED">{t("borrowedStatus")}</option></>}
          </select>}
          {isMedia && <>
            <select aria-label={t("filterByType")} className="select-control" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="ALL">{t("allTypes")}</option><option value="PDF">PDF</option><option value="AUDIO">{t("audio")}</option><option value="VIDEO">{t("video")}</option>
              {[...new Set(records.map((record) => toText(record.mediaType)))].filter((type) => !["PDF", "AUDIO", "VIDEO"].includes(type)).map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <select aria-label={t("filterByCategory")} className="select-control" value={mediaCategoryFilter} onChange={(event) => setMediaCategoryFilter(event.target.value)}>
              <option value="ALL">{t("allCategories")}</option>{mediaCategories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </>}
        </div>
        <div className="toolbar-group">
          {isReturnPage && selectedIds.length > 0 && <button className="button button-primary" disabled={busy} onClick={onReturnSelected}><RotateCcw size={12} />{t("returnSelected")} ({selectedIds.length})</button>}
          {isPeople && selectedIds.length > 0 && <button className="button button-danger" onClick={onDeleteSelected}><Trash2 size={12} />{t("deleteSelected")} ({selectedIds.length})</button>}
          {!isCirculation && !isReturnPage && !isMedia && <label className="button"><Download size={12} />{t("import")}<input type="file" accept=".xlsx,.docx" hidden onChange={onImport} /></label>}
          {!isCirculation && !isReturnPage && !isMedia && <div style={{ display: "flex", gap: 5 }}><button className="button" title="Export Excel" onClick={() => onExport("xlsx")}><ArrowDownToLine size={12} /><span className="hide-mobile">XLSX</span></button><button className="button" title="Export Word" onClick={() => onExport("docx")}><FileText size={12} /><span className="hide-mobile">DOCX</span></button></div>}
          <button className="button" onClick={() => { setStatusFilter("ALL"); setMediaCategoryFilter("ALL"); }}><SlidersHorizontal size={12} />{t("filter")}</button>
        </div>
      </div>
      <div className="table-wrap"><table className="data-table"><thead><tr>
        {isPeople && <th><input type="checkbox" aria-label={t("selectAll")} checked={records.length > 0 && records.every((record) => selectedIds.includes(record.id))} onChange={(event) => {
          if (event.target.checked) records.forEach((record) => { if (!selectedIds.includes(record.id)) onToggleSelected(record.id); });
          else records.forEach((record) => { if (selectedIds.includes(record.id)) onToggleSelected(record.id); });
        }} /></th>}
        {isReturnPage && <th><input type="checkbox" aria-label={t("selectBorrowedBooks")} checked={records.length > 0 && records.every((record) => selectedIds.includes(toText(record.loanItemId || record.id)))} onChange={(event) => {
          if (event.target.checked) records.forEach((record) => { const id = toText(record.loanItemId || record.id); if (!selectedIds.includes(id)) onToggleSelected(id); });
          else records.forEach((record) => { const id = toText(record.loanItemId || record.id); if (selectedIds.includes(id)) onToggleSelected(id); });
        }} /></th>}
        {headers.map(([key, label]) => <th key={key}>{t(label)}</th>)}<th>{t("actions")}</th>
      </tr></thead><tbody>
        {loading ? <tr><td colSpan={headers.length + 1 + (isPeople || isReturnPage ? 1 : 0)}><div className="loading-state">{t("loading")}</div></td></tr> : records.length ? records.map((record) => <tr key={record.id}>
          {isPeople && <td><input type="checkbox" aria-label={`Select ${toText(record.name)}`} checked={selectedIds.includes(record.id)} onChange={() => onToggleSelected(record.id)} /></td>}
          {isReturnPage && <td><input type="checkbox" aria-label={`${t("selectBorrowedBooks")}: ${toText(record.title)} · ${toText(record.borrowerName)}`} checked={selectedIds.includes(toText(record.loanItemId || record.id))} onChange={() => onToggleSelected(toText(record.loanItemId || record.id))} /></td>}
          {headers.map(([key]) => <td key={key}>{key === "status" || key === "condition" || key === "mediaType" ? <Status value={toText(record[key])} t={t} /> : isMedia && key === "category" ? <span className="media-category-badge">{toText(record.category) || "Other"}</span> : key === "title" && page === "books" ? <div className="book-info"><div className="book-cover">{toText(record.title).slice(0, 1)}</div><div><div className="book-title">{toText(record.title)}</div><div className="book-meta">{toText(record.author)}</div></div></div> : key === "fineRemaining" ? `${Number(record.fineRemaining).toFixed(2)} ${t("ethiopianBirr")}` : key === "dueDate" || key === "createdAt" ? toText(record[key]).slice(0, 10) : toText(record[key]) || "—"}</td>)}
          <td><div style={{ display: "flex", alignItems: "center", gap: 5 }}>{(isCirculation || isReturnPage) && toText(record.status) !== "RETURNED" && <button className="row-action" title={t("returnBook")} aria-label={t("returnBook")} onClick={() => onReturn(record)}><Check size={14} /></button>}{isCirculation && toText(record.status) === "RETURNED" && <button className="row-action" title={t("delete")} aria-label={t("delete")} disabled={busy} onClick={() => onDeleteBorrowing(record)}><Trash2 size={14} /></button>}{isCirculation && Number(record.fineRemaining) > 0 && <button className="row-action" title={t("collectFine")} onClick={() => onCollectFine(record)}><CircleDollarSign size={14} /></button>}{isMedia && <><button className="row-action" title={t("openMedia")} aria-label={t("openMedia")} onClick={() => onPreview(record)}>{toText(record.mediaType) === "PDF" ? <FileText size={14} /> : <FileAudio size={14} />}</button><button className="row-action media-delete-action" title={t("delete")} aria-label={t("delete")} onClick={() => onDelete(record)}><Trash2 size={14} /></button></>}{!isCirculation && !isReturnPage && !isMedia && <>{isPeople && <button className="row-action" title={record.hasPortalAccount ? t("resetPortalPassword") : t("setPortalPassword")} aria-label={record.hasPortalAccount ? t("resetPortalPassword") : t("setPortalPassword")} onClick={() => onPortalAccount(record)}><KeyRound size={14} /></button>}<button className="row-action" title={t("edit")} onClick={() => onEdit(record)}><Settings size={13} /></button><button className="row-action" title={t("delete")} onClick={() => onDelete(record)}><Trash2 size={13} /></button></>}</div></td>
        </tr>) : <tr><td colSpan={headers.length + 1 + (isPeople || isReturnPage ? 1 : 0)}><div className="empty-state">{t(isReturnPage ? "noActiveReturns" : "noRecords")}</div></td></tr>}
      </tbody></table></div>
      <div className="table-footer"><span>{records.length} {t("all").toLowerCase()} {t(page === "books" ? "books" : isPeople ? "userManagement" : isCirculation ? "activeLoans" : isReturnPage ? "returnBooks" : isMedia ? "media" : "inventory").toLowerCase()}</span><span>{page === "books" ? t("bookCatalog") : t("appName")}</span></div>
    </section>
  </>;
}

function Reports({ stats, loading, t }: { stats: Stats | null; loading: boolean; t: (key: string) => string }) {
  const values = [
    { title: "booksInCollection", value: stats?.totalBooks ?? "—", icon: BookOpen, note: t("totalBooks") },
    { title: "borrowersThisMonth", value: stats?.borrowersThisMonth ?? "—", icon: Users, note: t("borrowersThisMonth") },
    { title: "finesCollected", value: `${(stats?.finesCollected || 0).toFixed(2)} ${t("ethiopianBirr")}`, icon: CircleDollarSign, note: t("fineCollection") },
    { title: "overdueRate", value: stats?.totalBooks ? `${Math.round((stats.overdueBooks / stats.totalBooks) * 100)}%` : "—", icon: Activity, note: t("overdue") },
  ];
  return <>
    <div className="page-heading"><div><div className="eyebrow">{t("appName")} · {t("reports")}</div><h1 className="page-title">{t("reportSummary")}</h1><p className="page-description">{t("reportDescription")}</p></div><button className="button" onClick={() => window.print()}><Download size={13} />{t("export")}</button></div>
    <div className="report-grid">{values.map(({ title, value, icon: Icon, note }) => <section className="panel report-card" key={title}><div className="stat-top"><div className="panel-title">{t(title)}</div><div className="stat-icon" style={{ background: "#eaf2ee", color: "#52876f" }}><Icon size={15} /></div></div><div className="report-number">{loading ? "…" : value}</div><div className="report-note">{note}</div></section>)}</div>
    <div style={{ height: 14 }} />
    <section className="panel"><div className="panel-head"><div><div className="panel-title">{t("monthlyBorrowing")}</div><div className="panel-subtitle">{t("chartsNote")}</div></div></div><div style={{ height: 270, padding: "8px 18px 18px" }}><ResponsiveContainer width="100%" height="100%"><AreaChart data={localizeMonths(stats?.borrowingTrends || [])} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}><CartesianGrid stroke="#f0f2f1" vertical={false} /><XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: "#a4abad", fontSize: 9 }} /><YAxis tickLine={false} axisLine={false} tick={{ fill: "#a4abad", fontSize: 9 }} /><Tooltip /><Area type="monotone" dataKey="borrowed" stroke="#518970" fill="#edf5ef" /><Area type="monotone" dataKey="returned" stroke="#d2a66a" fill="transparent" /></AreaChart></ResponsiveContainer></div></section>
  </>;
}

function SettingsPage({ fields, loading, t, settings, busy, onSave, onAdd, onEdit, onRemove, onChangeLanguage, onChangePassword }: {
  fields: FormField[]; loading: boolean; t: (key: string) => string; settings: LibrarySettings; busy: boolean;
  onSave: (settings: LibrarySettings) => Promise<void>; onAdd: () => void;
  onEdit: (field: FormField) => void; onRemove: (id: string) => void;
  onChangeLanguage: (language: "en" | "am") => Promise<void>;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(settings);
  const [translations, setTranslations] = useState<{ key: string; english: string; amharic: string }[]>([]);
  const [translationError, setTranslationError] = useState("");
  const [footerNoticeEnglish, setFooterNoticeEnglish] = useState(settings.englishText.footerNotice || "");
  const [footerNoticeAmharic, setFooterNoticeAmharic] = useState(settings.amharicText.footerNotice || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  useEffect(() => {
    setDraft(settings);
    setFooterNoticeEnglish(settings.englishText.footerNotice || "");
    setFooterNoticeAmharic(settings.amharicText.footerNotice || "");
    const keys = new Set([...Object.keys(settings.englishText), ...Object.keys(settings.amharicText)]);
    keys.delete("footerNotice");
    setTranslations([...keys].map((key) => ({
      key,
      english: settings.englishText[key] || "",
      amharic: settings.amharicText[key] || "",
    })));
  }, [settings]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const englishText: Record<string, string> = {};
    const amharicText: Record<string, string> = {};
    const keys = new Set<string>(["footerNotice"]);
    setTranslationError("");
    for (const row of translations) {
      const key = row.key.trim();
      if (!key && !row.english && !row.amharic) continue;
      if (!key) {
        setTranslationError(t("translationKeyRequired"));
        return;
      }
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || keys.has(key)) {
        setTranslationError(`${t("translationKey")}: ${key}`);
        return;
      }
      keys.add(key);
      if (row.english) englishText[key] = row.english;
      if (row.amharic) amharicText[key] = row.amharic;
    }
    if (footerNoticeEnglish) englishText.footerNotice = footerNoticeEnglish;
    if (footerNoticeAmharic) amharicText.footerNotice = footerNoticeAmharic;
    await onSave({ ...draft, englishText, amharicText });
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError("");
    if (newPassword !== confirmPassword) {
      setPasswordError(t("passwordMismatch"));
      return;
    }
    if (await onChangePassword(currentPassword, newPassword)) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }

  return <>
    <section className="panel settings-form" aria-labelledby="admin-settings-welcome">
      <div className="settings-body">
        <div className="eyebrow">{t("appName")} · {t("adminSettings")}</div>
        <h1 id="admin-settings-welcome" className="page-title">Welcome Admin</h1>
        <p className="page-description">{t("welcomeSub")}</p>
      </div>
    </section>
    <form className="panel settings-form" onSubmit={save}>
      <div className="panel-head"><div><div className="panel-title">{t("libraryBranding")}</div><div className="panel-subtitle">{t("interfaceTextHelp")}</div></div><ShieldCheck size={16} color="#67957f" /></div>
      <div className="settings-body">
        <div className="form-grid">
          <FieldInput label={t("libraryName")} name="library-name" value={draft.libraryName} onChange={(value) => setDraft({ ...draft, libraryName: value })} required />
          <FieldInput label={t("appTitle")} name="app-title" value={draft.appTitle} onChange={(value) => setDraft({ ...draft, appTitle: value })} required />
          <div className="field"><label htmlFor="settings-language">{t("language")}</label><select id="settings-language" className="select-control" value={draft.defaultLanguage} onChange={(event) => { const nextLanguage = event.target.value as "en" | "am"; setDraft({ ...draft, defaultLanguage: nextLanguage }); void onChangeLanguage(nextLanguage); }}><option value="en">{t("english")}</option><option value="am">{t("amharic")}</option></select></div>
          <FieldInput label={`${t("footerNotice")} · ${t("english")}`} name="footer-notice-en" value={footerNoticeEnglish} onChange={setFooterNoticeEnglish} placeholder={t("footerNoticePlaceholder")} maxLength={500} />
          <FieldInput label={`${t("footerNotice")} · ${t("amharic")}`} name="footer-notice-am" value={footerNoticeAmharic} onChange={setFooterNoticeAmharic} placeholder={t("footerNoticePlaceholder")} maxLength={500} />
        </div>
        <div className="settings-translation-heading"><div><div className="panel-title">{t("interfaceText")}</div><div className="panel-subtitle">{t("interfaceTextHelp")}</div></div>
          <button type="button" className="button" onClick={() => setTranslations([...translations, { key: "", english: "", amharic: "" }])}><Plus size={13} />{t("addTranslation")}</button>
        </div>
        {translationError && <div className="notice" role="alert">{translationError}</div>}
        {translations.map((row, index) => <div className="settings-translation-row" key={index}>
          <FieldInput label={t("translationKey")} name={`translation-key-${index}`} value={row.key} onChange={(key) => setTranslations(translations.map((entry, rowIndex) => rowIndex === index ? { ...entry, key } : entry))} placeholder="e.g. appName" />
          <FieldInput label={t("english")} name={`translation-en-${index}`} value={row.english} onChange={(english) => setTranslations(translations.map((entry, rowIndex) => rowIndex === index ? { ...entry, english } : entry))} />
          <FieldInput label={t("amharic")} name={`translation-am-${index}`} value={row.amharic} onChange={(amharic) => setTranslations(translations.map((entry, rowIndex) => rowIndex === index ? { ...entry, amharic } : entry))} />
          <button type="button" className="row-action translation-remove" aria-label={t("removeTranslation")} title={t("removeTranslation")} onClick={() => setTranslations(translations.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={14} /></button>
        </div>)}
        <div className="settings-actions"><button className="button button-primary" disabled={busy}><Check size={13} />{t("saveSettings")}</button></div>
      </div>
    </form>
    <form className="panel settings-form" onSubmit={(event) => void savePassword(event)}>
      <div className="panel-head"><div><div className="panel-title">{t("changePassword")}</div><div className="panel-subtitle">{t("changePasswordHelp")}</div></div><KeyRound size={16} color="#67957f" /></div>
      <div className="settings-body">
        <div className="form-grid">
          <FieldInput label={t("currentPassword")} name="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={setCurrentPassword} required />
          <FieldInput label={t("newPassword")} name="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={setNewPassword} minLength={12} required />
          <FieldInput label={t("confirmPassword")} name="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={setConfirmPassword} minLength={12} required />
        </div>
        {passwordError && <div className="notice" role="alert">{passwordError}</div>}
        <div className="settings-actions"><button className="button button-primary" disabled={busy}><Check size={13} />{t("savePassword")}</button></div>
      </div>
    </form>
    <section className="panel settings-custom-fields">
      <div className="panel-head"><div><div className="panel-title">{t("customForms")}</div><div className="panel-subtitle">{t("configureFields")}</div></div><button className="button button-primary" onClick={onAdd}><Plus size={13} />{t("addField")}</button></div>
      {loading ? <div className="loading-state">{t("loading")}</div> : fields.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>{t("fieldLabel")}</th><th>{t("fieldType")}</th><th>{t("entity")}</th><th>{t("requiredField")}</th><th>{t("actions")}</th></tr></thead><tbody>{fields.map((field) => <tr key={field.id || field.key}><td>{i18n.language === "am" ? field.labelAm || field.label : field.label}</td><td>{t(`field${field.type.charAt(0).toUpperCase()}${field.type.slice(1)}`)}</td><td>{field.entity || "—"}</td><td>{field.required ? t("yes") : t("no")}</td><td><button className="row-action" onClick={() => onEdit(field)} aria-label={t("edit")}><Settings size={14} /></button><button className="row-action" onClick={() => onRemove(field.id || field.key)} aria-label={t("delete")}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div> : <div className="empty-state">{t("noRecords")}</div>}
    </section>
  </>;
}

export default App;
