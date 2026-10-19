require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cors = require("cors");

const PORT = process.env.PORT || 3000;
const uploadMap = path.join(__dirname, "uploads");
const frontendMap = fs.existsSync(path.join(__dirname, "..", "front-end"))
  ? path.join(__dirname, "..", "front-end")
  : path.join(__dirname, "..", "frontend");

if (!process.env.DATABASE_URI) {
  console.error("DATABASE_URI ontbreekt in .env");
  process.exit(1);
}

fs.mkdirSync(uploadMap, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());

// Foto's en front-end uitdelen
app.use("/uploads", express.static(uploadMap));
app.use(express.static(frontendMap));

// Fallback voor SPA / front-end root
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendMap, "index.html"));
});

// ---------- Database ----------
const photoSchema = new mongoose.Schema({
  sessie: { type: String, required: true },
  nummer: { type: Number, required: true }, // 0 = fotostrip, 1-3 = losse foto's
  bestand: { type: String, required: true },
  url: { type: String, required: true },
  aangemaakt: { type: Date, default: Date.now },
});
photoSchema.index({ sessie: 1, nummer: 1 });
photoSchema.index({ aangemaakt: -1 });
const Photo = mongoose.model("Photo", photoSchema);

// ---------- Beveiliging (optioneel) ----------
// Zet UPLOAD_KEY=iets in .env om uploaden en verwijderen te beveiligen.
// Vul dezelfde waarde in bij API_KEY in je TouchDesigner-script.
function checkKey(req, res, next) {
  const key = process.env.UPLOAD_KEY;
  if (!key) return next();
  if (req.headers.authorization === `Bearer ${key}`) return next();
  res.status(401).json({ fout: "Ongeldige API-key" });
}

// ---------- Uploads ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadMap,
    filename: (req, file, cb) => {
      const veilig = file.originalname.replace(/[^\w.\-]/g, "_");
      cb(null, `${Date.now()}-${crypto.randomBytes(3).toString("hex")}-${veilig}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // max 20 MB
  fileFilter: (req, file, cb) => {
    if (["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) {
      return cb(null, true);
    }
    const err = new Error("Alleen PNG, JPEG of WebP is toegestaan");
    err.status = 400;
    cb(err);
  },
});

const verwijderBestand = (naam) =>
  fs.unlink(path.join(uploadMap, path.basename(naam)), () => {});

// ---------- Routes ----------
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    database: mongoose.connection.readyState === 1 ? "verbonden" : "niet verbonden",
  });
});

// Foto ontvangen van TouchDesigner (veldnaam: photo)
app.post("/api/photos", checkKey, upload.single("photo"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ fout: "Geen bestand ontvangen" });

    const sessie = String(req.body.sessie || "").trim();
    const nummer = Number(req.body.nummer);
    if (!sessie || !Number.isInteger(nummer) || nummer < 0 || nummer > 9) {
      verwijderBestand(req.file.filename);
      return res.status(400).json({ fout: "sessie of nummer ontbreekt of is ongeldig" });
    }

    // Wordt dezelfde foto opnieuw verstuurd, dan vervangen we de oude
    const oud = await Photo.findOne({ sessie, nummer });
    const foto = await Photo.findOneAndUpdate(
      { sessie, nummer },
      {
        bestand: req.file.filename,
        url: `/uploads/${req.file.filename}`,
        aangemaakt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (oud) verwijderBestand(oud.bestand);

    console.log(`Foto ontvangen: sessie ${sessie}, nummer ${nummer}`);
    res.status(201).json(foto);
  } catch (err) {
    if (req.file) verwijderBestand(req.file.filename);
    next(err);
  }
});

// Foto's ophalen, nieuwste eerst (?limit=100 om het aantal te beperken)
app.get("/api/photos", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 300, 1000);
    const fotos = await Photo.find().sort({ aangemaakt: -1 }).limit(limit).lean();
    res.json(fotos);
  } catch (err) {
    next(err);
  }
});

// Foto downloaden als bijlage
app.get("/api/download/:bestand", (req, res) => {
  const bestand = path.basename(req.params.bestand);
  const bestandPath = path.join(uploadMap, bestand);
  if (!fs.existsSync(bestandPath)) {
    return res.status(404).json({ fout: "Bestand niet gevonden" });
  }
  res.download(bestandPath, bestand);
});

// Een hele sessie verwijderen (database en bestanden)
app.delete("/api/sessions/:sessie", checkKey, async (req, res, next) => {
  try {
    const fotos = await Photo.find({ sessie: req.params.sessie });
    if (!fotos.length) return res.status(404).json({ fout: "Sessie niet gevonden" });
    fotos.forEach((f) => verwijderBestand(f.bestand));
    await Photo.deleteMany({ sessie: req.params.sessie });
    res.json({ verwijderd: fotos.length });
  } catch (err) {
    next(err);
  }
});

// ---------- Foutafhandeling ----------
app.use((err, req, res, next) => {
  console.error("Fout:", err.message);
  const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
  res.status(status).json({ fout: err.message });
});

// ---------- Starten ----------
mongoose
  .connect(process.env.DATABASE_URI)
  .then(() => {
    console.log("Verbonden met MongoDB");
    app.listen(PORT, () => console.log(`Server draait op http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Verbinding mislukt:", err.message);
    process.exit(1);
  });;