// server.js
import express from "express";
import cors from "cors";
import pkg from "whatsapp-web.js";
import qrcode from "qrcode";
import sqlite3 from "sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Client, LocalAuth } = pkg;

// ==========================
// ✅ APP EXPRESS
// ==========================
const app = express();
app.use(cors());
app.use(express.json());

// ==========================
// ✅ SQLITE (SEM 'sqlite', APENAS 'sqlite3')
// ==========================

// Resolve caminho absoluto do arquivo de banco
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "history.db");

// Instância bruta do sqlite3
const rawDb = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("❌ Erro ao conectar no SQLite:", err.message);
  } else {
    console.log("✅ SQLite conectado em", dbPath);
  }
});

// Pequeno wrapper com Promises pra poder usar "await db.run / db.all"
const db = {
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      rawDb.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve(this);
      });
    });
  },
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      rawDb.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },
};

// Cria tabela se não existir
async function initDatabase() {
  await db.run(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT,
      groupName TEXT,
      message TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log("✅ Tabela 'history' pronta");
}

// ==========================
// ✅ SESSÕES WHATSAPP
// ==========================
let sessions = {};

/**
 * Cria (ou reaproveita) uma sessão de WhatsApp para o userId
 */
async function createSession(userId) {
  if (sessions[userId]) return sessions[userId];

  const client = new Client({
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
    authStrategy: new LocalAuth({
      clientId: `achady-${userId}`,
    }),
  });

  sessions[userId] = {
    client,
    qr: null,
    status: "starting",
    autoTimer: null,
  };

  client.on("qr", async (qr) => {
    try {
      sessions[userId].qr = await qrcode.toDataURL(qr);
      sessions[userId].status = "qr";
      console.log(`🔑 QR atualizado para USER ${userId}`);
    } catch (err) {
      console.error("Erro ao gerar QRCode:", err);
    }
  });

  client.on("ready", () => {
    sessions[userId].status = "ready";
    console.log(`✅ WhatsApp pronto USER ${userId}`);
  });

  client.on("disconnected", (reason) => {
    console.log(`⚠️ WhatsApp desconectado USER ${userId}:`, reason);
    sessions[userId].status = "disconnected";
  });

  await client.initialize();
  return sessions[userId];
}

// ==========================
// ✅ ROTAS
// ==========================

// Inicia sessão para um userId
app.post("/start/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const session = await createSession(userId);

    res.json({
      message: "Sessão iniciada",
      userId,
      status: session.status,
    });
  } catch (err) {
    console.error("Erro em /start:", err);
    res.status(500).json({ error: "Erro ao iniciar sessão" });
  }
});

// Retorna QR Code da sessão
app.get("/qr/:userId", (req, res) => {
  const session = sessions[req.params.userId];

  if (!session) {
    return res.json({ qr: null, status: "not_started" });
  }

  res.json({ qr: session.qr, status: session.status });
});

// Status geral
app.get("/status", (req, res) => {
  const users = Object.keys(sessions);
  const status = users.length > 0 ? sessions[users[0]].status : "offline";
  res.json({ status, users });
});

// Entrar em grupo pelo link de convite
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
      name,
    });
  } catch (err) {
    console.error("Erro em /join:", err);
    res.status(500).json({ error: err.message });
  }
});

// Enviar mensagem manual para um grupo
app.post("/send/:userId", async (req, res) => {
  const { userId } = req.params;
  const { groupId, message } = req.body;

  try {
    const session = sessions[userId];

    if (!session || session.status !== "ready") {
      return res.status(400).json({ error: "WhatsApp não está pronto" });
    }

    await session.client.sendMessage(groupId, message);

    await db.run(
      "INSERT INTO history (userId, groupName, message) VALUES (?, ?, ?)",
      [userId, groupId, message]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Erro em /send:", err);
    res.status(500).json({ error: "Erro ao enviar mensagem" });
  }
});

// Disparo automático X em X minutos
app.post("/auto/:userId", async (req, res) => {
  const { userId } = req.params;
  const { groupId, message, minutes } = req.body;

  try {
    const session = sessions[userId];

    if (!session || session.status !== "ready") {
      return res.status(400).json({ error: "WhatsApp não está pronto" });
    }

    if (session.autoTimer) clearInterval(session.autoTimer);

    const intervalMs = Number(minutes) * 60 * 1000;

    if (!intervalMs || intervalMs <= 0) {
      return res.status(400).json({ error: "Intervalo inválido" });
    }

    session.autoTimer = setInterval(async () => {
      try {
        await session.client.sendMessage(groupId, message);

        await db.run(
          "INSERT INTO history (userId, groupName, message) VALUES (?, ?, ?)",
          [userId, groupId, message]
        );
      } catch (err) {
        console.error("Erro no envio automático:", err);
      }
    }, intervalMs);

    res.json({ success: true, auto: true });
  } catch (err) {
    console.error("Erro em /auto:", err);
    res.status(500).json({ error: "Erro ao configurar envio automático" });
  }
});

// Histórico
app.get("/history", async (req, res) => {
  try {
    const rows = await db.all("SELECT * FROM history ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    console.error("Erro em /history:", err);
    res.status(500).json({ error: "Erro ao buscar histórico" });
  }
});

// Home
app.get("/", (req, res) => {
  res.send("Servidor WhatsApp Achady está rodando. 🚀");
});

// ==========================
// ✅ SUBIR SERVIDOR
// ==========================
const PORT = process.env.PORT || 3000;

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Achady Online na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Erro ao inicializar banco:", err);
    process.exit(1);
  });
