import express from "express";
import cors from "cors";
import pkg from "whatsapp-web.js";
import qrcode from "qrcode";

const { Client, LocalAuth } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// ===============================================
// MULTI-SESSÕES (1 sessão por usuário Achady)
// ===============================================
let sessions = {};

// Cria ou recupera sessão
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

    // Evento autenticado
    client.on("ready", () => {
        console.log(`✅ WhatsApp conectado — USER ${userId}`);
        sessions[userId].status = "ready";
    });

    client.initialize();

    return sessions[userId];
}

// ===============================================
// ROTA: CRIAR/INICIAR SESSÃO
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
// ROTA: PEGAR QR CODE
// ===============================================
app.get("/qr/:userId", async (req, res) => {
    const { userId } = req.params;

    const session = sessions[userId];
    if (!session) {
        return res.status(404).json({ qr: null, status: "not_started" });
    }

    return res.json({
        qr: session.qr,
        status: session.status
    });
});

// ===============================================
// ROTA DE TESTE (homepage)
// ===============================================
app.get("/", (req, res) => {
    res.send("Servidor WhatsApp Achady está rodando. 🚀");
});

// ===============================================
// INICIAR SERVIDOR
// ===============================================
app.listen(3000, () => {
    console.log("🌐 Servidor rodando na porta 3000");
});
