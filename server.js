// server.js - versão CommonJS estável

const express = require("express");
const cors = require("cors");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// ==========================
// ✅ APP EXPRESS
// ==========================
const app = express();
app.use(cors());
app.use(express.json());

// ==========================
// ✅ SQLITE (sqlite3 + CommonJS)
// ==========================

const dbPath = path.join(__dirname, "history.db");

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("❌ Erro ao conectar no SQLite:", err.message);
  } else {
    console.log("✅ SQLite conectado em", dbPath);
  }
});

function initDatabase() {
  return new Promise((resolve, reject) => {
    db.run(
      `
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        groupName TEXT,
        message TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `,
      (err) => {
        if (err) {
          console.error("❌ Erro ao criar tabela history:", err.message);
          return reject(err);
        }
        console.log("✅ Tabela 'history' pronta");
        resolve();
      }
    );
  });
}

// Helpers com Promise
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// ==========================
// ✅ SESSÕES WHATSAPP
// ==========================
const sessions = {};

async function createSession(userId) {
  if (sessions[userId]) return sessions[userId];

  console.log("➡️ Criando sessão para USER:", userId);

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
      console.log(`📌 QR CODE GERADO PARA USER: ${userId}`);
    } catch (err) {
      console.error("Erro ao gerar QRCode:", err);
    }
  });

  client.on("ready", () => {
    sessions[userId].status = "ready";
    console.log(`✅ WhatsApp conectado — USER ${userId}`);
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

    console.log("✅ Entrou no grupo com sucesso — USER", userId);

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

    await dbRun(
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

        await dbRun(
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
    const rows = await dbAll("SELECT * FROM history ORDER BY id DESC");
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
      console.log(`🌐 Servidor rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Erro ao inicializar banco:", err);
    process.exit(1);
  });
