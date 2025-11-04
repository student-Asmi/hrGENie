// server/index.js
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import http from "http";
import crypto from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST", "PUT"],
  },
});

app.use(express.json());
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || "http://localhost:3000"
}));

// ----------------------
// MongoDB
// ----------------------
if (!process.env.MONGO_URI) console.warn("Warning: MONGO_URI not set in .env");
mongoose
  .connect(process.env.MONGO_URI, { dbName: "collabdb" })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("Mongo error:", err));

// ----------------------
// Schemas & Models
// ----------------------
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,
});
const docSchema = new mongoose.Schema({
  title: String,
  content: Object,
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  shareTokens: [{ token: String, role: { type: String, enum: ["viewer", "editor"], default: "editor" } }],
});
const User = mongoose.model("User", userSchema);
const Doc = mongoose.model("Doc", docSchema);

// ----------------------
// Auth middleware
// ----------------------
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Missing Authorization header" });

  const token = header.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Malformed Authorization header" });

  try {
    const secret = process.env.JWT_SECRET || "devsecret";
    const decoded = jwt.verify(token, secret);
    req.userId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ----------------------
// Auth routes
// ----------------------
app.post("/api/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashed });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "devsecret");
    return res.json({ token, user: { id: user._id, email: user.email } });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "User not found" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: "Invalid password" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "devsecret");
    return res.json({ token, user: { id: user._id, email: user.email } });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

// ----------------------
// Document routes
// ----------------------

// List documents owned by user
app.get("/api/documents", auth, async (req, res) => {
  try {
    const docs = await Doc.find({ owner: req.userId }).sort({ updatedAt: -1 });
    return res.json(docs);
  } catch (err) {
    console.error("List docs error:", err);
    return res.status(500).json({ error: "Failed to list documents" });
  }
});

// Create new document
app.post("/api/doc", auth, async (req, res) => {
  try {
    const doc = await Doc.create({
      title: req.body.title || "Untitled Document",
      content: req.body.content || { html: "" },
      owner: req.userId,
    });
    return res.json(doc);
  } catch (err) {
    console.error("Create doc error:", err);
    return res.status(500).json({ error: "Document creation failed" });
  }
});

// Get single document by ID (owner access)
app.get("/api/doc/:id", auth, async (req, res) => {
  try {
    const doc = await Doc.findOne({ _id: req.params.id, owner: req.userId });
    if (!doc) return res.status(404).json({ error: "Document not found" });
    return res.json(doc);
  } catch (err) {
    console.error("Get doc error:", err);
    return res.status(500).json({ error: "Failed to load document" });
  }
});

// Update/save document (owner only)
app.put("/api/doc/:id", auth, async (req, res) => {
  try {
    const doc = await Doc.findOneAndUpdate(
      { _id: req.params.id, owner: req.userId },
      { content: req.body.content, title: req.body.title },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: "Not found or not allowed" });
    return res.json(doc);
  } catch (err) {
    console.error("Update doc error:", err);
    return res.status(500).json({ error: "Save failed" });
  }
});

// Share link generation (owner only)
app.post("/api/doc/:id/share", auth, async (req, res) => {
  try {
    const { role = "editor" } = req.body;
    const token = crypto.randomBytes(12).toString("hex");

    const doc = await Doc.findOneAndUpdate(
      { _id: req.params.id, owner: req.userId },
      { $push: { shareTokens: { token, role } } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: "Not found or not allowed" });

    return res.json({
      shareLink: `${process.env.CLIENT_ORIGIN || "http://localhost:3000"}/share/${token}`,
      token,
      role,
    });
  } catch (err) {
    console.error("Share error:", err);
    return res.status(500).json({ error: "Share failed" });
  }
});


// -----------------------------------
// AI Assistant Route (Gemini actual integration)
// -----------------------------------


app.post("/api/ai/enhance", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Text required" });

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });


    const prompt = `
You are a professional writing assistant. Improve this text by fixing spelling, grammar, and clarity — 
but do NOT change the meaning. Return only the corrected text.

Text: """${text}"""
    `;

    const result = await model.generateContent(prompt);
    const suggestion = result.response.text();

    res.json({ improved: suggestion });
  } catch (err) {
    console.error("AI error:", err.message);
    res.status(500).json({ error: "AI enhancement failed" });
  }
});


// ----------------------
// Socket.io events
// ----------------------
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-document", ({ docId, userName }) => {
    socket.join(docId);
    socket.data.userName = userName || "Anonymous";
    socket.to(docId).emit("user-joined", { socketId: socket.id, name: socket.data.userName });

    socket.on("text-change", (delta) => {
      socket.broadcast.to(docId).emit("receive-changes", delta);
    });

    socket.on("cursor-move", (cursor) => {
      socket.broadcast.to(docId).emit("cursor-update", {
        socketId: socket.id,
        cursor,
        name: socket.data.userName,
      });
    });

    socket.on("disconnect", () => {
      socket.to(docId).emit("user-left", { socketId: socket.id, name: socket.data.userName });
    });
  });
});

// ----------------------
// Start
// ----------------------
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
