import express from "express";
import cors from "cors";
import pkg from "whatsapp-web.js";
import qrcode from "qrcode";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const { Client, LocalAuth } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// ==========================
// ✅ BANCO SQLITE
// ==========================
const db = await open({
  filename: "./history.db",
  driver: sqlite3.Database
});

await db.exec(`
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT,
  groupName TEXT,
  message TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// ==========================
// ✅ SESSÕES
// ==========================
let sessions = {};

async function createSession(userId) {
  if (sessions[userId]) return sessions[userId];

  const client = new Client({
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    },
    authStrategy: new LocalAuth({
      clientId: `achady-${userId}`
    })
  });

  sessions[userId] = {
    client,
    qr: null,
    status: "starting",
    autoTimer: null
  };

  client.on("qr", async (qr) => {
    sessions[userId].qr = await qrcode.toDataURL(qr);
    sessions[userId].status = "qr";
  });

  client.on("ready", () => {
    sessions[userId].status = "ready";
    console.log(`✅ WhatsApp pronto USER ${userId}`);
  });

  await client.initialize();
  return sessions[userId];
}

// ==========================
// ✅ START
// ==========================
app.post("/start/:userId", async (req, res) => {
  const { userId } = req.params;
  const session = await createSession(userId);

  res.json({
    message: "Sessão iniciada",
    userId,
    status: session.status
  });
});

// ==========================
// ✅ QR
// ==========================
app.get("/qr/:userId", (req, res) => {
  const session = sessions[req.params.userId];

  if (!session) return res.json({ qr: null, status: "not_started" });

  res.json({ qr: session.qr, status: session.status });
});

// ==========================
// ✅ STATUS
// ==========================
app.get("/status", (req, res) => {
  const users = Object.keys(sessions);
  const status = users.length > 0 ? sessions[users[0]].status : "offline";
  res.json({ status, users });
});

// ==========================
// ✅ ENTRAR NO GRUPO PELO LINK
// ==========================
app.post("/join/:userId", async (req, res) => {
  const { userId } = req.params;
  const { invite, name } = req.body;

  const session = sessions[userId];
  if (!session || session.status !== "ready") {
    return res.status(400).json({ error: "WhatsApp não está pronto" });
  }

  try {
    const code = invite.split("/").pop();
    const result = await session.client.acceptInvite(code);

    res.json({
      success: true,
      group: result.gid._serialized,
      name
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// ✅ ENVIAR MENSAGEM MANUAL
// ==========================
app.post("/send/:userId", async (req, res) => {
  const { userId } = req.params;
  const { groupId, message } = req.body;

  const session = sessions[userId];
  await session.client.sendMessage(groupId, message);

  await db.run(
    "INSERT INTO history (userId, groupName, message) VALUES (?, ?, ?)",
    [userId, groupId, message]
  );

  res.json({ success: true });
});

// ==========================
// ✅ DISPARO AUTOMÁTICO X EM X MINUTOS
// ==========================
app.post("/auto/:userId", async (req, res) => {
  const { userId } = req.params;
  const { groupId, message, minutes } = req.body;

  const session = sessions[userId];

  if (session.autoTimer) clearInterval(session.autoTimer);

  session.autoTimer = setInterval(async () => {
    await session.client.sendMessage(groupId, message);

    await db.run(
      "INSERT INTO history (userId, groupName, message) VALUES (?, ?, ?)",
      [userId, groupId, message]
    );

  }, minutes * 60 * 1000);

  res.json({ success: true, auto: true });
});

// ==========================
// ✅ HISTÓRICO
// ==========================
app.get("/history", async (req, res) => {
  const rows = await db.all("SELECT * FROM history ORDER BY id DESC");
  res.json(rows);
});

// ==========================
// ✅ HOME
// ==========================
app.get("/", (req, res) => {
  res.send("Servidor WhatsApp Achady está rodando. 🚀");
});

app.listen(3000, () => {
  console.log("🚀 Achady Online na porta 3000");
});
