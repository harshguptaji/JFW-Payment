import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import axios from "axios";
import { io } from "socket.io-client";
import confetti from "canvas-confetti";
import "./style.css";
const base = import.meta.env.VITE_API_URL || "http://localhost:5000";
const money = (p) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(p / 100);
function Logo() {
  return <img className="logo" src="/logo.svg" alt="Juniors Fashion Week" />;
}
const api = axios.create({ baseURL: base });
const dateText = (d) =>
  d
    ? new Date(d).toISOString().slice(0, 10).split("-").reverse().join("/")
    : "—";
function useEvents(active = true) {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      seq = 0;
    async function load() {
      const n = ++seq;
      try {
        const { data } = await api.get(
          active ? "/api/events/active" : "/api/events",
        );
        if (alive && n === seq) {
          setEvents(data);
          setError("");
        }
      } catch (e) {
        if (alive && n === seq) setError("Unable to load events");
      }
    }
    const socket = io(base);
    socket.on("connect", load);
    socket.on("event:updated", load);
    socket.on("events:changed", load);
    load();
    const timer = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
      socket.disconnect();
    };
  }, [active]);
  return { events, error };
}
function Home() {
  const { events, error } = useEvents();
  return (
    <section className="home">
      <Logo />
      <h1>Live Event Registrations</h1>
      {events.length > 0 && (
        <div className="live-table-wrapper">
          <table className="live-table horizontal-table">
            <thead>
              <tr>
                {events.map((e) => (
                  <th key={e._id}>{e.eventCity}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {events.map((e) => (
                  <td className="count" key={e._id}>
                    {e.currentRegistration}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {error || (!events.length ? "No active events yet" : "")}
      {/* <p className="live-label">● LIVE REGISTRATION TRACKER</p> */}
    </section>
  );
}
function useEmergencies(active = true) {
  const [rows, setRows] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      seq = 0;
    async function load() {
      const n = ++seq;
      try {
        const { data } = await api.get(
          "/api/emergencies" + (active ? "/active" : ""),
        );
        if (alive && n === seq) {
          setRows(data);
          setError("");
        }
      } catch (e) {
        if (alive && n === seq) setError("Unable to load emergency alerts");
      }
    }
    const socket = io(base);
    ["connect", "emergency:created", "emergency:resolved"].forEach((k) =>
      socket.on(k, load),
    );
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
      socket.disconnect();
    };
  }, [active]);
  return { rows, error };
}
function EmergencyScreen({ alert, total }) {
  return (
    <section className="emergency-screen" role="alert">
      <Logo />
      <h1>⚠ EMERGENCY ALERT ⚠</h1>
      <div className="emergency-details">
        <img src={alert.photo?.url} alt="Emergency profile" />
        <div>
          <h2>{alert.name}</h2>
          <p>{alert.reason}</p>
        </div>
      </div>
      <strong>IMMEDIATE ATTENTION REQUIRED</strong>
      <p>
        {total > 1
          ? `${total} active alerts · showing oldest first`
          : "Contact on-site emergency staff"}
      </p>
    </section>
  );
}
function EmergencyEntry() {
  const [busy, setBusy] = useState(false),
    [msg, setMsg] = useState(""),
    [photo, setPhoto] = useState(null),
    [preview, setPreview] = useState("");
  useEffect(() => {
    if (!photo) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!window.confirm("Send emergency alert to all connected displays?"))
      return;
    setBusy(true);
    setMsg("");
    try {
      await api.post("/api/emergencies", new FormData(form));
      form.reset();
      setPhoto(null);
      setMsg("Alert saved. Confirm staff received it.");
    } catch (err) {
      setMsg(
        err.response?.data?.message ||
          "Unable to confirm alert. Contact staff directly.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="desk">
      <Logo />
      <nav>
        <Link to="/payment-entry">Payment entry</Link>
        <Link to="/emergency-history">Emergency history</Link>
        <Link to="/">Live display</Link>
      </nav>
      <form onSubmit={submit}>
        <h1 className="emergency-title">Emergency Alert</h1>
        <p>For immediate danger, contact emergency services directly.</p>
        <label>
          Name
          <input name="name" required maxLength={120} />
        </label>
        <label>
          Reason
          <textarea name="reason" required maxLength={500} rows={4} />
        </label>
        <label>
          Photo
          <input
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            onChange={(e) => setPhoto(e.target.files[0])}
          />
        </label>
        {preview && <img className="preview" src={preview} alt="Preview" />}
        <label className="consent">
          <input type="checkbox" required /> I confirm this alert is necessary
          and the information is appropriate for the shared display.
        </label>
        <button className="emergency-button" disabled={busy}>
          {busy ? "Sending…" : "Send Emergency Alert"}
        </button>
        <p role="status">{msg}</p>
      </form>
    </main>
  );
}
function EmergencyHistory() {
  const { rows, error } = useEmergencies(false);
  const [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  async function resolve(id) {
    if (!window.confirm("Resolve this emergency alert?")) return;
    setBusy(true);
    try {
      await api.patch("/api/emergencies/" + id + "/resolve");
      setMsg("Alert resolved");
    } catch (e) {
      setMsg(e.response?.data?.message || "Unable to resolve");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="desk history">
      <Logo />
      <nav>
        <Link to="/emergency">New emergency</Link>
        <Link to="/payment-entry">Payment entry</Link>
      </nav>
      <h1>Emergency history</h1>
      <p role="status">{msg || error}</p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Reason</th>
              <th>Status</th>
              <th>Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id}>
                <td>{r.name}</td>
                <td>{r.reason}</td>
                <td>{r.status}</td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td>
                  {r.status === "Active" && (
                    <button disabled={busy} onClick={() => resolve(r._id)}>
                      Resolve
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
function Display() {
  const [status, setStatus] = useState("Connecting");
  const [queue, setQueue] = useState([]);
  const [amount, setAmount] = useState(0);
  const { rows: alerts, error: alertError } = useEmergencies();
  const [dismissedAlerts, setDismissedAlerts] = useState([]);
  const alert = alerts.find((a) => !dismissedAlerts.includes(a._id));
  const alertId = alert ? alert._id : null;
  useEffect(() => {
    if (!alertId) return;
    const timer = setTimeout(() => {
      setDismissedAlerts((prev) => [...prev, alertId]);
    }, 5000);
    return () => clearTimeout(timer);
  }, [alertId]);
  const current = alert ? null : queue[0];
  const audioRef = useRef(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  async function enableSound() {
    try {
      const audio = audioRef.current;
      audio.src = alert ? "/ambulance.wav" : "/celebration.wav";
      audio.volume = 0.55;
      await Promise.resolve(audio.play());
      audio.pause();
      audio.currentTime = 0;
      setSoundEnabled(true);
    } catch (e) {
      setSoundEnabled(false);
    }
  }
  useEffect(() => {
    if ((!current && !alert) || !soundEnabled) return;
    const audio = audioRef.current;
    audio.src = alert ? "/ambulance.wav" : "/celebration.wav";
    audio.loop = !!alert;
    audio.volume = 0.55;
    Promise.resolve(audio.play()).catch(() => setSoundEnabled(false));
    return () => {
      audio.pause();
      audio.currentTime = 0;
      audio.loop = false;
    };
  }, [current, alert ? alert._id : null, soundEnabled]);
  useEffect(() => {
    const socket = io(base);
    socket.on("connect", () => setStatus("Connected"));
    socket.on("disconnect", () => setStatus("Disconnected"));
    socket.on("connect_error", (e) => setStatus(e.message));
    socket.on("payment:created", (p) =>
      setQueue((q) => (q.some((x) => x._id === p._id) ? q : [...q, p])),
    );
    return () => socket.disconnect();
  }, []);
  useEffect(() => {
    if (!current) return;
    let frame;
    const start = performance.now();
    const animate = (now) => {
      const p = Math.min((now - start) / 1200, 1);
      setAmount(Math.round(current.amountPaise * (1 - (1 - p) ** 3)));
      if (p < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    const colors = ["#bd8a81", "#e8b9b4", "#d4ad6c"];
    confetti({ particleCount: 150, spread: 100, origin: { y: 0.55 }, colors });
    const burst = setInterval(
      () =>
        confetti({
          particleCount: 45,
          spread: 100,
          origin: { x: Math.random(), y: 0.25 },
          colors,
        }),
      1400,
    );
    const end = setTimeout(() => setQueue((q) => q.slice(1)), 10000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(burst);
      clearTimeout(end);
      confetti.reset();
    };
  }, [current]);
  return (
    <main
      className="display"
      onDoubleClick={() =>
        document.fullscreenElement
          ? document.exitFullscreen()
          : document.documentElement.requestFullscreen?.()?.catch(() => {})
      }>
      <audio ref={audioRef} preload="auto" />
      {alert ? (
        <EmergencyScreen
          alert={alert}
          total={alerts.filter((a) => !dismissedAlerts.includes(a._id)).length}
        />
      ) : current ? (
        <section className="celebration" key={current._id}>
          <Logo />
          <div className="eyebrow">✦ LET'S CELEBRATE ✦</div>
          <h1>Hurray! Congratulations!</h1>
          <div className="details">
            <img
              className="portrait"
              src={current.photo.url}
              alt="Payment profile"
            />
            <div>
              <h2>{current.name}</h2>
              <p className="reg">
                {current.eventCity || current.registrationNumber}
              </p>
              <div className="amount">{money(amount)}</div>
              <div className="received">✓ PAYMENT RECEIVED</div>
              {current.registrationCount != null && (
                <p className="registration-result">
                  Current registrations:{" "}
                  <strong>{current.registrationCount}</strong>
                </p>
              )}
            </div>
          </div>
          <div className="rule" />
          <p className="message">
            Another milestone. Another reason to celebrate!
          </p>
          <div className="progress" />
        </section>
      ) : (
        <Home />
      )}
      {!soundEnabled && (
        <button className="enable-sound" onClick={enableSound}>
          Enable alert & celebration sound
        </button>
      )}
      {alertError && <small className="alert-error">{alertError}</small>}
      {status !== "Connected" && (
        <small className="connection">
          {status} · reconnecting if available
        </small>
      )}
    </main>
  );
}
function Entry() {
  const { events, error } = useEvents();
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!photo) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setMessage("");
    try {
      await axios.post(base + "/api/payments", new FormData(form));
      form.reset();
      setPhoto(null);
      setMessage("Payment recorded and celebration sent!");
    } catch (err) {
      setMessage(
        err.response?.data?.message ||
          "Submission failed. Check payment history before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="desk">
      <Logo />
      <nav>
        <Link to="/admin">Payment history</Link>
        <Link to="/emergency">Emergency alert</Link>
        <Link to="/emergency-history">Emergency history</Link>
        <Link to="/" target="_blank">
          Open live display
        </Link>
      </nav>
      <form onSubmit={submit}>
        <div className="eyebrow">JFW PAYMENT DESK</div>
        <h1>Celebrate a new payment.</h1>
        <label>
          Full name
          <input name="name" required maxLength={120} />
        </label>
        <label>
          Event city
          <select name="eventId" required defaultValue="">
            <option value="" disabled>
              Select event city
            </option>
            {events.map((e) => (
              <option key={e._id} value={e._id}>
                {e.eventCity} — {e.eventName} — {dateText(e.eventDate)}
              </option>
            ))}
          </select>
        </label>
        {error && <p>{error}</p>}
        <label>
          Amount (₹)
          <input name="amount" type="number" min="0.01" step="0.01" required />
        </label>
        <label>
          Profile picture
          <input
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            onChange={(e) => setPhoto(e.target.files[0])}
          />
        </label>
        {preview && (
          <img className="preview" src={preview} alt="Photo preview" />
        )}
        <label className="consent">
          <input type="checkbox" required /> I confirm payment was received and
          the person (or guardian) has agreed to this display.
        </label>
        <button disabled={busy || !events.length}>
          {busy ? "Submitting…" : "Submit & celebrate ✦"}
        </button>
        <p role="status">{message}</p>
      </form>
    </main>
  );
}
function Admin() {
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState("");
  async function load(e) {
    e?.preventDefault();
    try {
      const { data } = await axios.get(base + "/api/payments");
      setRows(data);
      setMsg(`${data.length} recent payments`);
    } catch (e) {
      setMsg(e.response?.data?.message || "Unable to load");
    }
  }
  useEffect(() => {
    load();
  }, []);
  return (
    <main className="desk history">
      <Logo />
      <Link to="/payment-entry">Payment entry</Link>
      <form onSubmit={load}>
        <h1>Payment history</h1>
        <button>Load payments</button>
        <p>{msg}</p>
      </form>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Event city / old registration</th>
              <th>Registration count</th>
              <th>Amount</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p._id}>
                <td>{p.name}</td>
                <td>{p.eventCity || p.registrationNumber || "—"}</td>
                <td>{p.registrationCount ?? "—"}</td>
                <td>{money(p.amountPaise)}</td>
                <td>{new Date(p.createdAt).toLocaleString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
function Events() {
  const { events, error } = useEvents(false);
  const empty = {
    eventName: "",
    eventCity: "",
    eventDate: "",
    currentRegistration: 0,
    isActive: true,
  };
  const [form, setForm] = useState(empty);
  const [id, setId] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [changeCount, setChangeCount] = useState(false);
  function edit(e) {
    setId(e._id);
    setForm({ ...e, eventDate: e.eventDate.slice(0, 10) });
    setChangeCount(false);
    setMsg("");
  }
  function reset() {
    setId(null);
    setForm(empty);
    setChangeCount(false);
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { eventName, eventCity, eventDate, currentRegistration, isActive } =
        form;
      const data = { eventName, eventCity, eventDate, isActive };
      if (!id || changeCount)
        data.currentRegistration = Number(currentRegistration);
      if (id) await api.patch("/api/events/" + id, data);
      else await api.post("/api/events", data);
      reset();
      setMsg("Event saved successfully");
    } catch (err) {
      setMsg(err.response?.data?.message || "Unable to save event");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="desk history">
      <Logo />
      <nav>
        <Link to="/payment-entry">Payment entry</Link>
        <Link to="/admin">Payment history</Link>
        <Link to="/">Live display</Link>
      </nav>
      <form onSubmit={save}>
        <h1>{id ? "Edit event" : "Create event"}</h1>
        {[
          ["eventName", "Event name", "text"],
          ["eventCity", "City", "text"],
          ["eventDate", "Event date", "date"],
        ].map(([k, label, type]) => (
          <label key={k}>
            {label}
            <input
              required
              type={type}
              value={form[k]}
              onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
            />
          </label>
        ))}
        {id && (
          <label className="consent">
            <input
              type="checkbox"
              checked={changeCount}
              onChange={(e) => setChangeCount(e.target.checked)}
            />{" "}
            Override current registration count (may replace recent increments)
          </label>
        )}
        {(!id || changeCount) && (
          <label>
            Current registrations
            <input
              type="number"
              min="0"
              step="1"
              required
              value={form.currentRegistration}
              onChange={(e) =>
                setForm((f) => ({ ...f, currentRegistration: e.target.value }))
              }
            />
          </label>
        )}
        <label className="consent">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) =>
              setForm((f) => ({ ...f, isActive: e.target.checked }))
            }
          />{" "}
          Active event
        </label>
        <button disabled={busy}>{busy ? "Saving…" : "Save event"}</button>
        {id && (
          <button type="button" onClick={reset}>
            Cancel edit
          </button>
        )}
        <p>{msg || error}</p>
      </form>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>City</th>
              <th>Date</th>
              <th>Registrations</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e._id}>
                <td>{e.eventName}</td>
                <td>{e.eventCity}</td>
                <td>{dateText(e.eventDate)}</td>
                <td>{e.currentRegistration}</td>
                <td>{e.isActive ? "Active" : "Inactive"}</td>
                <td>
                  <button onClick={() => edit(e)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Display />} />
      <Route path="/payment-entry" element={<Entry />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/events" element={<Events />} />
      <Route path="/emergency" element={<EmergencyEntry />} />
      <Route path="/emergency-history" element={<EmergencyHistory />} />
    </Routes>
  </BrowserRouter>,
);
