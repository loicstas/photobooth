require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cors = require("cors");

const PORT = process.env.PORT || 3000;
const frontendMap = fs.existsSync(path.join(__dirname, "..", "front-end"))
  ? path.join(__dirname, "..", "front-end")
  : path.join(__dirname, "..", "frontend");

if (!process.env.DATABASE_URI) {
  console.error("DATABASE_URI ontbreekt in .env");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

// Front-end statische bestanden uitdelen
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
  contentType: { type: String, default: "image/png" },
  data: { type: Buffer, required: true }, // Foto opgeslagen als binary in MongoDB
  url: { type: String },
  aangemaakt: { type: Date, default: Date.now },
});
photoSchema.index({ sessie: 1, nummer: 1 });
photoSchema.index({ aangemaakt: -1 });
photoSchema.index({ bestand: 1 });
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

// ---------- Uploads (in-memory, direct naar MongoDB) ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // max 15 MB (MongoDB document limiet is 16 MB)
  fileFilter: (req, file, cb) => {
    if (["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) {
      return cb(null, true);
    }
    const err = new Error("Alleen PNG, JPEG of WebP is toegestaan");
    err.status = 400;
    cb(err);
  },
});

// ---------- Routes ----------
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    database: mongoose.connection.readyState === 1 ? "verbonden" : "niet verbonden",
  });
});

// Foto ontvangen van TouchDesigner (veldnaam: photo) en opslaan in MongoDB
app.post("/api/photos", checkKey, upload.single("photo"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ fout: "Geen bestand ontvangen" });

    const sessie = String(req.body.sessie || "").trim();
    const nummer = Number(req.body.nummer);
    if (!sessie || !Number.isInteger(nummer) || nummer < 0 || nummer > 9) {
      return res.status(400).json({ fout: "sessie of nummer ontbreekt of is ongeldig" });
    }

    const veilig = req.file.originalname.replace(/[^\w.\-]/g, "_");
    const bestand = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}-${veilig}`;
    const contentType = req.file.mimetype || "image/png";

    // Wordt dezelfde foto opnieuw verstuurd, dan overschrijven we in MongoDB
    const foto = await Photo.findOneAndUpdate(
      { sessie, nummer },
      {
        bestand,
        contentType,
        data: req.file.buffer,
        url: `/uploads/${bestand}`,
        aangemaakt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`Foto opgeslagen in MongoDB: sessie ${sessie}, nummer ${nummer}`);
    const resObj = foto.toObject();
    delete resObj.data;
    res.status(201).json(resObj);
  } catch (err) {
    next(err);
  }
});

// Foto's ophalen, nieuwste eerst (?limit=100 om het aantal te beperken)
app.get("/api/photos", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 300, 1000);
    const fotos = await Photo.find()
      .select("-data") // Zware binaire data niet meesturen in de JSON lijst
      .sort({ aangemaakt: -1 })
      .limit(limit)
      .lean();
    res.json(fotos);
  } catch (err) {
    next(err);
  }
});

// Foto serveren rechtstreeks vanuit MongoDB (via /uploads/:bestand)
app.get("/uploads/:bestand", async (req, res, next) => {
  try {
    const foto = await Photo.findOne({ bestand: req.params.bestand });
    if (!foto || !foto.data) {
      return res.status(404).json({ fout: "Foto niet gevonden in MongoDB" });
    }
    res.set("Content-Type", foto.contentType || "image/png");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(foto.data);
  } catch (err) {
    next(err);
  }
});

// Foto serveren via MongoDB ObjectId (/api/photos/:id/image)
app.get("/api/photos/:id/image", async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ fout: "Ongeldig ID" });
    }
    const foto = await Photo.findById(req.params.id);
    if (!foto || !foto.data) {
      return res.status(404).json({ fout: "Foto niet gevonden in MongoDB" });
    }
    res.set("Content-Type", foto.contentType || "image/png");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(foto.data);
  } catch (err) {
    next(err);
  }
});

// Foto downloaden rechtstreeks vanuit MongoDB
app.get("/api/download/:bestand", async (req, res, next) => {
  try {
    const bestand = req.params.bestand;
    const foto = await Photo.findOne({ bestand });
    if (!foto || !foto.data) {
      return res.status(404).json({ fout: "Bestand niet gevonden in MongoDB" });
    }
    res.set({
      "Content-Type": foto.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(foto.bestand)}"`,
    });
    res.send(foto.data);
  } catch (err) {
    next(err);
  }
});

// Een hele sessie verwijderen uit MongoDB
app.delete("/api/sessions/:sessie", checkKey, async (req, res, next) => {
  try {
    const result = await Photo.deleteMany({ sessie: req.params.sessie });
    if (result.deletedCount === 0) {
      return res.status(404).json({ fout: "Sessie niet gevonden" });
    }
    res.json({ verwijderd: result.deletedCount });
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
  });