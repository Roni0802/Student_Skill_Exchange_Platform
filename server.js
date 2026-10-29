const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/student_skill_exchange_clean";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const skillSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  category: { type: String, required: true },
  description: { type: String, default: "" },
  teachBy: { type: String, required: true, trim: true },
  wantsToLearn: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordSalt: { type: String, required: true },
  passwordHash: { type: String, required: true },
  department: { type: String, default: "" },
  year: { type: String, default: "1st year" },
  bio: { type: String, default: "" }
});
const requestSchema = new mongoose.Schema({
  skillTitle: { type: String, required: true },
  studentName: { type: String, required: true },
  requestedBy: { type: String, required: true },
  status: { type: String, enum: ["Pending", "Accepted", "Declined"], default: "Pending" },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);
const Skill = mongoose.model("Skill", skillSchema);
const ExchangeRequest = mongoose.model("ExchangeRequest", requestSchema);

let dbConnected = false;
let memorySkills = [];
let memoryRequests = [];
let memoryUsers = [];
let memoryMessages = [];
let memorySessions = [];
const readNotificationsByUser = new Map();
const activeTokens = new Map();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}
function publicUser(user) {
  return { id: String(user._id || user.id), name: user.name, email: user.email, department: user.department || "", year: user.year || "1st year", bio: user.bio || "" };
}
async function findUserByEmail(email) {
  return dbConnected ? User.findOne({ email }).exec() : memoryUsers.find(u => u.email === email) || null;
}
async function findUserById(id) {
  if (dbConnected) { try { return await User.findById(id).exec(); } catch { return null; } }
  return memoryUsers.find(u => String(u._id) === String(id)) || null;
}
function issueToken(user) {
  const token = crypto.randomBytes(32).toString("hex");
  activeTokens.set(token, String(user._id || user.id));
  return token;
}
async function authenticatedUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const id = activeTokens.get(token);
  return id ? await findUserById(id) : null;
}

function safeText(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, database: dbConnected ? "MongoDB connected" : "In-memory demo mode" });
});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const name = safeText(req.body.name, 60);
    const email = safeText(req.body.email, 120).toLowerCase();
    const password = String(req.body.password || "");
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
      return res.status(400).json({ error: "Enter your name, a valid college email, and a password with at least 8 characters." });
    }
    if (await findUserByEmail(email)) return res.status(409).json({ error: "An account with this email already exists. Please log in." });
    const salt = crypto.randomBytes(16).toString("hex");
    const data = { name, email, passwordSalt: salt, passwordHash: hashPassword(password, salt), department: safeText(req.body.department, 100), year: safeText(req.body.year, 30) || "1st year", bio: "" };
    const user = dbConnected ? await User.create(data) : { ...data, _id: crypto.randomBytes(12).toString("hex") };
    if (!dbConnected) memoryUsers.push(user);
    const token = issueToken(user);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err) { next(err); }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = safeText(req.body.email, 120).toLowerCase();
    const password = String(req.body.password || "");
    const user = await findUserByEmail(email);
    if (!user || hashPassword(password, user.passwordSalt) !== user.passwordHash) return res.status(401).json({ error: "Email or password is incorrect. Register first if you do not have an account." });
    const token = issueToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) { next(err); }
});

app.get("/api/auth/me", async (req, res) => {
  const user = await authenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Please log in again." });
  res.json({ user: publicUser(user) });
});

app.put("/api/profile", async (req, res, next) => {
  try {
    const user = await authenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Please log in again." });
    const updates = { name: safeText(req.body.name, 60), department: safeText(req.body.department, 100), year: safeText(req.body.year, 30), bio: safeText(req.body.bio, 400) };
    if (!updates.name) return res.status(400).json({ error: "Name is required." });
    if (dbConnected) { Object.assign(user, updates); await user.save(); }
    else Object.assign(user, updates);
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

app.post("/api/auth/logout", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  activeTokens.delete(token);
  res.json({ ok: true });
});


app.get("/api/skills", async (req, res, next) => {
  try {
    const currentUser = await authenticatedUser(req);
    if (!currentUser) return res.status(401).json({ error: "Please register or log in to view student skills." });
    const q = safeText(req.query.q, 80).toLowerCase();
    const category = safeText(req.query.category, 40);
    if (dbConnected) {
      const filter = {};
      if (category && category !== "all") filter.category = category;
      if (q) filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { teachBy: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } }
      ];
      return res.json(await Skill.find(filter).sort({ createdAt: -1 }).lean());
    }
    const result = memorySkills.filter(s =>
      (!category || category === "all" || s.category === category) &&
      (!q || `${s.title} ${s.teachBy} ${s.description} ${s.category}`.toLowerCase().includes(q))
    );
    res.json(result);
  } catch (err) { next(err); }
});

