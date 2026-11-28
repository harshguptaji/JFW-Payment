import "abortcontroller-polyfill/dist/abortcontroller-polyfill-only";
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";

import ReactDOM from "react-dom/client";

import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useNavigate,
  useParams,
} from "react-router-dom";

import axios from "axios";
import { io } from "socket.io-client";
import confetti from "canvas-confetti";

import "./style.css";

const unifiedTableStyle = document.createElement("style");
unifiedTableStyle.textContent = `.unified-target-table th:nth-child(1){width:25%}.unified-target-table th:nth-child(2){width:18%}.unified-target-table th:nth-child(3){width:15%}.unified-target-table th:nth-child(4){width:22%}.unified-target-table th:nth-child(5){width:20%}`;
document.head.appendChild(unifiedTableStyle);

/* ==========================================
   API CONFIGURATION
========================================== */

const SERVER_URL = (
  import.meta.env.VITE_API_URL ||
  "http://localhost:5000"
).replace(/\/+$/, "");

const api = axios.create({
  baseURL: `${SERVER_URL}/api`,
  timeout: 30000,
});

const socket = io(SERVER_URL, {
  transports: ["polling", "websocket"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

socket.on("connect", () => console.log("Socket connected:", socket.id));
socket.on("disconnect", (reason) => console.log("Socket disconnected:", reason));
socket.on("connect_error", (error) => console.error("Socket connection error:", error.message));

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/* ==========================================
   COMMON HELPERS
========================================== */

function today() {
  return new Date(Date.now() + 19800000)
    .toISOString()
    .slice(0, 10);
}

function dateInput(value) {
  if (!value) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return new Date(+new Date(value) + 19800000)
    .toISOString()
    .slice(0, 10);
}

function dateText(value) {
  if (!value) return "—";

  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

// Week end dates are stored as exclusive IST midnight boundaries.
function weekEndInput(value) {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  return dateInput(new Date(timestamp - 86400000));
}

function weekEndText(value) {
  return dateText(weekEndInput(value));
}

function money(value) {
  if (value === null || value === undefined) {
    return "—";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(Number(value) / 100);
}

function percent(value) {
  if (value === null || value === undefined) {
    return "—";
  }

  return `${Number(value).toFixed(1)}%`;
}

function sum(rows, key) {
  return rows.reduce(
    (total, row) => total + Number(row[key] || 0),
    0
  );
}

function errorText(error) {
  return (
    error.response?.data?.message ||
    error.message ||
    "Something went wrong"
  );
}

function managementHeaders() {
  return {
    headers: {
      "X-Management-Key":
        sessionStorage.getItem("jfwManagementKey") || "",
    },
  };
}

function initialFilters() {
  return {
    duration: "today",
    year: today().slice(0, 4),
    month: today().slice(0, 7),
    weekId: "",
  };
}

function reportParams(filters, employeeId) {
  const params = {
    duration: filters.duration,
  };

  if (filters.duration === "weekly" && filters.weekId) {
    params.weekId = filters.weekId;
  }

  if (filters.duration === "monthly") {
    params.month = filters.month;
  }

  if (filters.duration === "yearly") {
    params.year = filters.year;
  }

  if (employeeId) {
    params.employeeId = employeeId;
  }

  return params;
}

/* ==========================================
   DATA FETCHING HOOK
========================================== */

function useData(
  path,
  {
    params = {},
    protectedRoute = false,
    enabled = true,
    events = [],
    interval = 0,
  } = {}
) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");

  const paramsKey = JSON.stringify(params);
  const eventsKey = JSON.stringify(events);

  const refresh = useCallback(
    async (signal) => {
      if (!enabled) return;

      try {
        const response = await api.get(path, {
          params: JSON.parse(paramsKey),
          ...(protectedRoute ? managementHeaders() : {}),
          ...(signal ? { signal } : {}),
        });

        if (signal?.aborted) return;

        setData(response.data);
        setError("");

        return response.data;
      } catch (err) {
        if (err.code !== "ERR_CANCELED") {
          setError(errorText(err));
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [path, paramsKey, protectedRoute, enabled]
  );

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();

    setLoading(true);
    setData(null);

    refresh(controller.signal);

    const handler = () => refresh(controller.signal);
    const names = JSON.parse(eventsKey);

    names.forEach((event) => socket.on(event, handler));

    const timer = interval
      ? setInterval(handler, interval)
      : null;

    return () => {
      controller.abort();

      names.forEach((event) =>
        socket.off(event, handler)
      );

      if (timer) clearInterval(timer);
    };
  }, [refresh, eventsKey, interval, enabled]);

  return {
    data,
    loading,
    error,
    refresh,
  };
}

function useEmployees(all = true) {
  return useData("/employees", {
    params: all ? { all: 1 } : {},
    events: ["employees:changed"],
  });
}

function useWeeks() {
  return useData("/weeks", {
    events: ["weeks:changed"],
  });
}

/* ==========================================
   COMMON COMPONENTS
========================================== */

function Logo() {
  return (
    <img
      src="/logo.svg"
      alt="Juniors Fashion Week"
      className="jfw-logo"
    />
  );
}

function EmployeePhoto({ employee, className = "" }) {
  const name =
    employee?.employeeName ||
    employee?.name ||
    "Employee";

  const url =
    employee?.employeePhoto?.url ||
    employee?.photo?.url ||
    "";

  return (
    <div className={`employee-photo ${className}`}>
      {url ? (
        <img src={url} alt={name} />
      ) : (
        <span>{name.charAt(0).toUpperCase()}</span>
      )}
    </div>
  );
}

function Message({ error, success }) {
  return (
    <>
      {error && (
        <div className="message error-message">
          {error}
        </div>
      )}

      {success && (
        <div className="message success-message">
          {success}
        </div>
      )}
    </>
  );
}

function EmptyState({ children }) {
  return (
    <div className="empty-state">
      {children || "No records found"}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function PageHeader({ title, description }) {
  return (
    <header className="page-header">
      <Link to="/">
        <Logo />
      </Link>

      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>

      <Link to="/" className="secondary-button">
        Dashboard
      </Link>
    </header>
  );
}

function ManagementNavigation() {
  return (
    <nav className="management-navigation">
      <Link to="/employees">Employees</Link>
      <Link to="/weeks">Weeks</Link>
      <Link to="/targets">Targets</Link>
      <Link to="/expenses">Expenses</Link>
      <Link to="/pnl">Profit & Loss</Link>
      <Link to="/events">Events</Link>
      <Link to="/admin">Payments</Link>
      <Link to="/emergency-history">Emergency History</Link>
    </nav>
  );
}

function ManagementPage({
  title,
  description,
  children,
}) {
  return (
    <main className="management-page">
      <PageHeader
        title={title}
        description={description}
      />

      <ManagementNavigation />

      {children}
    </main>
  );
}

/* ==========================================
   MANAGEMENT ACCESS
========================================== */

function ManagementGate({ children }) {
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function verify() {
      try {
        if (!sessionStorage.getItem("jfwManagementKey")) {
          return;
        }

        await api.get(
          "/management/verify",
          managementHeaders()
        );

        if (active) setAuthorized(true);
      } catch {
        sessionStorage.removeItem("jfwManagementKey");
      } finally {
        if (active) setChecking(false);
      }
    }

    verify();

    return () => {
      active = false;
    };
  }, []);

  async function login(event) {
    event.preventDefault();

    setChecking(true);
    setError("");

    try {
      await api.get("/management/verify", {
        headers: {
          "X-Management-Key": key,
        },
      });

      sessionStorage.setItem(
        "jfwManagementKey",
        key
      );

      setAuthorized(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  }

  function logout() {
    sessionStorage.removeItem("jfwManagementKey");
    setAuthorized(false);
    setKey("");
  }

  if (authorized) {
    return (
      <>
        <div className="management-session">
          <span>Management Access</span>

          <button
            className="secondary-button"
            onClick={logout}
          >
            Lock Management
          </button>
        </div>

        {children}
      </>
    );
  }

  return (
    <div className="management-login">
      <form className="form-card" onSubmit={login}>
        <Logo />

        <h1>Management Login</h1>

        <p>Enter your management access key.</p>

        <Message error={error} />

        <input
          type="password"
          placeholder="Management key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          required
        />

        <button
          className="primary-button"
          disabled={checking}
        >
          {checking ? "Verifying..." : "Continue"}
        </button>

        <Link to="/">Back to Dashboard</Link>
      </form>
    </div>
  );
}

/* ==========================================
   REPORT FILTERS
========================================== */

function DashboardFilters({
  filters,
  setFilters,
  weeks,
}) {
  const years = [
    ...new Set([
      Number(today().slice(0, 4)) - 1,
      Number(today().slice(0, 4)),
      Number(today().slice(0, 4)) + 1,
      Number(filters.year),
      ...weeks.map((week) => week.year),
    ]),
  ].sort((a, b) => b - a);

  const selectedMonth = Number(
    filters.month.slice(5, 7)
  );

  const availableWeeks = weeks.filter(
    (week) =>
      week.year === Number(filters.year) &&
      week.month === selectedMonth
  );

  function updateYear(year) {
    setFilters((previous) => ({
      ...previous,
      year,
      month: `${year}-${previous.month.slice(5, 7)}`,
      weekId: "",
    }));
  }

  function updateMonth(month) {
    setFilters((previous) => ({
      ...previous,
      month: `${previous.year}-${month}`,
      weekId: "",
    }));
  }

  useEffect(() => {
    if (filters.duration !== "weekly") return;

    if (
      availableWeeks.some(
        (week) => week._id === filters.weekId
      )
    ) {
      return;
    }

    const currentWeek = availableWeeks.find(
      (week) =>
        dateInput(week.startDate) <= today() &&
        today() < dateInput(week.endDate)
    );

    const nextId =
      currentWeek?._id ||
      availableWeeks[0]?._id ||
      "";

    if (nextId !== filters.weekId) {
      setFilters((previous) => ({
        ...previous,
        weekId: nextId,
      }));
    }
  }, [
    filters.duration,
    filters.weekId,
    availableWeeks,
    setFilters,
  ]);

  return (
    <div className="dashboard-filters">
      <div className="filter-group">
        {["today", "weekly", "monthly", "yearly"].map(
          (duration) => (
            <button
              key={duration}
              className={`filter-button ${
                filters.duration === duration
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                setFilters((previous) => ({
                  ...previous,
                  duration,
                }))
              }
            >
              {duration.charAt(0).toUpperCase() +
                duration.slice(1)}
            </button>
          )
        )}
      </div>

      {filters.duration !== "today" && (
        <div className="month-filters">
          <select
            value={filters.year}
            onChange={(e) => updateYear(e.target.value)}
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>

          {filters.duration !== "yearly" && (
            <select
              value={filters.month.slice(5, 7)}
              onChange={(e) =>
                updateMonth(e.target.value)
              }
            >
              {MONTHS.map((month, index) => (
                <option
                  key={month}
                  value={String(index + 1).padStart(2, "0")}
                >
                  {month}
                </option>
              ))}
            </select>
          )}

          {filters.duration === "weekly" && (
            <select
              value={filters.weekId}
              onChange={(e) =>
                setFilters((previous) => ({
                  ...previous,
                  weekId: e.target.value,
                }))
              }
            >
              {!availableWeeks.length && (
                <option value="">No saved weeks</option>
              )}

              {availableWeeks.map((week) => (
                <option key={week._id} value={week._id}>
                  {week.weekName} |{" "}
                  {dateText(week.startDate)}–
                  {weekEndText(week.endDate)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

/* ==========================================
   AUTOMATIC TABLE PAGINATION
========================================== */

function usePagination(items, pageSize, rotate = true) {
  const [page, setPage] = useState(0);

  const pages = Math.max(
    1,
    Math.ceil(items.length / pageSize)
  );

  useEffect(() => {
    setPage((previous) => Math.min(previous, pages - 1));

    if (!rotate || pages <= 1) return;

    const timer = setInterval(() => {
      setPage((previous) => (previous + 1) % pages);
    }, 15000);

    return () => clearInterval(timer);
  }, [pages, rotate]);

  return {
    page,
    pages,
    items: items.slice(
      page * pageSize,
      (page + 1) * pageSize
    ),
  };
}

/* ==========================================
   EVENT REGISTRATION DASHBOARD
========================================== */

function EventRegistration() {
  const { data, error } = useData("/events/active", {
    events: ["events:changed", "event:updated"],
    interval: 30000,
  });

  const events = data || [];
  const pagination = usePagination(events, 6);

  return (
    <section className="event-registration">
      <div className="section-heading">
        {/* <h2>Event Registrations</h2> */}

        {pagination.pages > 1 && (
          <span>
            {pagination.page + 1}/{pagination.pages}
          </span>
        )}
      </div>

      <Message error={error} />

      {!events.length ? (
        <EmptyState>No active events</EmptyState>
      ) : (
        <table className="registration-table">
          <thead>
            <tr>
              {pagination.items.map((event) => (
                <th key={event._id}>
                  {event.eventCity}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            <tr>
              {pagination.items.map((event) => (
                <td key={event._id}>
                  {event.currentRegistration}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ==========================================
   SUMMARY CARDS
========================================== */

function SummaryCards({
  rows,
  mode = "performance",
  duration = "today",
}) {
  const cards =
    mode === "pnl"
      ? [
          ["Revenue", money(sum(rows, "revenue"))],
          ["Company Expenditure", money(sum(rows, "company"))],
          ["Lead Cost", money(sum(rows, "leadCost"))],
          ["Net Profit / Loss", money(sum(rows, "profit"))],
        ]
      : [
          [
            duration === "today"
              ? "Today's Revenue"
              : "Total Revenue",
            money(sum(rows, "revenue")),
          ],
          [
            "Registrations",
            sum(rows, "count"),
          ],
          ["Employees", rows.length],
          [
            "Current Targets Achieved",
            rows.filter((row) => row.targetAchieved).length,
          ],
        ];

  return (
    <div className="summary-grid">
      {cards.map(([label, value], index) => (
        <div
          key={label}
          className={`summary-card ${
            index === 3
              ? mode === "pnl" && sum(rows, "profit") < 0
                ? "negative"
                : "positive"
              : ""
          }`}
        >
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

/* ==========================================
   TARGET DISPLAY
========================================== */

function ProgressBar({ value }) {
  if (value === null || value === undefined) {
    return <span>—</span>;
  }

  return (
    <div className="achievement-cell">
      <strong>{percent(value)}</strong>

      <div className="progress-track">
        <div
          className="progress-fill"
          style={{
            width: `${Math.max(
              0,
              Math.min(100, value)
            )}%`,
            background: value >= 100 ? "#24834c" : "",
          }}
        />
      </div>
    </div>
  );
}

function AssignedTarget({ row }) {
  if (!row.targetsAssigned) return <span>—</span>;

  return (
    <div className="target-values">
      {row.amountTarget !== null && (
        <span>{money(row.amountTarget)}</span>
      )}

      {row.registrationTarget !== null && (
        <span>{row.registrationTarget} Reg.</span>
      )}

      {row.targetsAssigned === 1 &&
        row.achievementBasis === "AMOUNT" &&
        row.targetRegistrations !== null && (
          <small>{row.targetRegistrations} Reg.</small>
        )}
    </div>
  );
}

function EffectiveAchievement({ row }) {
  if (!row.targetsAssigned) return <span>—</span>;

  return (
    <div className="target-values">
      {row.amountAchieved !== null && (
        <span>{money(row.amountAchieved)}</span>
      )}

      {row.registrationAchieved !== null && (
        <span>{row.registrationAchieved} Reg.</span>
      )}

      {row.targetsAssigned === 1 &&
        row.achievementBasis === "AMOUNT" &&
        row.targetRegistrations !== null && (
          <small>{row.achievedRegistrations} Reg.</small>
        )}

      {row.targets?.some(
        (target) => target.manualOverride
      ) && (
        <small className="manual-label">
          Adjusted
        </small>
      )}
    </div>
  );
}

function Achievement({ row }) {
  return (
    <div className="target-achievement">
      {row.amountAchievement !== null && (
        <>
          {row.registrationAchievement !== null && (
            <small>Amount</small>
          )}

          <ProgressBar value={row.amountAchievement} />
        </>
      )}

      {row.registrationAchievement !== null && (
        <>
          {row.amountAchievement !== null && (
            <small>Registrations</small>
          )}

          <ProgressBar
            value={row.registrationAchievement}
          />
        </>
      )}

      {row.amountAchievement === null &&
        row.registrationAchievement === null && (
          <span>—</span>
        )}
    </div>
  );
}

/* ==========================================
   EMPLOYEE PERFORMANCE TABLE
========================================== */

function PerformanceTable({
  rows,
  mode = "performance",
  duration = "today",
  rotate = true,
}) {
  const pagination = usePagination(rows, 8, rotate);

  const visibleRows = rotate
    ? pagination.items
    : rows;

  return (
    <section className="performance-section">
      <div className="section-heading">
        <h2>
          {mode === "pnl"
            ? "Employee Profit & Loss"
            : "Employee Performance"}
        </h2>

        {rotate && pagination.pages > 1 && (
          <span>
            {pagination.page + 1}/{pagination.pages}
          </span>
        )}
      </div>

      {!rows.length ? (
        <EmptyState>No performance records</EmptyState>
      ) : (
        <div className="table-wrapper">
          <table
            className={`performance-table ${
              mode === "pnl"
                ? "pnl-table"
                : duration === "today"
                ? "daily-performance-table"
                : "target-performance-table unified-target-table"
            }`}
          >
            <thead>
              <tr>
                <th>Employee</th>
                <th>Revenue</th>

                {mode === "pnl" ? (
                  <>
                    <th>Company Expense</th>
                    <th>Leads</th>
                    <th>Lead Cost</th>
                    <th>Total Expense</th>
                    <th>Profit / Loss</th>
                  </>
                ) : (
                  <>
                    <th>Registrations</th>

                    {duration !== "today" && (
                      <>
                        <th>Assigned Target</th>
                        <th>Achievement</th>
                      </>
                    )}
                  </>
                )}
              </tr>
            </thead>

            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row._id}
                  className={
                    row.targetAchieved
                      ? "target-achieved-row"
                      : ""
                  }
                >
                  <td>
                    <div className="employee-cell">
                      <EmployeePhoto employee={row} />

                      <div className="employee-identity">
                        <strong>
                          {row.employeeName}
                        </strong>

                        <small>
                          {row.employeeCode}
                        </small>
                      </div>
                    </div>
                  </td>

                  <td>{money(row.revenue)}</td>

                  {mode === "pnl" ? (
                    <>
                      <td>{money(row.company)}</td>
                      <td>{row.leads}</td>
                      <td>{money(row.leadCost)}</td>
                      <td>{money(row.total)}</td>

                      <td>
                        <strong
                          className={
                            row.profit >= 0
                              ? "positive-text"
                              : "negative-text"
                          }
                        >
                          {money(row.profit)}
                        </strong>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{row.count}</td>

                      {duration !== "today" && (
                        <>
                          <td>
                            <AssignedTarget row={row} />
                          </td>


                          <td>
                            <Achievement row={row} />
                          </td>
                        </>
                      )}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mode === "pnl" &&
        rows.some((row) => row.estimated) && (
          <p className="report-note">
            Partial-week lead expenses are estimated.
          </p>
        )}

      {mode === "pnl" &&
        rows.some((row) => row.salaryHistoryMissing) && (
          <p className="report-note negative-text">
            Salary history is missing for some employees.
            Expenditure may be incomplete.
          </p>
        )}
    </section>
  );
}

/* ==========================================
   HOME DASHBOARD
========================================== */

function Home({
  filters,
  setFilters,
  soundEnabled,
  enableSound,
  soundError,
}) {
  const [connected, setConnected] = useState(
    socket.connected
  );

  const [clock, setClock] = useState(new Date());

  const { data: weekData } = useWeeks();

  const weeks = weekData || [];

  const enabled =
    filters.duration !== "weekly" ||
    Boolean(filters.weekId);

  const {
    data,
    error,
    loading,
  } = useData("/performance", {
    params: reportParams(filters),
    enabled,
    events: [
      "performance:changed",
      "employees:changed",
      "targets:changed",
      "weeks:changed",
    ],
    interval: 30000,
  });

  const rows = enabled ? data || [] : [];

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    const timer = setInterval(
      () => setClock(new Date()),
      1000
    );

    return () => {
      clearInterval(timer);

      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  return (
    <main className="tv-dashboard">
      <header className="dashboard-header">
        <Logo />

        <div className="dashboard-title">
          {/* <h1>Juniors Fashion Week</h1> */}
          {/* <p>Juniors Fashion Week</p> */}
        </div>

        <div className="dashboard-status">
          <strong>
            {clock.toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Kolkata",
            })}
          </strong>

          <span
            className={`live-status ${
              connected ? "connected" : "disconnected"
            }`}
          >
            {connected ? "● LIVE" : "● RECONNECTING"}
          </span>
        </div>
      </header>

      <EventRegistration />

      <DashboardFilters
        filters={filters}
        setFilters={setFilters}
        weeks={weeks}
      />

      <SummaryCards
        rows={rows}
        duration={filters.duration}
      />

      <Message error={enabled ? error : ""} />

      {!enabled ? (
        <EmptyState>
          Create or select a saved week.
        </EmptyState>
      ) : loading && !data ? (
        <EmptyState>Loading performance...</EmptyState>
      ) : (
        <PerformanceTable
          rows={rows}
          duration={filters.duration}
        />
      )}

      <footer className="dashboard-footer">
        <div className="dashboard-links">
          <Link to="/payment-entry">Payment Entry</Link>
          <Link to="/employees">Management</Link>
          <Link to="/pnl">P&L</Link>
          <Link to="/emergency">Emergency</Link>
        </div>

        {soundError && (
          <span className="sound-error">
            {soundError}
          </span>
        )}

        <button
          className="sound-button"
          onClick={enableSound}
        >
          {soundEnabled
            ? "Sound Enabled"
            : "Enable Sound"}
        </button>
      </footer>
    </main>
  );
}

/* ==========================================
   PAYMENT CELEBRATION
========================================== */

function PaymentCelebration({ payment }) {
  const employeeId =
    payment.employeeId?._id ||
    payment.employeeId;

  const { data: targetResponse } = useData(
    `/employees/${employeeId}/current-target`,
    {
      enabled: Boolean(employeeId),
      events: ["performance:changed"],
    }
  );

  const target = targetResponse?.currentTarget;

  useEffect(() => {
    const finish = Date.now() + 5000;

    const timer = setInterval(() => {
      if (Date.now() > finish) {
        clearInterval(timer);
        return;
      }

      confetti({
        particleCount: 30,
        spread: 75,
        origin: { x: 0.1, y: 0.7 },
      });

      confetti({
        particleCount: 30,
        spread: 75,
        origin: { x: 0.9, y: 0.7 },
      });
    }, 300);

    return () => {
      clearInterval(timer);
      confetti.reset();
    };
  }, [payment._id]);

  return (
    <div
      className={`celebration-screen ${
        target?.targetAchieved
          ? "target-achieved-celebration"
          : ""
      }`}
    >
      <Logo />

      <span className="celebration-eyebrow">
        PAYMENT RECEIVED
      </span>

      <h1>Congratulations!</h1>

      <EmployeePhoto
        employee={payment}
        className="celebration-photo"
      />

      <h2>
        {payment.employeeName || payment.name}
      </h2>

      <div className="celebration-amount">
        {money(payment.amountPaise)}
      </div>

      <p>Excellent work! Keep it up.</p>

      <div className="celebration-details">
        <div>
          <span>Event City</span>
          <strong>{payment.eventCity}</strong>
        </div>

        <div>
          <span>Event Registrations</span>
          <strong>{payment.registrationCount}</strong>
        </div>

        {target && (
          <div>
            <span>Weekly Achievement</span>
            <strong>{percent(target.achievement)}</strong>
          </div>
        )}
      </div>

      {target?.targetAchieved && (
        <div className="target-completed-badge">
          Weekly Target Achieved
        </div>
      )}

      <div className="celebration-timer">
        <div />
      </div>
    </div>
  );
}

/* ==========================================
   EMERGENCY DISPLAY
========================================== */

function EmergencyScreen({ emergency }) {
  return (
    <div className="emergency-screen">
      <div className="emergency-warning">
        EMERGENCY ALERT
      </div>

      <EmployeePhoto
        employee={emergency}
        className="emergency-photo"
      />

      <h1>{emergency.name}</h1>

      <p>{emergency.reason}</p>

      <strong>Immediate Attention Required</strong>

      <div className="emergency-timer">
        <div />
      </div>
    </div>
  );
}

/* ==========================================
   LIVE DISPLAY CONTROLLER
========================================== */

function Display() {
  const [filters, setFilters] = useState(initialFilters);
  const [payments, setPayments] = useState([]);
  const [emergencies, setEmergencies] = useState([]);

  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundError, setSoundError] = useState("");

  const paymentAudio = useRef(null);
  const emergencyAudio = useRef(null);

  const seenPayments = useRef(new Set());

  const dismissed = useRef(
    new Set(
      (() => {
        try {
          return JSON.parse(
            sessionStorage.getItem(
              "jfwDismissedEmergencies"
            ) || "[]"
          );
        } catch {
          return [];
        }
      })()
    )
  );

  const emergency = emergencies[0];
  const payment = payments[0];

  const activeType = emergency
    ? "emergency"
    : payment
    ? "payment"
    : null;

  const activeId =
    emergency?._id || payment?._id || null;

  const loadEmergencies = useCallback(async () => {
    try {
      const { data } = await api.get(
        "/emergencies/active"
      );

      setEmergencies(
        data.filter(
          (item) => !dismissed.current.has(item._id)
        )
      );
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let fetching = false;
    const displayStartedAt = Date.now();

    function onPayment(item) {
      if (!mounted || !item?._id) return;
      const id = String(item._id);
      if (seenPayments.current.has(id)) return;
      seenPayments.current.add(id);
      setPayments((previous) => [...previous, item]);
    }

    async function loadPayments() {
      if (fetching || !mounted) return;
      fetching = true;
      try {
        const { data } = await api.get("/payments");
        if (!mounted || !Array.isArray(data)) return;
        data.filter((item) => new Date(item.createdAt).getTime() >= displayStartedAt)
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
          .forEach(onPayment);
      } catch (error) {
        console.error("Payment sync error:", error);
      } finally {
        fetching = false;
      }
    }

    function onConnect() {
      loadPayments();
      loadEmergencies();
    }

    socket.on("payment:created", onPayment);
    socket.on("emergency:created", loadEmergencies);
    socket.on("emergency:resolved", loadEmergencies);
    socket.on("connect", onConnect);
    loadPayments();
    loadEmergencies();
    const paymentTimer = setInterval(loadPayments, 3000);
    const emergencyTimer = setInterval(loadEmergencies, 15000);

    return () => {
      mounted = false;
      clearInterval(paymentTimer);
      clearInterval(emergencyTimer);
      socket.off("payment:created", onPayment);
      socket.off("emergency:created", loadEmergencies);
      socket.off("emergency:resolved", loadEmergencies);
      socket.off("connect", onConnect);
    };
  }, [loadEmergencies]);

  async function enableSound() {
    setSoundError("");

    const audios = [
      paymentAudio.current,
      emergencyAudio.current,
    ];

    try {
      const promises = audios.map((audio) => {
        audio.muted = true;
        return audio.play();
      });

      await Promise.all(promises);

      audios.forEach((audio) => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
      });

      setSoundEnabled(true);
    } catch (error) {
      audios.forEach((audio) => {
        audio.pause();
        audio.muted = false;
      });

      setSoundError(error.message);
      setSoundEnabled(false);
    }
  }

  useEffect(() => {
    if (!activeId) return;

    const timer = setTimeout(
      () => {
        if (activeType === "emergency") {
          dismissed.current.add(activeId);

          sessionStorage.setItem(
            "jfwDismissedEmergencies",
            JSON.stringify([...dismissed.current])
          );

          setEmergencies((previous) =>
            previous.filter(
              (item) => item._id !== activeId
            )
          );
        } else {
          setPayments((previous) =>
            previous.filter(
              (item) => item._id !== activeId
            )
          );
        }
      },
      activeType === "emergency" ? 5000 : 10000
    );

    return () => clearTimeout(timer);
  }, [activeId, activeType]);

  useEffect(() => {
    const audios = [
      paymentAudio.current,
      emergencyAudio.current,
    ];

    audios.forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });

    if (soundEnabled && activeType) {
      const audio =
        activeType === "emergency"
          ? emergencyAudio.current
          : paymentAudio.current;

      audio.play().catch((error) => {
        setSoundError(error.message);
      });
    }

    return () => {
      audios.forEach((audio) => audio.pause());
    };
  }, [activeId, activeType, soundEnabled]);

  return (
    <>
      <audio
        ref={paymentAudio}
        src="/celebration.mp3"
        preload="auto"
        loop
      />

      <audio
        ref={emergencyAudio}
        src="/ambulance.mp3"
        preload="auto"
        loop
      />

      {emergency ? (
        <EmergencyScreen
          key={emergency._id}
          emergency={emergency}
        />
      ) : payment ? (
        <PaymentCelebration
          key={payment._id}
          payment={payment}
        />
      ) : (
        <Home
          filters={filters}
          setFilters={setFilters}
          soundEnabled={soundEnabled}
          enableSound={enableSound}
          soundError={soundError}
        />
      )}
    </>
  );
}

/* ==========================================
   PAYMENT ENTRY PAGE
========================================== */

function PaymentEntry() {
  const { data: employeeData } = useEmployees(false);

  const { data: eventData } = useData("/events/active", {
    events: ["events:changed", "event:updated"],
  });

  const employees = employeeData || [];
  const events = eventData || [];

  const [form, setForm] = useState({
    employeeId: "",
    eventId: "",
    amount: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selected = employees.find(
    (employee) => employee._id === form.employeeId
  );

  function update(event) {
    setForm((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }));
  }

  async function submit(event) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      await api.post("/payments", form);

      setSuccess("Payment recorded successfully.");

      setForm((previous) => ({
        ...previous,
        amount: "",
      }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="management-page">
      <PageHeader
        title="Payment Entry"
        description="Record a successful registration payment"
      />

      <form className="form-card" onSubmit={submit}>
        <Message error={error} success={success} />

        <Field label="Employee">
          <select
            name="employeeId"
            value={form.employeeId}
            onChange={update}
            required
          >
            <option value="">Select employee</option>

            {employees.map((employee) => (
              <option
                key={employee._id}
                value={employee._id}
              >
                {employee.employeeName}
              </option>
            ))}
          </select>
        </Field>

        {selected && (
          <div className="selected-employee">
            <EmployeePhoto employee={selected} />
            <strong>{selected.employeeName}</strong>
          </div>
        )}

        <Field label="Event">
          <select
            name="eventId"
            value={form.eventId}
            onChange={update}
            required
          >
            <option value="">Select event</option>

            {events.map((event) => (
              <option key={event._id} value={event._id}>
                {event.eventCity} — {event.eventName}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Payment Amount (₹)">
          <input
            type="number"
            name="amount"
            min="0.01"
            step="0.01"
            value={form.amount}
            onChange={update}
            required
          />
        </Field>

        <button
          className="primary-button"
          disabled={loading}
        >
          {loading ? "Submitting..." : "Record Payment"}
        </button>
      </form>
    </main>
  );
}

/* ==========================================
   EMPLOYEE LIST
========================================== */

function EmployeeList() {
  const { data, refresh, error } = useEmployees();

  const { data: performanceData } = useData(
    "/performance",
    {
      events: ["performance:changed"],
    }
  );

  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState("");

  const employees = (data || []).filter((employee) =>
    `${employee.employeeName} ${employee.employeeCode}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const achievedIds = new Set(
    (performanceData || [])
      .filter((row) => row.targetAchieved)
      .map((row) => row._id)
  );

  async function remove(employee) {
    if (
      !window.confirm(
        `Delete ${employee.employeeName}? Historical payments will be retained.`
      )
    ) {
      return;
    }

    try {
      await api.delete(
        `/employees/${employee._id}`,
        managementHeaders()
      );

      refresh();
    } catch (err) {
      setActionError(errorText(err));
    }
  }

  return (
    <ManagementPage
      title="Employees"
      description="Manage employee profiles and performance"
    >
      <Message error={error || actionError} />

      <div className="page-toolbar">
        <input
          placeholder="Search employees..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <Link
          to="/employees/create"
          className="primary-button"
        >
          + Add Employee
        </Link>
      </div>

      <div className="employee-grid">
        {employees.map((employee) => (
          <article
            key={employee._id}
            className={`employee-card ${
              achievedIds.has(employee._id)
                ? "target-achieved-profile"
                : ""
            }`}
          >
            <EmployeePhoto employee={employee} />

            <h3>{employee.employeeName}</h3>

            <p>{employee.employeeCode}</p>
            <p>{employee.designation}</p>

            <span
              className={`status ${
                employee.isActive
                  ? "active-status"
                  : "inactive-status"
              }`}
            >
              {employee.isActive ? "Active" : "Inactive"}
            </span>

            <div className="card-actions">
              <Link
                className="secondary-button"
                to={`/employees/${employee._id}`}
              >
                View
              </Link>

              <Link
                className="secondary-button"
                to={`/employees/${employee._id}/edit`}
              >
                Edit
              </Link>

              <button
                className="danger-button"
                onClick={() => remove(employee)}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      {!employees.length && (
        <EmptyState>No employees found</EmptyState>
      )}
    </ManagementPage>
  );
}

/* ==========================================
   EMPLOYEE CREATE / EDIT
========================================== */

function EmployeeForm() {
  const { id } = useParams();
  const navigate = useNavigate();

  const editing = Boolean(id);

  const { data, error: fetchError, loading: fetching } =
    useData(`/employees/${id}`, {
      protectedRoute: true,
      enabled: editing,
    });

  const [form, setForm] = useState({
    employeeName: "",
    employeeCode: "",
    employeeEmail: "",
    employeeMobile: "",
    designation: "Sales Executive",
    department: "Sales",
    monthlySalary: "",
    joiningDate: today(),
    effectiveFrom: today(),
    leavingDate: "",
    salaryRemarks: "",
    isActive: true,
  });

  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!data) return;

    setForm({
      employeeName: data.employeeName || "",
      employeeCode: data.employeeCode || "",
      employeeEmail: data.employeeEmail || "",
      employeeMobile: data.employeeMobile || "",
      designation: data.designation || "",
      department: data.department || "",

      monthlySalary:
        data.monthlySalary ??
        (
          data.monthlySalaryPaise != null
            ? data.monthlySalaryPaise / 100
            : ""
        ),

      joiningDate: dateInput(data.joiningDate),
      effectiveFrom: today(),
      leavingDate: dateInput(data.leavingDate),
      salaryRemarks: "",
      isActive: data.isActive,
    });
  }, [data]);

  useEffect(() => {
    if (!photo) {
      setPreview(data?.employeePhoto?.url || "");
      return;
    }

    const url = URL.createObjectURL(photo);

    setPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [photo, data]);

  function update(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: name === "isActive"
        ? value === "true"
        : value,
    }));
  }

  async function submit(event) {
    event.preventDefault();

    setLoading(true);
    setError("");

    try {
      const payload = new FormData();

      Object.entries(form).forEach(([key, value]) => {
        if (
          editing &&
          key === "monthlySalary" &&
          Number(value) === Number(data?.monthlySalary)
        ) {
          return;
        }

        payload.append(key, String(value));
      });

      if (photo) payload.append("photo", photo);

      if (editing) {
        await api.patch(
          `/employees/${id}`,
          payload,
          managementHeaders()
        );
      } else {
        await api.post(
          "/employees",
          payload,
          managementHeaders()
        );
      }

      navigate("/employees");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ManagementPage
      title={editing ? "Edit Employee" : "Add Employee"}
      description="Employee details and salary information"
    >
      <form
        className="form-card wide-form"
        onSubmit={submit}
      >
        <Message error={error || fetchError} />

        <div className="profile-upload">
          <EmployeePhoto
            employee={{
              employeeName: form.employeeName,
              employeePhoto: { url: preview },
            }}
          />

          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) =>
              setPhoto(e.target.files?.[0] || null)
            }
            required={!editing}
          />
        </div>

        <div className="form-grid">
          {[
            ["employeeName", "Full Name", "text", true],
            ["employeeCode", "Employee Code", "text", true],
            ["employeeEmail", "Email", "email", true],
            ["employeeMobile", "Mobile", "tel", false],
            ["designation", "Designation", "text", true],
            ["department", "Department", "text", true],
          ].map(([name, label, type, required]) => (
            <Field key={name} label={label}>
              <input
                name={name}
                type={type}
                value={form[name]}
                onChange={update}
                required={required}
              />
            </Field>
          ))}

          <Field label="Monthly Salary (₹)">
            <input
              type="number"
              name="monthlySalary"
              value={form.monthlySalary}
              onChange={update}
              min="0"
              step="0.01"
              required
            />
          </Field>

          <Field label="Joining Date">
            <input
              type="date"
              name="joiningDate"
              value={form.joiningDate}
              onChange={update}
              disabled={editing}
              required
            />
          </Field>

          {editing && (
            <>
              <Field label="Salary Effective From">
                <input
                  type="date"
                  name="effectiveFrom"
                  value={form.effectiveFrom}
                  onChange={update}
                  max={today()}
                />
              </Field>

              <Field label="Salary Remarks">
                <input
                  name="salaryRemarks"
                  value={form.salaryRemarks}
                  onChange={update}
                />
              </Field>

              <Field label="Employment Status">
                <select
                  name="isActive"
                  value={String(form.isActive)}
                  onChange={update}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </Field>

              {!form.isActive && (
                <Field label="Leaving Date">
                  <input
                    type="date"
                    name="leavingDate"
                    value={form.leavingDate}
                    onChange={update}
                    required
                  />
                </Field>
              )}
            </>
          )}
        </div>

        <div className="card-actions">
          <button
            className="primary-button"
            disabled={loading || (editing && (!data || fetching))}
          >
            {loading
              ? "Saving..."
              : editing
              ? "Update Employee"
              : "Create Employee"}
          </button>

          <Link
            to="/employees"
            className="secondary-button"
          >
            Cancel
          </Link>
        </div>
      </form>
    </ManagementPage>
  );
}

/* ==========================================
   EMPLOYEE PROFILE
========================================== */

function EmployeeProfile() {
  const { id } = useParams();

  const [filters, setFilters] = useState(initialFilters);

  const { data: employee, error } = useData(
    `/employees/${id}`,
    {
      protectedRoute: true,
      events: ["employees:changed"],
    }
  );

  const { data: weeks } = useWeeks();

  const enabled =
    filters.duration !== "weekly" ||
    Boolean(filters.weekId);

  const { data: report, error: reportError } = useData(
    "/performance",
    {
      params: reportParams(filters, id),
      enabled,
      events: ["performance:changed"],
    }
  );

  const { data: dailyData } = useData(
    "/performance/daily",
    {
      params: reportParams(filters, id),
      enabled,
      events: ["performance:changed"],
    }
  );

  const { data: payments } = useData("/payments", {
    params: { employeeId: id },
    events: ["payment:created"],
  });

  const rows = enabled ? report || [] : [];
  const days = enabled ? (Array.isArray(dailyData) ? dailyData : dailyData?.days || []) : [];

  const completed = rows.some(
    (row) => row.targetAchieved
  );

  return (
    <ManagementPage
      title="Employee Profile"
      description="Employee details, salary and performance"
    >
      <Message error={error || reportError} />

      {employee && (
        <>
          <section
            className={`profile-header ${
              completed
                ? "target-achieved-profile"
                : ""
            }`}
          >
            <EmployeePhoto employee={employee} />

            <div>
              <h2>{employee.employeeName}</h2>
              <p>
                {employee.employeeCode} ·{" "}
                {employee.designation}
              </p>

              <p>{employee.employeeEmail}</p>

              <strong>
                Monthly Salary:{" "}
                {money(employee.monthlySalaryPaise)}
              </strong>
            </div>

            <Link
              to={`/employees/${id}/edit`}
              className="primary-button"
            >
              Edit Profile
            </Link>
          </section>

          <DashboardFilters
            filters={filters}
            setFilters={setFilters}
            weeks={weeks || []}
          />

          <SummaryCards
            rows={rows}
            duration={filters.duration}
          />

          <PerformanceTable
            rows={rows}
            duration={filters.duration}
            rotate={false}
          />

          <section className="management-card">
            <h2>Day-wise Performance</h2>

            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Revenue</th>
                    <th>Registrations</th>
                  </tr>
                </thead>

                <tbody>
                  {days.map((item) => (
                    <tr
                      key={item.date}
                      className={
                        item.targetAchieved
                          ? "target-achieved-row"
                          : ""
                      }
                    >
                      <td>{dateText(item.date)}</td>
                      <td>{money(item.revenue)}</td>
                      <td>{item.count}</td>
                    </tr>
                  ))}
                </tbody>

                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th>{money(sum(days, "revenue"))}</th>
                    <th>{sum(days, "count")}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="management-card">
            <h2>Salary History</h2>

            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Effective Date</th>
                    <th>Monthly Salary</th>
                    <th>Remarks</th>
                  </tr>
                </thead>

                <tbody>
                  {(employee.salaryHistory || []).map(
                    (salary) => (
                      <tr key={salary._id}>
                        <td>
                          {dateText(salary.effectiveFrom)}
                        </td>

                        <td>
                          {money(salary.monthlySalaryPaise)}
                        </td>

                        <td>{salary.remarks || "—"}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="management-card">
            <h2>Recent Payments</h2>

            <PaymentTable
              payments={(payments || []).slice(0, 20)}
            />
          </section>
        </>
      )}
    </ManagementPage>
  );
}

/* ==========================================
   WEEK MANAGEMENT
========================================== */

function emptyWeek() {
  return {
    year: today().slice(0, 4),
    month: String(Number(today().slice(5, 7))),
    weekNumber: "1",
    weekName: "Week 1",
    startDate: "",
    endDate: "",
  };
}

function WeekManagement() {
  const { data, refresh, error: fetchError } = useWeeks();

  const [form, setForm] = useState(emptyWeek);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [filterYear, setFilterYear] = useState(
    today().slice(0, 4)
  );

  const [filterMonth, setFilterMonth] = useState("");

  const weeks = data || [];

  const filtered = weeks.filter(
    (week) =>
      (!filterYear || week.year === Number(filterYear)) &&
      (!filterMonth || week.month === Number(filterMonth))
  );

  function update(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,

      ...(name === "weekNumber"
        ? { weekName: `Week ${value}` }
        : {}),

      ...(
        name === "year" || name === "month"
          ? { startDate: "", endDate: "" }
          : {}
      ),
    }));
  }

  const minDate =
    `${form.year}-${String(form.month).padStart(2, "0")}-01`;

  const lastDay = new Date(
    Number(form.year),
    Number(form.month),
    0
  ).getDate();

  const maxDate =
    `${form.year}-${String(form.month).padStart(2, "0")}-${lastDay}`;

  function reset() {
    setForm(emptyWeek());
    setEditingId(null);
  }

  function edit(week) {
    setEditingId(week._id);

    setForm({
      year: String(week.year),
      month: String(week.month),
      weekNumber: String(week.weekNumber),
      weekName: week.weekName,
      startDate: dateInput(week.startDate),
      endDate: weekEndInput(week.endDate),
    });

    setError("");
    setSuccess("");

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      if (editingId) {
        await api.patch(
          `/weeks/${editingId}`,
          form,
          managementHeaders()
        );
      } else {
        await api.post(
          "/weeks",
          form,
          managementHeaders()
        );
      }

      setSuccess(
        editingId ? "Week updated." : "Week created."
      );

      reset();
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  async function remove(week) {
    if (!window.confirm(`Delete ${week.weekName}?`)) {
      return;
    }

    try {
      await api.delete(
        `/weeks/${week._id}`,
        managementHeaders()
      );

      refresh();
      setSuccess("Week deleted.");
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <ManagementPage
      title="Week Management"
      description="Create custom reporting and target periods"
    >
      <form
        className="form-card wide-form"
        onSubmit={submit}
      >
        <h2>{editingId ? "Edit Week" : "Create Week"}</h2>

        <Message
          error={error || fetchError}
          success={success}
        />

        <div className="form-grid">
          <Field label="Year">
            <input
              type="number"
              name="year"
              min="2000"
              max="2100"
              value={form.year}
              onChange={update}
              required
            />
          </Field>

          <Field label="Month">
            <select
              name="month"
              value={form.month}
              onChange={update}
            >
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Week Number">
            <input
              type="number"
              name="weekNumber"
              min="1"
              max="31"
              value={form.weekNumber}
              onChange={update}
              required
            />
          </Field>

          <Field label="Week Name">
            <input
              name="weekName"
              value={form.weekName}
              onChange={update}
              required
            />
          </Field>

          <Field label="Start Date">
            <input
              type="date"
              name="startDate"
              min={minDate}
              max={maxDate}
              value={form.startDate}
              onChange={update}
              required
            />
          </Field>

          <Field label="End Date">
            <input
              type="date"
              name="endDate"
              min={form.startDate || minDate}
              max={maxDate}
              value={form.endDate}
              onChange={update}
              required
            />
          </Field>
        </div>

        <div className="card-actions">
          <button
            className="primary-button"
            disabled={loading}
          >
            {loading
              ? "Saving..."
              : editingId
              ? "Update Week"
              : "Create Week"}
          </button>

          {editingId && (
            <button
              type="button"
              className="secondary-button"
              onClick={reset}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <section className="management-card">
        <h2>Saved Weeks</h2>

        <div className="page-toolbar">
          <input
            type="number"
            placeholder="Year"
            value={filterYear}
            onChange={(e) => setFilterYear(e.target.value)}
          />

          <select
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
          >
            <option value="">All Months</option>

            {MONTHS.map((month, index) => (
              <option key={month} value={index + 1}>
                {month}
              </option>
            ))}
          </select>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Month</th>
                <th>Week</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((week) => (
                <tr key={week._id}>
                  <td>{week.year}</td>
                  <td>{MONTHS[week.month - 1]}</td>
                  <td>{week.weekName}</td>
                  <td>{dateText(week.startDate)}</td>
                  <td>{weekEndText(week.endDate)}</td>

                  <td>
                    <div className="card-actions">
                      <button
                        className="secondary-button"
                        onClick={() => edit(week)}
                      >
                        Edit
                      </button>

                      <button
                        className="danger-button"
                        onClick={() => remove(week)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!filtered.length && (
          <EmptyState>No saved weeks</EmptyState>
        )}
      </section>
    </ManagementPage>
  );
}

/* ==========================================
   TARGET MANAGEMENT
========================================== */

function emptyTarget() {
  return {
    employeeId: "",
    weekId: "",
    achievementBasis: "REGISTRATION",
    targetAmount: "",
    targetRegistrations: "",
    manualEnabled: false,
    achievedAmount: "",
    achievedRegistrations: "",
    amountChanged: false,
    registrationChanged: false,
    reason: "",
    remarks: "",
  };
}

function TargetManagement() {
  const { data: employeeData } = useEmployees(false);
  const { data: weekData } = useWeeks();

  const [year, setYear] = useState(today().slice(0, 4));
  const [month, setMonth] = useState(today().slice(5, 7));

  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterWeek, setFilterWeek] = useState("");

  const {
    data: targetData,
    refresh,
    error: fetchError,
  } = useData("/targets", {
    protectedRoute: true,

    params: {
      ...(filterEmployee
        ? { employeeId: filterEmployee }
        : {}),

      ...(filterWeek
        ? { weekId: filterWeek }
        : {}),
    },

    events: [
      "targets:changed",
      "performance:changed",
    ],
  });

  const employees = employeeData || [];
  const weeks = weekData || [];
  const targets = targetData || [];

  const [form, setForm] = useState(emptyTarget);
  const [editingId, setEditingId] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const availableWeeks = weeks.filter(
    (week) =>
      week.year === Number(year) &&
      week.month === Number(month)
  );

  const selectedWeek = weeks.find(
    (week) => week._id === form.weekId
  );

  const registrationBased =
    form.achievementBasis === "REGISTRATION";

  function update(event) {
    const { name, value, checked, type } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: type === "checkbox" ? checked : value,
      ...(name === "achievedAmount" ? { amountChanged: true, manualEnabled: true } : {}),
      ...(name === "achievedRegistrations" ? { registrationChanged: true, manualEnabled: true } : {}),

      ...(name === "achievementBasis"
        ? {
            targetAmount:
              value === "REGISTRATION"
                ? ""
                : previous.targetAmount,


          }
        : {}),
    }));
  }

  function reset() {
    setForm(emptyTarget());
    setEditingId(null);
  }

  function edit(target) {
    const weekId =
      target.weekId?._id || target.weekId || "";

    const week = weeks.find(
      (item) => item._id === weekId
    );

    if (week) {
      setYear(String(week.year));
      setMonth(String(week.month).padStart(2, "0"));
    }

    setEditingId(target._id);

    setForm({
      employeeId:
        target.employeeId?._id || target.employeeId,

      weekId,

      achievementBasis:
        target.achievementBasis || "AMOUNT",

      targetAmount:
        target.targetAmountPaise == null
          ? ""
          : target.targetAmountPaise / 100,

      targetRegistrations:
        target.targetRegistrations ?? "",

      manualEnabled:
        Boolean(target.manualAchievement?.enabled),

      achievedAmount: target.performance?.achievedAmount != null ? target.performance.achievedAmount / 100 : "",
      achievedRegistrations: target.performance?.achievedRegistrations ?? "",
      amountChanged: false,
      registrationChanged: false,

      reason: target.manualAchievement?.reason || "",
      remarks: target.remarks || "",
    });

    setError("");
    setSuccess("");

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setSuccess("");

    const payload = {
      employeeId: form.employeeId,
      weekId: form.weekId,

      achievementBasis: form.achievementBasis,

      targetRegistrations:
        form.targetRegistrations === ""
          ? null
          : Number(form.targetRegistrations),

      remarks: form.remarks,

      manualAchievement: {
        enabled: form.manualEnabled,
      },
    };

    if (!registrationBased) {
      payload.targetAmount = Number(form.targetAmount);
    }

    if (form.manualEnabled) {
      payload.manualAchievement.reason = form.reason.trim() || "Manual target achievement adjustment";

      payload.manualAchievement.amountChanged = !editingId || form.amountChanged;
      payload.manualAchievement.registrationChanged = !editingId || form.registrationChanged;
      if (form.achievedAmount !== "" && (!editingId || form.amountChanged)) {
        payload.manualAchievement.achievedAmount = Number(form.achievedAmount);
      }

      if (form.achievedRegistrations !== "" && (!editingId || form.registrationChanged)) {
        payload.manualAchievement.achievedRegistrations =
          Number(form.achievedRegistrations);
      }
    }

    try {
      if (editingId) {
        await api.patch(
          `/targets/${editingId}`,
          payload,
          managementHeaders()
        );
      } else {
        await api.post(
          "/targets",
          payload,
          managementHeaders()
        );
      }

      setSuccess(
        editingId ? "Target updated." : "Target assigned."
      );

      reset();
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  async function remove(target) {
    if (
      !window.confirm(
        "Delete this target? Actual payment records will not be affected."
      )
    ) {
      return;
    }

    try {
      await api.delete(
        `/targets/${target._id}`,
        managementHeaders()
      );

      if (editingId === target._id) reset();

      refresh();
      setSuccess("Target deleted.");
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function resetAchievement(target) {
    if (
      !window.confirm(
        "Restore automatic achievement calculation?"
      )
    ) {
      return;
    }

    try {
      await api.patch(
        `/targets/${target._id}/reset-achievement`,
        {},
        managementHeaders()
      );

      if (editingId === target._id) reset();

      refresh();
      setSuccess("Automatic achievement restored.");
    } catch (err) {
      setError(errorText(err));
    }
  }

  const manualTarget = Number(
    registrationBased
      ? form.targetRegistrations
      : form.targetAmount
  );

  const manualAchieved = Number(
    registrationBased
      ? form.achievedRegistrations
      : form.achievedAmount
  );

  const previewAchievement =
    manualTarget > 0
      ? (manualAchieved / manualTarget) * 100
      : null;

  return (
    <ManagementPage
      title="Weekly Targets"
      description="Assign goals and manage employee achievement"
    >
      <form
        className="form-card wide-form"
        onSubmit={submit}
      >
        <h2>
          {editingId ? "Edit Target" : "Assign Weekly Target"}
        </h2>

        <Message
          error={error || fetchError}
          success={success}
        />

        <div className="form-grid">
          <Field label="Employee">
            <select
              name="employeeId"
              value={form.employeeId}
              onChange={update}
              disabled={Boolean(editingId)}
              required
            >
              <option value="">Select employee</option>

              {employees.map((employee) => (
                <option
                  key={employee._id}
                  value={employee._id}
                >
                  {employee.employeeName}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Year">
            <input
              type="number"
              min="2000"
              max="2100"
              value={year}
              disabled={Boolean(editingId)}
              onChange={(e) => {
                setYear(e.target.value);

                setForm((previous) => ({
                  ...previous,
                  weekId: "",
                }));
              }}
              required
            />
          </Field>

          <Field label="Month">
            <select
              value={month}
              disabled={Boolean(editingId)}
              onChange={(e) => {
                setMonth(e.target.value);

                setForm((previous) => ({
                  ...previous,
                  weekId: "",
                }));
              }}
            >
              {MONTHS.map((name, index) => (
                <option
                  key={name}
                  value={String(index + 1).padStart(2, "0")}
                >
                  {name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Saved Week">
            <select
              name="weekId"
              value={form.weekId}
              onChange={update}
              disabled={Boolean(editingId)}
              required={!editingId}
            >
              <option value="">Select saved week</option>

              {availableWeeks.map((week) => (
                <option key={week._id} value={week._id}>
                  {week.weekName} |{" "}
                  {dateText(week.startDate)} –{" "}
                  {weekEndText(week.endDate)}
                </option>
              ))}
            </select>

            {!availableWeeks.length && !editingId && (
              <Link to="/weeks">Create a week first</Link>
            )}
          </Field>

          <Field label="Achievement Calculation">
            <select
              name="achievementBasis"
              value={form.achievementBasis}
              onChange={update}
            >
              <option value="REGISTRATION">
                Based on Registrations
              </option>

              <option value="AMOUNT">
                Based on Revenue Amount
              </option>
            </select>
          </Field>

          {!registrationBased && (
            <Field label="Target Amount (₹)">
              <input
                type="number"
                name="targetAmount"
                value={form.targetAmount}
                onChange={update}
                min="0.01"
                step="0.01"
                required
              />
            </Field>
          )}

          <Field
            label={
              registrationBased
                ? "Target Registrations"
                : "Target Registrations (Optional)"
            }
          >
            <input
              type="number"
              name="targetRegistrations"
              value={form.targetRegistrations}
              onChange={update}
              min={registrationBased ? 1 : 0}
              step="1"
              required={registrationBased}
            />
          </Field>
        </div>

        {selectedWeek && (
          <div className="selected-week-info">
            Target Period:{" "}
            {dateText(selectedWeek.startDate)} –{" "}
            {weekEndText(selectedWeek.endDate)}
          </div>
        )}

        <h2>Achieved Performance — Edit Manually</h2>
        <div className="form-grid">
          <Field label="Achieved Amount (₹)">
            <input type="number" name="achievedAmount"
              value={form.achievedAmount} onChange={update}
              min="0" step="0.01" placeholder="Automatic from payments" />
            <small>New payments within this week add to this amount.</small>
          </Field>
          <Field label="Achieved Registrations">
            <input type="number" name="achievedRegistrations"
              value={form.achievedRegistrations} onChange={update}
              min="0" step="1" placeholder="Automatic from payments" />
            <small>Each new payment within this week adds one registration.</small>
          </Field>
        </div>

        <section className="manual-achievement-section">
          <label className="checkbox-field">
            <input
              type="checkbox"
              name="manualEnabled"
              checked={form.manualEnabled}
              onChange={update}
            />

            <div>
              <strong>Manual Achievement Override</strong>

              <p>
                Set achieved values. Future payments automatically increase both values without changing historical payment records.
              </p>
            </div>
          </label>

          <>
              {form.manualEnabled && <Field label="Reason for Manual Override">
                <textarea
                  name="reason"
                  value={form.reason}
                  onChange={update}
                  placeholder="Optional adjustment note"
                />
              </Field>}

              <div
                className={`achievement-preview ${
                  previewAchievement >= 100
                    ? "target-achieved-profile"
                    : ""
                }`}
              >
                <span>Effective Achievement</span>

                <ProgressBar value={previewAchievement} />
              </div>
            </>
        </section>

        <Field label="Remarks">
          <textarea
            name="remarks"
            value={form.remarks}
            onChange={update}
          />
        </Field>

        <div className="card-actions">
          <button
            className="primary-button"
            disabled={loading}
          >
            {loading
              ? "Saving..."
              : editingId
              ? "Update Target"
              : "Assign Target"}
          </button>

          {editingId && (
            <button
              type="button"
              className="secondary-button"
              onClick={reset}
            >
              Cancel Editing
            </button>
          )}
        </div>
      </form>

      <section className="management-card">
        <h2>Assigned Targets</h2>

        <div className="page-toolbar">
          <select
            value={filterEmployee}
            onChange={(e) =>
              setFilterEmployee(e.target.value)
            }
          >
            <option value="">All Employees</option>

            {employees.map((employee) => (
              <option
                key={employee._id}
                value={employee._id}
              >
                {employee.employeeName}
              </option>
            ))}
          </select>

          <select
            value={filterWeek}
            onChange={(e) =>
              setFilterWeek(e.target.value)
            }
          >
            <option value="">All Weeks</option>

            {weeks.map((week) => (
              <option key={week._id} value={week._id}>
                {week.year} · {MONTHS[week.month - 1]} ·{" "}
                {week.weekName}
              </option>
            ))}
          </select>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Week</th>
                <th>Calculation</th>
                <th>Assigned Target</th>
                <th>System Achieved</th>
                <th>Effective Achieved</th>
                <th>Achievement</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {targets.map((target) => {
                const performance = target.performance;

                const registration =
                  target.achievementBasis === "REGISTRATION";

                return (
                  <tr
                    key={target._id}
                    className={
                      performance?.targetAchieved
                        ? "target-achieved-row"
                        : ""
                    }
                  >
                    <td>
                      {target.employeeId?.employeeName || "—"}
                    </td>

                    <td>
                      <strong>
                        {target.weekId?.weekName || "Legacy Target"}
                      </strong>

                      <small>
                        {dateText(performance?.startDate)} –{" "}
                        {weekEndText(performance?.endDate)}
                      </small>
                    </td>

                    <td>
                      {registration
                        ? "Registrations"
                        : "Amount"}
                    </td>

                    <td>
                      {registration
                        ? `${target.targetRegistrations} Reg.`
                        : money(target.targetAmountPaise)}
                    </td>

                    <td>
                      {registration
                        ? performance?.systemRegistrations ?? 0
                        : money(performance?.systemAmount)}
                    </td>

                    <td>
                      <div>{money(performance?.achievedAmount)}</div>
                      <div>{performance?.achievedRegistrations ?? 0} Reg.</div>

                      {performance?.manualOverride && (
                        <small className="manual-label">
                          Manual Override
                        </small>
                      )}
                    </td>

                    <td>
                      <ProgressBar
                        value={performance?.achievement}
                      />
                    </td>

                    <td>
                      <div className="target-actions">
                        <button
                          className="secondary-button"
                          onClick={() => edit(target)}
                        >
                          Edit
                        </button>

                        {performance?.manualOverride && (
                          <button
                            className="secondary-button"
                            onClick={() =>
                              resetAchievement(target)
                            }
                          >
                            Reset
                          </button>
                        )}

                        <button
                          className="danger-button"
                          onClick={() => remove(target)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!targets.length && (
          <EmptyState>No assigned targets</EmptyState>
        )}
      </section>
    </ManagementPage>
  );
}

/* ==========================================
   WEEKLY EXPENSE MANAGEMENT
========================================== */

function emptyExpense() {
  return {
    employeeId: "",
    weekId: "",
    leadCount: "",
    leadCost: "",
    miscellaneousExpenses: [],
    remarks: "",
  };
}

function ExpenseManagement() {
  const { data: employees } = useEmployees();
  const { data: weeks } = useWeeks();

  const {
    data: expenses,
    refresh,
    error: fetchError,
  } = useData("/expenses", {
    protectedRoute: true,
    events: ["expenses:changed"],
  });

  const [form, setForm] = useState(emptyExpense);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedWeek = (weeks || []).find(
    (week) => week._id === form.weekId
  );

  function update(event) {
    setForm((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }));
  }

  function addExpense() {
    setForm((previous) => ({
      ...previous,

      miscellaneousExpenses: [
        ...previous.miscellaneousExpenses,
        {
          expenseName: "",
          amount: "",
          expenseDate: dateInput(selectedWeek?.startDate) || today(),
          remarks: "",
        },
      ],
    }));
  }

  function updateExpense(index, name, value) {
    setForm((previous) => ({
      ...previous,

      miscellaneousExpenses:
        previous.miscellaneousExpenses.map(
          (item, itemIndex) =>
            index === itemIndex
              ? { ...item, [name]: value }
              : item
        ),
    }));
  }

  function removeExpense(index) {
    setForm((previous) => ({
      ...previous,

      miscellaneousExpenses:
        previous.miscellaneousExpenses.filter(
          (_, itemIndex) => itemIndex !== index
        ),
    }));
  }

  function edit(expense) {
    setForm({
      employeeId:
        expense.employeeId?._id || expense.employeeId,

      weekId: expense.weekId?._id || expense.weekId || "",

      leadCount: expense.leadCount,
      leadCost: expense.leadCostPaise / 100,

      miscellaneousExpenses:
        (expense.miscellaneousExpenses || []).map(
          (item) => ({
            expenseName: item.expenseName,
            amount: item.amountPaise / 100,
            expenseDate: dateInput(item.expenseDate),
            remarks: item.remarks || "",
          })
        ),

      remarks: expense.remarks || "",
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event) {
    event.preventDefault();

    const existing = (expenses || []).find(
      (expense) =>
        (expense.employeeId?._id || expense.employeeId) ===
          form.employeeId &&
        (expense.weekId?._id || expense.weekId) ===
          form.weekId
    );

    if (
      existing &&
      !window.confirm("Replace the saved weekly expenses?")
    ) {
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      await api.post(
        "/expenses",
        form,
        managementHeaders()
      );

      setSuccess("Weekly expenses saved successfully.");
      setForm(emptyExpense());
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  const miscTotal = sum(
    form.miscellaneousExpenses,
    "amount"
  );

  return (
    <ManagementPage
      title="Weekly Expenses"
      description="Manage lead costs and company expenditure"
    >
      <form
        className="form-card wide-form"
        onSubmit={submit}
      >
        <Message
          error={error || fetchError}
          success={success}
        />

        <div className="form-grid">
          <Field label="Employee">
            <select
              name="employeeId"
              value={form.employeeId}
              onChange={update}
              required
            >
              <option value="">Select employee</option>

              {(employees || []).map((employee) => (
                <option
                  key={employee._id}
                  value={employee._id}
                >
                  {employee.employeeName}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Saved Week">
            <select
              name="weekId"
              value={form.weekId}
              onChange={update}
              required
            >
              <option value="">Select week</option>

              {(weeks || []).map((week) => (
                <option key={week._id} value={week._id}>
                  {week.year} · {MONTHS[week.month - 1]} ·{" "}
                  {week.weekName} | {dateText(week.startDate)} – {weekEndText(week.endDate)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Number of Leads">
            <input
              type="number"
              name="leadCount"
              value={form.leadCount}
              onChange={update}
              min="0"
              step="1"
              required
            />
          </Field>

          <Field label="Total Lead Cost (₹)">
            <input
              type="number"
              name="leadCost"
              value={form.leadCost}
              onChange={update}
              min="0"
              step="0.01"
              required
            />
          </Field>
        </div>

        <div className="section-heading">
          <h2>Miscellaneous Expenses</h2>

          <button
            type="button"
            className="secondary-button"
            onClick={addExpense}
            disabled={!selectedWeek}
          >
            + Add Expense
          </button>
        </div>

        {form.miscellaneousExpenses.map((item, index) => (
          <div className="misc-expense-row" key={index}>
            <input
              placeholder="Expense name"
              value={item.expenseName}
              onChange={(e) =>
                updateExpense(index, "expenseName", e.target.value)
              }
              required
            />

            <input
              type="number"
              placeholder="Amount"
              min="0"
              step="0.01"
              value={item.amount}
              onChange={(e) =>
                updateExpense(index, "amount", e.target.value)
              }
              required
            />

            <input
              type="date"
              min={dateInput(selectedWeek?.startDate)}
              max={weekEndInput(selectedWeek?.endDate)}
              value={item.expenseDate}
              onChange={(e) =>
                updateExpense(index, "expenseDate", e.target.value)
              }
              required
            />

            <input
              placeholder="Remarks"
              value={item.remarks}
              onChange={(e) =>
                updateExpense(index, "remarks", e.target.value)
              }
            />

            <button
              type="button"
              className="danger-button"
              onClick={() => removeExpense(index)}
            >
              Remove
            </button>
          </div>
        ))}

        <div className="expense-summary">
          <span>
            Miscellaneous: {money(miscTotal * 100)}
          </span>

          <strong>
            Total excluding salary:{" "}
            {money(
              (Number(form.leadCost || 0) + miscTotal) * 100
            )}
          </strong>
        </div>

        <Field label="Remarks">
          <textarea
            name="remarks"
            value={form.remarks}
            onChange={update}
          />
        </Field>

        <button
          className="primary-button"
          disabled={loading}
        >
          {loading ? "Saving..." : "Save Expenses"}
        </button>
      </form>

      <section className="management-card">
        <h2>Saved Expenses</h2>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Month</th>
                <th>Week</th>
                <th>Leads</th>
                <th>Lead Cost</th>
                <th>Miscellaneous</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {(expenses || []).map((expense) => (
                <tr key={expense._id}>
                  <td>{expense.employeeId?.employeeName}</td>
                  <td>{expense.month}</td>
                  <td>
                    {expense.weekId?.weekName ||
                      `Week ${expense.weekNumber}`}
                  </td>
                  <td>{expense.leadCount}</td>
                  <td>{money(expense.leadCostPaise)}</td>
                  <td>
                    {money(
                      sum(
                        expense.miscellaneousExpenses || [],
                        "amountPaise"
                      )
                    )}
                  </td>

                  <td>
                    <button
                      className="secondary-button"
                      onClick={() => edit(expense)}
                      disabled={expense.isFinalized}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </ManagementPage>
  );
}

/* ==========================================
   PROFIT AND LOSS REPORT
========================================== */

function ProfitLossReport() {
  const [filters, setFilters] = useState(initialFilters);

  const { data: weeks } = useWeeks();

  const enabled =
    filters.duration !== "weekly" ||
    Boolean(filters.weekId);

  const { data, error, loading } = useData("/pnl", {
    protectedRoute: true,
    params: reportParams(filters),
    enabled,
    events: ["performance:changed", "expenses:changed"],
  });

  const monthly = filters.duration === "monthly";
  const yearly = filters.duration === "yearly";

  const { data: breakdown } = useData(
    monthly
      ? "/pnl/monthly-breakdown"
      : "/pnl/yearly-breakdown",
    {
      protectedRoute: true,
      enabled: monthly || yearly,

      params: monthly
        ? { month: filters.month }
        : { year: filters.year },

      events: ["performance:changed"],
    }
  );

  const rows = enabled ? data || [] : [];

  const breakdownRows = monthly
    ? breakdown?.weeks || []
    : breakdown?.months || [];

  return (
    <ManagementPage
      title="Profit & Loss"
      description="Actual revenue and employee-related expenditure"
    >
      <DashboardFilters
        filters={filters}
        setFilters={setFilters}
        weeks={weeks || []}
      />

      <Message error={enabled ? error : ""} />

      <SummaryCards rows={rows} mode="pnl" />

      {!enabled ? (
        <EmptyState>Select a saved week</EmptyState>
      ) : loading && !data ? (
        <EmptyState>Loading financial report...</EmptyState>
      ) : (
        <PerformanceTable
          rows={rows}
          mode="pnl"
          rotate={false}
        />
      )}

      {(monthly || yearly) && (
        <section className="management-card">
          <h2>
            {monthly
              ? "Week-wise Financial Summary"
              : "Month-wise Financial Summary"}
          </h2>

          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Revenue</th>
                  <th>Company Expense</th>
                  <th>Lead Cost</th>
                  <th>Total Expense</th>
                  <th>Profit / Loss</th>
                </tr>
              </thead>

              <tbody>
                {breakdownRows.map((period) => {
                  const employees = period.employees || [];
                  const profit = sum(employees, "profit");

                  return (
                    <tr
                      key={
                        period.weekId ||
                        period.month
                      }
                    >
                      <td>
                        {monthly
                          ? period.weekName
                          : MONTHS[
                              Number(period.month.slice(5)) - 1
                            ]}
                      </td>

                      <td>{money(sum(employees, "revenue"))}</td>
                      <td>{money(sum(employees, "company"))}</td>
                      <td>{money(sum(employees, "leadCost"))}</td>
                      <td>{money(sum(employees, "total"))}</td>

                      <td
                        className={
                          profit >= 0
                            ? "positive-text"
                            : "negative-text"
                        }
                      >
                        {money(profit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="report-note">
        Manual target achievement adjustments do not affect
        actual financial revenue or expenditure.
      </p>
    </ManagementPage>
  );
}

/* ==========================================
   EVENT MANAGEMENT
========================================== */

function emptyEvent() {
  return {
    eventName: "",
    eventCity: "",
    eventDate: "",
    currentRegistration: 0,
    isActive: true,
  };
}

function EventManagement() {
  const { data, refresh } = useData("/events", {
    events: ["events:changed", "event:updated"],
  });

  const [form, setForm] = useState(emptyEvent);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function update(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]:
        name === "isActive"
          ? value === "true"
          : value,
    }));
  }

  function edit(event) {
    setEditingId(event._id);

    setForm({
      eventName: event.eventName,
      eventCity: event.eventCity,
      eventDate: dateInput(event.eventDate),
      currentRegistration: event.currentRegistration,
      isActive: event.isActive,
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setEditingId(null);
    setForm(emptyEvent());
  }

  async function submit(event) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ...form,
        currentRegistration: Number(form.currentRegistration),
      };

      if (editingId) {
        await api.patch(
          `/events/${editingId}`,
          payload,
          managementHeaders()
        );
      } else {
        await api.post(
          "/events",
          payload,
          managementHeaders()
        );
      }

      setSuccess("Event saved successfully.");
      reset();
      refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ManagementPage
      title="Event Management"
      description="Manage event cities and registration counts"
    >
      <form
        className="form-card wide-form"
        onSubmit={submit}
      >
        <h2>{editingId ? "Edit Event" : "Create Event"}</h2>

        <Message error={error} success={success} />

        <div className="form-grid">
          <Field label="Event Name">
            <input
              name="eventName"
              value={form.eventName}
              onChange={update}
              required
            />
          </Field>

          <Field label="City">
            <input
              name="eventCity"
              value={form.eventCity}
              onChange={update}
              required
            />
          </Field>

          <Field label="Event Date">
            <input
              type="date"
              name="eventDate"
              value={form.eventDate}
              onChange={update}
              required
            />
          </Field>

          <Field label="Current Registrations">
            <input
              type="number"
              name="currentRegistration"
              value={form.currentRegistration}
              onChange={update}
              min="0"
              step="1"
              required
            />
          </Field>

          <Field label="Event Status">
            <select
              name="isActive"
              value={String(form.isActive)}
              onChange={update}
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </Field>
        </div>

        <div className="card-actions">
          <button
            className="primary-button"
            disabled={loading}
          >
            {loading ? "Saving..." : "Save Event"}
          </button>

          {editingId && (
            <button
              type="button"
              className="secondary-button"
              onClick={reset}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <section className="management-card">
        <h2>All Events</h2>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>City</th>
                <th>Date</th>
                <th>Registrations</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {(data || []).map((event) => (
                <tr key={event._id}>
                  <td>{event.eventName}</td>
                  <td>{event.eventCity}</td>
                  <td>{dateText(event.eventDate)}</td>
                  <td>{event.currentRegistration}</td>
                  <td>
                    {event.isActive ? "Active" : "Inactive"}
                  </td>

                  <td>
                    <button
                      className="secondary-button"
                      onClick={() => edit(event)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </ManagementPage>
  );
}

/* ==========================================
   PAYMENT HISTORY
========================================== */

function PaymentTable({ payments }) {
  return (
    <div className="table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>City</th>
            <th>Amount</th>
            <th>Registration Count</th>
            <th>Date</th>
          </tr>
        </thead>

        <tbody>
          {payments.map((payment) => (
            <tr key={payment._id}>
              <td>
                <div className="employee-cell">
                  <EmployeePhoto employee={payment} />

                  <strong>
                    {payment.employeeName || payment.name}
                  </strong>
                </div>
              </td>

              <td>{payment.eventCity}</td>
              <td>{money(payment.amountPaise)}</td>
              <td>{payment.registrationCount}</td>
              <td>{dateText(payment.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {!payments.length && (
        <EmptyState>No payment records</EmptyState>
      )}
    </div>
  );
}

function PaymentHistory() {
  const { data, error } = useData("/payments", {
    events: ["payment:created"],
  });

  const [search, setSearch] = useState("");

  const payments = (data || []).filter((payment) =>
    `${payment.employeeName || payment.name} ${payment.eventCity}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <ManagementPage
      title="Payment History"
      description="View recorded employee payments"
    >
      <Message error={error} />

      <div className="page-toolbar">
        <input
          placeholder="Search employee or city..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <Link
          to="/payment-entry"
          className="primary-button"
        >
          + Payment Entry
        </Link>
      </div>

      <section className="management-card">
        <PaymentTable payments={payments} />
      </section>
    </ManagementPage>
  );
}

/* ==========================================
   EMERGENCY ENTRY
========================================== */

function EmergencyEntry() {
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [photo, setPhoto] = useState(null);
  const [consent, setConsent] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event) {
    event.preventDefault();

    if (!photo || !consent) {
      setError("Photo and consent are required.");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const payload = new FormData();

      payload.append("name", name);
      payload.append("reason", reason);
      payload.append("photo", photo);

      await api.post("/emergencies", payload);

      setSuccess("Emergency alert sent successfully.");

      setName("");
      setReason("");
      setPhoto(null);
      setConsent(false);

      event.target.reset();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="management-page emergency-page">
      <PageHeader
        title="Emergency Alert"
        description="Send an immediate alert to the live display"
      />

      <form className="form-card" onSubmit={submit}>
        <Message error={error} success={success} />

        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>

        <Field label="Emergency Reason">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            required
          />
        </Field>

        <Field label="Upload Photo">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) =>
              setPhoto(e.target.files?.[0] || null)
            }
            required
          />
        </Field>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            required
          />

          I consent to displaying this information on
          the emergency screen.
        </label>

        <button
          className="danger-button"
          disabled={loading}
        >
          {loading ? "Sending..." : "Send Emergency Alert"}
        </button>
      </form>
    </main>
  );
}

/* ==========================================
   EMERGENCY HISTORY
========================================== */

function EmergencyHistory() {
  const { data, refresh, error } = useData("/emergencies", {
    events: ["emergency:created", "emergency:resolved"],
  });

  const [actionError, setActionError] = useState("");

  async function resolve(id) {
    try {
      await api.patch(
        `/emergencies/${id}/resolve`,
        {},
        managementHeaders()
      );

      refresh();
    } catch (err) {
      setActionError(errorText(err));
    }
  }

  return (
    <ManagementPage
      title="Emergency History"
      description="View and resolve emergency alerts"
    >
      <Message error={error || actionError} />

      <section className="management-card">
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Photo</th>
                <th>Name</th>
                <th>Reason</th>
                <th>Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {(data || []).map((item) => (
                <tr key={item._id}>
                  <td>
                    <EmployeePhoto
                      employee={item}
                      className="history-photo"
                    />
                  </td>

                  <td>{item.name}</td>
                  <td>{item.reason}</td>
                  <td>{dateText(item.createdAt)}</td>
                  <td>{item.status}</td>

                  <td>
                    {item.status === "Active" && (
                      <button
                        className="primary-button"
                        onClick={() => resolve(item._id)}
                      >
                        Resolve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </ManagementPage>
  );
}

/* ==========================================
   SCROLL TO TOP
========================================== */

function ScrollToTop() {
  const { pathname } = useLocationSafe();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function useLocationSafe() {
  // BrowserRouter navigation changes are handled
  // by the route component below.
  return useRouterLocation();
}

import { useLocation as useRouterLocation } from "react-router-dom";

/* ==========================================
   APPLICATION ROUTES
========================================== */

function Protected({ children }) {
  return (
    <ManagementGate>
      {children}
    </ManagementGate>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />

      <Routes>
        {/* Public Pages */}

        <Route path="/" element={<Display />} />

        <Route
          path="/payment-entry"
          element={<PaymentEntry />}
        />

        <Route
          path="/emergency"
          element={<EmergencyEntry />}
        />

        {/* Management Pages */}

        <Route
          path="/employees"
          element={
            <Protected>
              <EmployeeList />
            </Protected>
          }
        />

        <Route
          path="/employees/create"
          element={
            <Protected>
              <EmployeeForm key="create" />
            </Protected>
          }
        />

        <Route
          path="/employees/:id"
          element={
            <Protected>
              <EmployeeProfile />
            </Protected>
          }
        />

        <Route
          path="/employees/:id/edit"
          element={
            <Protected>
              <EmployeeForm key="edit" />
            </Protected>
          }
        />

        <Route
          path="/weeks"
          element={
            <Protected>
              <WeekManagement />
            </Protected>
          }
        />

        <Route
          path="/targets"
          element={
            <Protected>
              <TargetManagement />
            </Protected>
          }
        />

        <Route
          path="/expenses"
          element={
            <Protected>
              <ExpenseManagement />
            </Protected>
          }
        />

        <Route
          path="/pnl"
          element={
            <Protected>
              <ProfitLossReport />
            </Protected>
          }
        />

        <Route
          path="/events"
          element={
            <Protected>
              <EventManagement />
            </Protected>
          }
        />

        <Route
          path="/eventsss"
          element={
            <Protected>
              <EventManagement />
            </Protected>
          }
        />

        <Route
          path="/admin"
          element={
            <Protected>
              <PaymentHistory />
            </Protected>
          }
        />

        <Route
          path="/emergency-history"
          element={
            <Protected>
              <EmergencyHistory />
            </Protected>
          }
        />

        <Route
          path="*"
          element={
            <div className="empty-state">
              <h1>Page Not Found</h1>
              <Link to="/">Return to Dashboard</Link>
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

/* ==========================================
   RENDER APPLICATION
========================================== */

ReactDOM.createRoot(
  document.getElementById("root")
).render(<App />);
