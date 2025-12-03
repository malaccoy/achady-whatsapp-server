import express from "express";
import cors from "cors";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// Inicializa o cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

client.on("qr", (qr) => {
    console.log("🔵 QR CODE GERADO. ESCANEIE ABAIXO:");
    qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
    console.log("✅ WhatsApp conectado com sucesso!");
});

client.initialize();

// Rota para enviar mensagens
app.post("/enviarMensagem", async (req, res) => {
    const { grupo, mensagem } = req.body;

    try {
        await client.sendMessage(grupo, mensagem);
        res.json({ status: "ok", enviado: grupo });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao enviar mensagem." });
    }
});

app.get("/", (req, res) => {
    res.send("Servidor WhatsApp Achady está rodando.");
});

app.listen(3000, () => console.log("🌐 Servidor rodando na porta 3000"));