app.post("/api/skills", async (req, res, next) => {
  try {
    const currentUser = await authenticatedUser(req);
    if (!currentUser) return res.status(401).json({ error: "Please register or log in before offering a skill." });
    const title = safeText(req.body.title, 80);
    const category = safeText(req.body.category, 40);
    const teachBy = currentUser.name;
    if (!title || !category || !teachBy) {
      return res.status(400).json({ error: "Skill title, category and student name are required." });
    }
    const data = {
      title, category, teachBy,
      description: safeText(req.body.description, 500),
      wantsToLearn: safeText(req.body.wantsToLearn, 120)
    };
    const saved = dbConnected ? await Skill.create(data) : { _id: `s${Date.now()}`, ...data };
    if (!dbConnected) memorySkills.unshift(saved);
    res.status(201).json(saved);
  } catch (err) { next(err); }
});

app.get("/api/requests", async (req, res, next) => {
  try {
    const currentUser = await authenticatedUser(req);
    if (!currentUser) return res.status(401).json({ error: "Please log in to view exchange requests." });
    const data = dbConnected
      ? await ExchangeRequest.find({ $or: [{ requestedBy: currentUser.name }, { studentName: currentUser.name }] }).sort({ createdAt: -1 }).lean()
      : memoryRequests.filter(r => r.requestedBy === currentUser.name || r.studentName === currentUser.name);
    res.json(data);
  } catch (err) { next(err); }
});

app.post("/api/requests", async (req, res, next) => {
  try {
    const currentUser = await authenticatedUser(req);
    if (!currentUser) return res.status(401).json({ error: "Please log in before requesting an exchange." });
    const skillTitle = safeText(req.body.skillTitle, 80);
    const studentName = safeText(req.body.studentName, 80);
    const requestedBy = currentUser.name;
    if (!skillTitle || !studentName || !requestedBy) {
      return res.status(400).json({ error: "Skill, student and requester names are required." });
    }
    const duplicate = dbConnected
      ? await ExchangeRequest.findOne({ skillTitle, requestedBy, status: { $ne: "Declined" } })
      : memoryRequests.find(r => r.skillTitle === skillTitle && r.requestedBy === requestedBy && r.status !== "Declined");
    if (duplicate) return res.status(409).json({ error: "You already have an active request for this skill." });
    const data = { skillTitle, studentName, requestedBy, status: "Pending" };
    const saved = dbConnected ? await ExchangeRequest.create(data) : { _id: `r${Date.now()}`, ...data };
    if (!dbConnected) memoryRequests.unshift(saved);
    res.status(201).json(saved);
  } catch (err) { next(err); }
});

app.patch("/api/requests/:id", async (req, res, next) => {
  try {
    const status = safeText(req.body.status, 20);
    if (!["Pending", "Accepted", "Declined"].includes(status)) {
      return res.status(400).json({ error: "Status must be Pending, Accepted or Declined." });
    }
    let updated;
    if (dbConnected) {
      updated = await ExchangeRequest.findByIdAndUpdate(req.params.id, { status }, { new: true, runValidators: true });
    } else {
      const item = memoryRequests.find(r => r._id === req.params.id);
      if (item) item.status = status;
      updated = item;
    }
    if (!updated) return res.status(404).json({ error: "Request not found." });
    res.json(updated);
  } catch (err) { next(err); }
});


