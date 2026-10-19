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

// Lokale backup map voor TouchDesigner foto's
const backupMap = process.env.BACKUP_DIR || path.join(__dirname, "backup_photos");
fs.mkdirSync(backupMap, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());

// Front-end statische bestanden uitdelen
app.use(express.static(frontendMap));

// Fallback voor SPA / front-end root
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendMap, "index.html"));
});

// ---------- Database Model ----------
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

// bufferCommands uitschakelen zodat queries direct falen en overschakelen naar backup wanneer MongoDB offline is
mongoose.set("bufferCommands", false);

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

// Hulpfunctie om MongoDB binary/buffer veilig om te zetten naar Node.js Buffer
function toBuffer(data) {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data;
  if (data.buffer && Buffer.isBuffer(data.buffer)) return data.buffer;
  if (data.buffer) return Buffer.from(data.buffer);
  return Buffer.from(data);
}

// ---------- Lokale Backup Helper Functies ----------

// Sla een foto en metadata lokaal op schijf op
function saveLocalBackup({ sessie, nummer, bestand, contentType, buffer }) {
  const filePath = path.join(backupMap, bestand);
  const metaPath = path.join(backupMap, `${bestand}.json`);
  const meta = {
    sessie,
    nummer,
    bestand,
    contentType: contentType || "image/png",
    url: `/uploads/${bestand}`,
    aangemaakt: new Date().toISOString(),
  };

  // Eerdere foto's van dezelfde sessie en nummer vervangen/opruimen
  cleanOldLocalBackup(sessie, nummer, bestand);

  fs.writeFileSync(filePath, buffer);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

// Vervang/verwijder oudere versies van dezelfde sessie + foto-nummer uit de backup map
function cleanOldLocalBackup(sessie, nummer, currentBestand) {
  try {
    const files = fs.readdirSync(backupMap);
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(backupMap, file), "utf8"));
          if (meta.sessie === sessie && meta.nummer === nummer && meta.bestand !== currentBestand) {
            try { fs.unlinkSync(path.join(backupMap, file)); } catch {}
            try { fs.unlinkSync(path.join(backupMap, meta.bestand)); } catch {}
          }
        } catch {}
      }
    }
  } catch (err) {
    console.warn("[Backup] Fout bij opschonen oude backup bestanden:", err.message);
  }
}

// Haal alle lokaal opgeslagen backup foto's op (gesorteerd op datum aflopend)
function getLocalPhotos(limit = 300) {
  try {
    const files = fs.readdirSync(backupMap);
    const photos = [];
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(backupMap, file), "utf8"));
          if (fs.existsSync(path.join(backupMap, meta.bestand))) {
            photos.push(meta);
          }
        } catch {}
      }
    }
    photos.sort((a, b) => new Date(b.aangemaakt).getTime() - new Date(a.aangemaakt).getTime());
    return photos.slice(0, limit);
  } catch (err) {
    console.error("[Backup] Fout bij ophalen van lokale backup foto's:", err.message);
    return [];
  }
}

// Verwijder alle foto's van een sessie uit de backup map
function deleteLocalSession(sessie) {
  let deleted = 0;
  try {
    const files = fs.readdirSync(backupMap);
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(backupMap, file), "utf8"));
          if (meta.sessie === sessie) {
            try { fs.unlinkSync(path.join(backupMap, file)); } catch {}
            try { fs.unlinkSync(path.join(backupMap, meta.bestand)); } catch {}
            deleted++;
          }
        } catch {}
      }
    }
  } catch (err) {
    console.warn("[Backup] Fout bij verwijderen sessie uit lokale backup:", err.message);
  }
  return deleted;
}

// Automatische twee-richtingen synchronisatie tussen lokale backup en MongoDB
let isSyncing = false;
async function syncMongoAndBackup() {
  if (!isDbConnected() || isSyncing) return;
  isSyncing = true;
  try {
    // 1. Lokale foto's die offline zijn genomen syncen naar MongoDB
    const localPhotos = getLocalPhotos(1000);
    let naarMongo = 0;
    for (const meta of localPhotos) {
      try {
        const bestaatInDb = await Photo.findOne({ sessie: meta.sessie, nummer: meta.nummer });
        if (!bestaatInDb) {
          const filePath = path.join(backupMap, meta.bestand);
          if (fs.existsSync(filePath)) {
            const buffer = fs.readFileSync(filePath);
            await Photo.create({
              sessie: meta.sessie,
              nummer: meta.nummer,
              bestand: meta.bestand,
              contentType: meta.contentType || "image/png",
              data: buffer,
              url: meta.url || `/uploads/${meta.bestand}`,
              aangemaakt: new Date(meta.aangemaakt),
            });
            naarMongo++;
          }
        }
      } catch (err) {
        console.warn(`[Sync] Fout bij syncen ${meta.bestand} naar MongoDB:`, err.message);
      }
    }
    if (naarMongo > 0) {
      console.log(`[Sync] 🔄 ${naarMongo} offline foto('s) gesynchroniseerd naar MongoDB!`);
    }

    // 2. Bestaande foto's uit MongoDB backuppen naar de lokale map
    const dbPhotos = await Photo.find().lean();
    let naarBackup = 0;
    for (const p of dbPhotos) {
      const localFile = path.join(backupMap, p.bestand);
      const localMeta = path.join(backupMap, `${p.bestand}.json`);
      const rawBuf = toBuffer(p.data);
      if (!fs.existsSync(localFile) && rawBuf) {
        fs.writeFileSync(localFile, rawBuf);
        const meta = {
          sessie: p.sessie,
          nummer: p.nummer,
          bestand: p.bestand,
          contentType: p.contentType || "image/png",
          url: p.url || `/uploads/${p.bestand}`,
          aangemaakt: p.aangemaakt ? new Date(p.aangemaakt).toISOString() : new Date().toISOString(),
        };
        fs.writeFileSync(localMeta, JSON.stringify(meta, null, 2), "utf8");
        naarBackup++;
      }
    }
    if (naarBackup > 0) {
      console.log(`[Sync] 💾 ${naarBackup} foto('s) vanuit MongoDB opgeslagen in lokale backup map.`);
    }
  } catch (err) {
    console.warn("[Sync] Synchronisatiefout:", err.message);
  } finally {
    isSyncing = false;
  }
}

