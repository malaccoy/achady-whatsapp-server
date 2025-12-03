import express from "express";
import cors from "cors";
import pkg from "whatsapp-web.js";
import QRCode from "qrcode";

const { Client, LocalAuth } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

console.log("🔄 Inicializando cliente WhatsApp...");

const client = new Client({
    restartOnAuthFail: true,
    authStrategy: new LocalAuth(),
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

// ================================================================
// 🔥 QR CODE EM PNG BASE64 — PERFEITO PARA ESCANEAR 🔥
// ================================================================
client.on("qr", async (qr) => {
    console.log("📌 QR CODE GERADO — IMAGEM BASE64 ABAIXO:");

    const qrImage = await QRCode.toDataURL(qr, { margin: 2 });

    console.log(qrImage);  // <<--- AQUI SAI O QR COMO IMAGEM
    console.log("📌 COPIE TODO O TEXTO ACIMA E ENVIE PARA O CHATGPT");
});

client.on("ready", () => {
    console.log("✅ WhatsApp conectado e pronto para uso!");
});

client.on("auth_failure", () => {
    console.log("❌ Falha de autenticação. Será gerado um novo QR.");
});

client.initialize();

// =================================================================
// 📩 ROTA PARA ENVIAR MENSAGENS PARA GRUPOS
// =================================================================
app.post("/enviarMensagem", async (req, res) => {
    const { grupo, mensagem } = req.body;

    try {
        await client.sendMessage(grupo, mensagem);
        res.json({ status: "ok", enviado: grupo });
    } catch (error) {
        console.error("Erro ao enviar:", error);
        res.status(500).json({ error: "Erro ao enviar mensagem" });
    }
});

// =================================================================
// 🌐 ROTA INICIAL PARA TESTE
// =================================================================
app.get("/", (req, res) => {
    res.send("Servidor WhatsApp Achady está rodando. 🚀");
});

// =================================================================
// 🔥 INICIAR SERVIDOR
// =================================================================
app.listen(3000, () => {
    console.log("🌐 Servidor rodando na porta 3000");
});