// Peer messages and learning sessions are scoped to students who have an exchange request.
app.get("/api/messages", async (req, res) => {
  const user = await authenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Please log in again." });
  const data = memoryMessages.filter(m => m.from === user.name || m.to === user.name);
  res.json(data);
});
app.post("/api/messages", async (req, res) => {
  const user = await authenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Please log in again." });
  const to = safeText(req.body.to, 60), body = safeText(req.body.body, 1000);
  if (!to || !body) return res.status(400).json({ error: "Choose a student and enter a message." });
  const related = dbConnected
    ? await ExchangeRequest.findOne({ $or: [{ requestedBy: user.name, studentName: to }, { requestedBy: to, studentName: user.name }] })
    : memoryRequests.find(r => (r.requestedBy === user.name && r.studentName === to) || (r.requestedBy === to && r.studentName === user.name));
  if (!related) return res.status(403).json({ error: "You can message a student after sending or receiving an exchange request." });
  const msg = { _id: `m${Date.now()}${Math.random().toString(16).slice(2,6)}`, from: user.name, to, body, createdAt: new Date().toISOString() };
  memoryMessages.push(msg); res.status(201).json(msg);
});
app.get("/api/sessions", async (req, res) => {
  const user = await authenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Please log in again." });
  res.json(memorySessions.filter(x => x.organizer === user.name || x.partner === user.name));
});
app.post("/api/sessions", async (req, res) => {
  const user = await authenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Please log in again." });
  const partner = safeText(req.body.partner, 60), skillTitle = safeText(req.body.skillTitle, 80), when = safeText(req.body.when, 40), goal = safeText(req.body.goal, 300);
  if (!partner || !skillTitle || !when || !goal) return res.status(400).json({ error: "Complete the partner, skill, date/time and learning goal." });
  const related = dbConnected
    ? await ExchangeRequest.findOne({ $or: [{ requestedBy: user.name, studentName: partner, status: "Accepted" }, { requestedBy: partner, studentName: user.name, status: "Accepted" }] })
    : memoryRequests.find(r => ((r.requestedBy === user.name && r.studentName === partner) || (r.requestedBy === partner && r.studentName === user.name)) && r.status === "Accepted");
  if (!related) return res.status(403).json({ error: "A learning session can be planned after the exchange request is accepted." });
  const session = { _id: `s${Date.now()}`, organizer: user.name, partner, skillTitle, when, goal, status: "Scheduled", createdAt: new Date().toISOString() };
  memorySessions.push(session); res.status(201).json(session);
});
app.get("/api/notifications", async (req, res) => {
  const user = await authenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Please log in again." });
  const reqs = dbConnected
    ? await ExchangeRequest.find({ $or: [{ requestedBy: user.name }, { studentName: user.name }] }).sort({ createdAt: -1 }).lean()
    : memoryRequests.filter(r => r.requestedBy === user.name || r.studentName === user.name);
  const notices = [];
  reqs.forEach(r => notices.push({ id: `request-${r._id}`, type: "request", title: r.requestedBy === user.name ? "Exchange request update" : "New exchange request", detail: `${r.requestedBy} ↔ ${r.studentName} · ${r.skillTitle} · ${r.status}`, createdAt: r.createdAt || new Date().toISOString() }));
  // A scheduled-session alert is sent only to the invited partner, never to its organizer.
  memorySessions.filter(x => x.partner === user.name && x.organizer !== user.name).forEach(x => notices.push({ id: `session-${x._id}`, type: "session", partner: x.organizer, title: "Learning session scheduled for you", detail: `${x.organizer} scheduled ${x.skillTitle} with you · ${x.when} · Goal: ${x.goal}`, createdAt: x.createdAt }));
  // Message alerts are only for the recipient, not the person who sent the message.
  memoryMessages.filter(m => m.to === user.name && m.from !== user.name).forEach(m => notices.push({ id: `message-${m._id}`, type: "message", partner: m.from, title: `New message from ${m.from}`, detail: `${m.body}`, createdAt: m.createdAt }));
  const readIds = readNotificationsByUser.get(user.name) || new Set();
  notices.forEach(n => { n.read = readIds.has(n.id); });
  notices.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)); res.json(notices);
});
app.post("/api/notifications/:id/read", async (req, res) => {
  const user = await authenticatedUser(req);
  if (!user) return res.status(401).json({ error: "Please log in again." });
  let readIds = readNotificationsByUser.get(user.name);
  if (!readIds) { readIds = new Set(); readNotificationsByUser.set(user.name, readIds); }
  readIds.add(String(req.params.id));
  res.json({ ok: true, id: String(req.params.id) });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, req, res, next) => {
  console.error("Request error:", err.message);
  res.status(500).json({ error: "Something went wrong while processing the request." });
});

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 2500 })
  .then(async () => {
    dbConnected = true;
    // Remove the original built-in demo listings if they remain in an older database.
    // Registered students and other manually created listings are preserved.
    await Skill.deleteMany({
      teachBy: { $in: ["Roni Manithra", "Arjun Kumar"] },
      title: { $in: ["Java Programming", "Full-Stack Web Development", "UI / UX Design & Prototyping", "Python & Data Analysis"] }
    });
    console.log("MongoDB connected. Built-in sample listings cleared.");
  })
  .catch(err => {
    dbConnected = false;
    console.log("MongoDB unavailable; using temporary in-memory storage (no sample records).");
    console.log("Details:", err.message);
  })
  .finally(() => {
    app.listen(PORT, () => console.log(`Student Skill Exchange running at http://localhost:${PORT}`));
  });
