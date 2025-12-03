import express from "express";
import { create } from "venom-bot";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

let client;

create({
  session: "achady-session",
  multidevice: true
})
  .then((c) => {
    client = c;
    console.log("🚀 WhatsApp conectado! Aguarde QR CODE nos logs.");
  })
  .catch((e) => {
    console.error("Erro ao iniciar Venom:", e);
  });

app.post("/enviarMensagem", async (req, res) => {
  const { grupo, mensagem } = req.body;

  if (!client) {
    return res.status(500).json({ error: "Cliente WhatsApp não conectado." });
  }

  try {
    await client.sendText(grupo, mensagem);
    res.json({ status: "OK", enviado_para: grupo });
  } catch (error) {
    res.status(500).json({ error: "Falha ao enviar mensagem", detalhe: error });
  }
});

app.get("/", (req, res) => {
  res.send("Servidor WhatsApp ACHADY está ativo.");
});

app.listen(3000, () => console.log("Servidor rodando na porta 3000"));
