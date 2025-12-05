import express from "express";
import cors from "cors";
import pkg from "whatsapp-web.js";
import qrcode from "qrcode";

const { Client, LocalAuth } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// ===============================================
// MULTI-SESSÕES
// ===============================================
let sessions = {};

// ===============================================
// CRIA OU RECUPERA SESSÃO
// ===============================================
async function createSession(userId) {
    if (sessions[userId]) {
        return sessions[userId];
    }

    console.log("➡️ Criando sessão para USER:", userId);

    const client = new Client({
        puppeteer: {
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        },
        authStrategy: new LocalAuth({
            clientId: `achady-session-${userId}`
        })
    });

    sessions[userId] = {
        client,
        qr: null,
        status: "starting"
    };

    // Evento de QR
    client.on("qr", async (qr) => {
        console.log(`📌 QR CODE GERADO PARA USER: ${userId}`);
        const qrImage = await qrcode.toDataURL(qr);
        sessions[userId].qr = qrImage;
        sessions[userId].status = "qr";
    });

    // Evento conectado
    client.on("ready", () => {
        console.log(`✅ WhatsApp conectado — USER ${userId}`);
        sessions[userId].status = "ready";
    });

    client.initialize();

    return sessions[userId];
}

// ===============================================
// ROTA: INICIAR SESSÃO
// ===============================================
app.post("/start/:userId", async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
        return res.status(400).json({ error: "userId é obrigatório" });
    }

    const session = await createSession(userId);

    return res.json({
        message: "Sessão iniciada",
        userId,
        status: session.status
    });
});

// ===============================================
// ROTA: PEGAR QR
// ===============================================
app.get("/qr/:userId", async (req, res) => {
    const { userId } = req.params;

    const session = sessions[userId];
    if (!session) {
        return res.status(404).json({
            qr: null,
            status: "not_started"
        });
    }

    return res.json({
        qr: session.qr,
        status: session.status
    });
});

// ===============================================
// ✅✅✅ ROTA: ENTRAR AUTOMATICAMENTE NO GRUPO
// ===============================================
app.post("/join/:userId", async (req, res) => {
    const { userId } = req.params;
    const { invite } = req.body;

    if (!invite) {
        return res.status(400).json({ error: "Invite é obrigatório" });
    }

    const session = sessions[userId];

    if (!session) {
        return res.status(404).json({ error: "Sessão não encontrada" });
    }

    if (session.status !== "ready") {
        return res.status(400).json({ error: "WhatsApp ainda não está pronto" });
    }

    try {
        const inviteCode = invite.split("/").pop();
        await session.client.acceptInvite(inviteCode);

        console.log(`✅ Entrou no grupo com sucesso — USER ${userId}`);

        return res.json({
            ok: true,
            message: "Entrou no grupo com sucesso"
        });

    } catch (err) {
        console.error("Erro ao entrar no grupo:", err.message);
        return res.status(500).json({
            error: "Erro ao entrar no grupo",
            details: err.message
        });
    }
});

// ===============================================
// ROTA: STATUS GLOBAL
// ===============================================
app.get("/status", (req, res) => {
    const users = Object.keys(sessions);
    let status = "offline";

    if (users.length > 0) {
        const userId = users[0];
        status = sessions[userId]?.status || "offline";
    }

    res.json({
        ok: true,
        status,
        users
    });
});

// ===============================================
// HOME
// ===============================================
app.get("/", (req, res) => {
    res.send("Servidor WhatsApp Achady está rodando. 🚀");
});

// ===============================================
// START SERVER
// ===============================================
app.listen(3000, () => {
    console.log("🌐 Servidor rodando na porta 3000");
});