// Database connectie events
mongoose.connection.on("connected", () => {
  console.log("🟢 Verbonden met MongoDB");
  syncMongoAndBackup();
});

mongoose.connection.on("disconnected", () => {
  console.warn("⚠️  MongoDB verbinding verbroken! Automatisch omgeschakeld naar LOKALE BACKUP MODUS.");
});

mongoose.connection.on("reconnected", () => {
  console.log("🟢 MongoDB verbinding hersteld! Synchronisatie wordt hervat...");
  syncMongoAndBackup();
});

function connectMongoDB() {
  if (!process.env.DATABASE_URI) {
    console.warn("⚠️  DATABASE_URI ontbreekt in .env. Server draait uitsluitend in LOKALE BACKUP MODUS.");
    return;
  }

  mongoose
    .connect(process.env.DATABASE_URI, {
      serverSelectionTimeoutMS: 5000,
    })
    .catch((err) => {
      console.warn(`⚠️  MongoDB verbinding mislukt (${err.message}).`);
      console.warn("👉 Geen zorgen: Server draait gewoon door in LOKALE BACKUP MODUS!");
    });
}

// ---------- Beveiliging (optioneel) ----------
function checkKey(req, res, next) {
  const key = process.env.UPLOAD_KEY;
  if (!key) return next();
  if (req.headers.authorization === `Bearer ${key}`) return next();
  res.status(401).json({ fout: "Ongeldige API-key" });
}

// ---------- Uploads (in-memory, direct naar backup en MongoDB) ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // max 15 MB
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
  const lokaleFotos = getLocalPhotos();
  res.json({
    ok: true,
    database: isDbConnected() ? "verbonden" : "niet verbonden (lokale backup actief)",
    modus: isDbConnected() ? "hybride (MongoDB + lokale backup)" : "lokale backup (MongoDB offline)",
    backupMap: path.relative(path.join(__dirname, ".."), backupMap),
    aantalLokaleFotos: lokaleFotos.length,
  });
});

// Foto ontvangen van TouchDesigner (veldnaam: photo)
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

    // 1. ALTIJD direct bewaren in de lokale backup map (nooit dataverlies bij netwerkstoringen)
    const meta = saveLocalBackup({
      sessie,
      nummer,
      bestand,
      contentType,
      buffer: req.file.buffer,
    });
    console.log(`📸 Foto opgeslagen in lokale backup: ${bestand} (sessie: ${sessie}, nr: ${nummer})`);

    // 2. Tevens opslaan in MongoDB indien verbinding actief is
    let inMongo = false;
    if (isDbConnected()) {
      try {
        await Photo.findOneAndUpdate(
          { sessie, nummer },
          {
            bestand,
            contentType,
            data: req.file.buffer,
            url: `/uploads/${bestand}`,
            aangemaakt: new Date(meta.aangemaakt),
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        inMongo = true;
        console.log(`☁️  Foto tevens opgeslagen in MongoDB: sessie ${sessie}, nr ${nummer}`);
      } catch (dbErr) {
        console.warn(`⚠️  MongoDB opslaan mislukt (${dbErr.message}). Foto staat veilig in lokale backup.`);
      }
    } else {
      console.log(`ℹ️  MongoDB niet verbonden: foto veilig behouden in lokale backup map.`);
    }

    res.status(201).json({
      ...meta,
      opslag: inMongo ? "mongodb+backup" : "lokale_backup",
    });
  } catch (err) {
    next(err);
  }
});

// Foto's ophalen, nieuwste eerst (?limit=300)
app.get("/api/photos", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 300, 1000);

    // Als MongoDB verbonden is, haal foto's uit de database
    if (isDbConnected()) {
      try {
        const fotos = await Photo.find()
          .select("-data") // Zware binaire data niet meesturen in JSON
          .sort({ aangemaakt: -1 })
          .limit(limit)
          .lean();
        return res.json(fotos);
      } catch (err) {
        console.warn("⚠️  Fout bij ophalen uit MongoDB, switch direct naar lokale backup:", err.message);
      }
    }

    // Automatische switch naar lokale backup wanneer Mongoose uitvalt of offline is
    const fotosLokaal = getLocalPhotos(limit);
    res.json(fotosLokaal);
  } catch (err) {
    next(err);
  }
});

