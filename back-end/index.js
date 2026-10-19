require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json());

// Map voor de foto's
const uploadMap = path.join(__dirname, "uploads");
fs.mkdirSync(uploadMap, { recursive: true });
app.use("/uploads", express.static(uploadMap));

// MongoDB
mongoose
  .connect(process.env.DATABASE_URI)
  .then(() => console.log("Verbonden met MongoDB"))
  .catch((err) => console.error("Verbinding mislukt:", err.message));

const Photo = mongoose.model(
  "Photo",
  new mongoose.Schema({
    sessie: String,
    nummer: Number, // 0 = fotostrip, 1-3 = losse foto's
    bestand: String,
    url: String,
    aangemaakt: { type: Date, default: Date.now },
  })
);

// Multer: bestand opslaan in /uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadMap,
    filename: (req, file, cb) =>
      cb(null, Date.now() + "-" + file.originalname.replace(/[^\w.\-]/g, "_")),
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // max 20 MB
});

app.get("/", (req, res) => res.send("Hallo vanuit mijn back-end!"));

// Upload vanuit TouchDesigner (veldnaam moet 'photo' zijn)
app.post("/api/photos", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ fout: "Geen bestand ontvangen" });

    const foto = await Photo.create({
      sessie: req.body.sessie,
      nummer: Number(req.body.nummer),
      bestand: req.file.filename,
      url: `/uploads/${req.file.filename}`,
    });
    console.log("Foto ontvangen:", foto.bestand);
    res.status(201).json(foto);
  } catch (err) {
    console.error(err);
    res.status(500).json({ fout: err.message });
  }
});

// Alle foto's ophalen
app.get("/api/photos", async (req, res) => {
  const fotos = await Photo.find().sort({ aangemaakt: -1 });
  res.json(fotos);
});

app.listen(3000, () => console.log("Server draait op http://localhost:3000"));