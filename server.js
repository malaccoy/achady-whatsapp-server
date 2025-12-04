import express from "express";
import cors from "cors";
import pkg from "whatsapp-web.js";
import QRCode from "qrcode";

const { Client, LocalAuth } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// Guarda múltiplas sessões (1 por usuário do Achady)
let sessions = {};

// Criar uma sessão WhatsApp para cada userId
async function createSession(userId) {
    if (sessions[userId]) {
        return sessions[userId];
    }

    const client = new Client({
        restartOnAuthFail: true,
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer'
            ]
        }
    });

    sessions[userId] = {
        client,
        qr: null,
        ready: false,
        status: "starting"
    };

    client.on("qr", async (qr) => {
        console.log("📌 QR CODE GERADO PARA USER:", userId);
        const pngQR = await QRCode.toDataURL(qr);
        sessions[userId].qr = pngQR;
        sessions[userId].status = "qr";
    });

    client.on("ready", () => {
        console.log("✅ WhatsApp conectado para:", userId);
        sessions[userId].ready = true;
        sessions[userId].status = "ready";
    });

    client.on("auth_failure", () => {
        console.log("❌ Falha de autenticação:", userId);
        sessions[userId].status = "auth_failure";
    });

    client.initialize();
    return sessions[userId];
}

// =================================================================
// 🔥 ROTA PARA INICIAR SESSÃO E GERAR QR
// =================================================================
app.get("/generate-qr/:userId", async (req, res) => {
    const { userId } = req.params;
    await createSession(userId);
    res.json({ ok: true, message: "Sessão iniciada. Busque o QR em /qr/" + userId });
});

// =================================================================
// 🔥 ROTA PARA BUSCAR QR CODE EM PNG BASE64
// =================================================================
app.get("/qr/:userId", (req, res) => {
    const { userId } = req.params;
    const session = sessions[userId];

    if (!session) {
        return res.json({ qr: null, status: "no-session" });
    }

    res.json({
        qr: session.qr,
        status: session.status
    });
});

// =================================================================
// 📩 ROTA PARA ENVIAR MENSAGEM AO GRUPO
// =================================================================
app.post("/send", async (req, res) => {
    const { userId, groupId, message } = req.body;

    const session = sessions[userId];
    if (!session || !session.ready) {
        return res.status(400).json({ error: "Sessão não conectada" });
    }

    try {
        await session.client.sendMessage(groupId, message);
        res.json({ success: true });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Erro ao enviar mensagem" });
    }
});

// =================================================================
// 🌐 ROTA DE TESTE
// =================================================================
app.get("/", (req, res) => {
    res.send("Servidor WhatsApp Achady está rodando. 🚀");
});

// =================================================================
// INICIAR SERVIDOR
// =================================================================
app.listen(3000, () => {
    console.log("🌐 Servidor rodando na porta 3000");
});