// Foto serveren (eerst MongoDB, fallback naar lokale backup map)
app.get("/uploads/:bestand", async (req, res, next) => {
  try {
    const bestandsnaam = path.basename(req.params.bestand);

    // 1. Probeer eerst via MongoDB
    if (isDbConnected()) {
      try {
        const foto = await Photo.findOne({ bestand: bestandsnaam });
        const buf = toBuffer(foto && foto.data);
        if (buf) {
          res.set("Content-Type", foto.contentType || "image/png");
          res.set("Cache-Control", "public, max-age=86400");
          return res.send(buf);
        }
      } catch (dbErr) {
        console.warn("⚠️  MongoDB fout bij ophalen foto, switch naar lokale backup:", dbErr.message);
      }
    }

    // 2. Fallback: Probeer lokale backup map (als Mongoose uitvalt of foto niet in DB zit)
    const localPath = path.join(backupMap, bestandsnaam);
    if (fs.existsSync(localPath)) {
      res.set("Cache-Control", "public, max-age=86400");
      return res.sendFile(localPath);
    }

    res.status(404).json({ fout: "Foto niet gevonden in MongoDB of lokale backup" });
  } catch (err) {
    next(err);
  }
});

// Foto serveren via MongoDB ObjectId (eerst MongoDB, fallback naar lokale backup)
app.get("/api/photos/:id/image", async (req, res, next) => {
  try {
    // 1. Probeer eerst via MongoDB
    if (isDbConnected() && mongoose.Types.ObjectId.isValid(req.params.id)) {
      try {
        const foto = await Photo.findById(req.params.id);
        const buf = toBuffer(foto && foto.data);
        if (buf) {
          res.set("Content-Type", foto.contentType || "image/png");
          res.set("Cache-Control", "public, max-age=86400");
          return res.send(buf);
        }
      } catch (dbErr) {
        console.warn("⚠️  MongoDB fout bij ophalen via ID, switch naar lokale backup:", dbErr.message);
      }
    }

    // 2. Fallback: Probeer lokale backup map
    const localPath = path.join(backupMap, path.basename(req.params.id));
    if (fs.existsSync(localPath)) {
      res.set("Cache-Control", "public, max-age=86400");
      return res.sendFile(localPath);
    }

    res.status(404).json({ fout: "Foto niet gevonden in MongoDB of lokale backup" });
  } catch (err) {
    next(err);
  }
});

// Foto downloaden (eerst MongoDB, fallback naar lokale backup)
app.get("/api/download/:bestand", async (req, res, next) => {
  try {
    const bestandsnaam = path.basename(req.params.bestand);

    // 1. Probeer eerst downloaden rechtstreeks via MongoDB
    if (isDbConnected()) {
      try {
        const foto = await Photo.findOne({ bestand: bestandsnaam });
        const buf = toBuffer(foto && foto.data);
        if (buf) {
          res.set({
            "Content-Type": foto.contentType || "application/octet-stream",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(foto.bestand)}"`,
          });
          return res.send(buf);
        }
      } catch (dbErr) {
        console.warn("⚠️  MongoDB fout bij downloaden, switch naar lokale backup:", dbErr.message);
      }
    }

    // 2. Fallback: Download vanaf de lokale backup schijf (als Mongoose uitvalt)
    const localPath = path.join(backupMap, bestandsnaam);
    if (fs.existsSync(localPath)) {
      return res.download(localPath, bestandsnaam);
    }

    res.status(404).json({ fout: "Bestand niet gevonden in MongoDB of lokale backup" });
  } catch (err) {
    next(err);
  }
});

// Een hele sessie verwijderen (uit MongoDB en uit de backup map)
app.delete("/api/sessions/:sessie", checkKey, async (req, res, next) => {
  try {
    let dbAantal = 0;
    if (isDbConnected()) {
      try {
        const result = await Photo.deleteMany({ sessie: req.params.sessie });
        dbAantal = result.deletedCount || 0;
      } catch (err) {
        console.warn("[MongoDB] Fout bij verwijderen uit database:", err.message);
      }
    }

    const lokaalAantal = deleteLocalSession(req.params.sessie);

    if (dbAantal === 0 && lokaalAantal === 0) {
      return res.status(404).json({ fout: "Sessie niet gevonden" });
    }

    res.json({
      ok: true,
      verwijderd: dbAantal || lokaalAantal,
      bron: isDbConnected() ? "mongodb + lokale backup" : "lokale backup",
    });
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

// ---------- Server Starten ----------
app.listen(PORT, () => {
  console.log(`🚀 Photobooth server draait op http://localhost:${PORT}`);
  console.log(`📁 Lokale backup map geactiveerd: ${backupMap}`);
  connectMongoDB();
});