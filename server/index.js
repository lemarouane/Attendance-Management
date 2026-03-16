import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fs from "fs";

dotenv.config({ path: new URL(".env", import.meta.url).pathname });

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ─── Static uploads ───────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));
console.log(`📁 Uploads → ${uploadsDir}`);

// ─── MySQL Pools ──────────────────────────────────────────────────────────────
let poolApo     = null;
let poolPgi     = null;
let apoConnected = false;
let pgiConnected = false;
let apoError     = null;
let pgiError     = null;

async function createPool(database) {
  const host = process.env.MYSQL_HOST || "127.0.0.1";
  const port = parseInt(process.env.MYSQL_PORT || "3306");
  const user = process.env.MYSQL_USER || "root";
  const pass = process.env.MYSQL_PASS || "";

  const pool = mysql.createPool({
    host,
    port,
    user,
    password: pass,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 8000,
    acquireTimeout: 8000,
  });

  const conn = await pool.getConnection();
  await conn.query("SELECT 1");
  conn.release();
  return pool;
}

async function initPools() {
  const host = process.env.MYSQL_HOST || "127.0.0.1";
  const port = process.env.MYSQL_PORT || "3306";
  const user = process.env.MYSQL_USER || "root";

  console.log(`\n🔌 Connecting to MySQL at ${host}:${port} user=${user} …`);

  try {
    poolApo      = await createPool("ensat_apo");
    apoConnected = true;
    apoError     = null;
    console.log("✅ MySQL connected → ensat_apo");
  } catch (err) {
    apoConnected = false;
    apoError     = err.message;
    poolApo      = null;
    console.error("❌ ensat_apo FAILED:", err.message);
  }

  try {
    poolPgi      = await createPool("pgi_ensa_db");
    pgiConnected = true;
    pgiError     = null;
    console.log("✅ MySQL connected → pgi_ensa_db");
  } catch (err) {
    pgiConnected = false;
    pgiError     = err.message;
    poolPgi      = null;
    console.error("❌ pgi_ensa_db FAILED:", err.message);
  }
}


// ─── ROUTE: Health ────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    db_apo: apoConnected ? "connected" : "disconnected",
    db_pgi: pgiConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// ─── ROUTE: DB Status ─────────────────────────────────────────────────────────
app.get("/api/db-status", (_req, res) => {
  res.json({
    connected: apoConnected && pgiConnected,
    apo: { connected: apoConnected, error: apoError },
    pgi: { connected: pgiConnected, error: pgiError },
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: process.env.MYSQL_PORT || "3306",
    user: process.env.MYSQL_USER || "root",
  });
});

// ─── ROUTE: DB Reconnect ──────────────────────────────────────────────────────
app.post("/api/db-reconnect", async (_req, res) => {
  poolApo = null; poolPgi = null;
  apoConnected = false; pgiConnected = false;
  apoError = null; pgiError = null;
  await initPools();
  res.json({
    connected: apoConnected && pgiConnected,
    apo: { connected: apoConnected, error: apoError },
    pgi: { connected: pgiConnected, error: pgiError },
  });
});

// ─── ROUTE: Validate Apogee ───────────────────────────────────────────────────
app.get("/api/validate-apogee/:code", async (req, res) => {
  const code = (req.params.code || "").trim();

  if (!code || code.length < 2) {
    return res.status(400).json({ valid: false, message: "Apogee code is too short." });
  }

  if (!apoConnected || !poolApo) {
    return res.status(503).json({
      valid: false,
      dbOffline: true,
      message: `Database ensat_apo not connected. ${apoError ? "Error: " + apoError : ""}`,
    });
  }

  try {
    // Step 1 — find student in ensat_apo.individu
    const [rows] = await poolApo.query(
      `SELECT COD_IND, LIB_NOM_PAT_IND, LIB_PR1_IND, CIN_IND
       FROM individu
       WHERE COD_ETU = ?
       LIMIT 1`,
      [code]
    );

    if (!rows || rows.length === 0) {
      return res.json({
        valid: false,
        message: `Apogee "${code}" not found in university database.`,
      });
    }

    const student = rows[0];
    const cod_ind = student.COD_IND;

    // Step 2 — get active academic year (ETA_ANU_IAE = 'O')
    let cod_etp = "";
    try {
      const [yearRows] = await poolApo.query(
        `SELECT COD_ANU FROM annee_uni WHERE TRIM(ETA_ANU_IAE) = 'O' ORDER BY COD_ANU DESC LIMIT 1`
      );

      console.log(`📅 annee_uni active year query result:`, JSON.stringify(yearRows));

      if (yearRows && yearRows.length > 0) {
        const activeYear = yearRows[0].COD_ANU;
        console.log(`📅 Active academic year: ${activeYear}`);

        // Step 3 — get COD_ETP for this student in the active year
        const [etpRows] = await poolApo.query(
          `SELECT COD_ETP
           FROM ins_adm_etp
           WHERE COD_IND = ?
           AND COD_ANU = ?
           LIMIT 1`,
          [cod_ind, activeYear]
        );

        console.log(`🎓 ins_adm_etp result for COD_IND=${cod_ind}, year=${activeYear}:`, JSON.stringify(etpRows));

        if (etpRows && etpRows.length > 0) {
          cod_etp = (etpRows[0].COD_ETP || "").trim();
          console.log(`✅ COD_ETP found: ${cod_etp}`);
        } else {
          // Fallback: try most recent year for this student
          console.warn(`⚠️  No record in ins_adm_etp for COD_IND=${cod_ind} in year ${activeYear}, trying fallback…`);
          const [fallbackRows] = await poolApo.query(
            `SELECT COD_ETP, COD_ANU
             FROM ins_adm_etp
             WHERE COD_IND = ?
             ORDER BY COD_ANU DESC
             LIMIT 1`,
            [cod_ind]
          );
          console.log(`🔍 Fallback result:`, JSON.stringify(fallbackRows));
          if (fallbackRows && fallbackRows.length > 0) {
            cod_etp = (fallbackRows[0].COD_ETP || "").trim();
            console.warn(`⚠️  Using fallback year ${fallbackRows[0].COD_ANU}, COD_ETP=${cod_etp}`);
          } else {
            console.warn(`⚠️  Student COD_IND=${cod_ind} has no ins_adm_etp records at all`);
          }
        }
      } else {
        // No active year — fallback to most recent record for student
        console.warn("⚠️  No active academic year in annee_uni (ETA_ANU_IAE='O'), using fallback…");
        const [fallbackRows] = await poolApo.query(
          `SELECT COD_ETP, COD_ANU
           FROM ins_adm_etp
           WHERE COD_IND = ?
           ORDER BY COD_ANU DESC
           LIMIT 1`,
          [cod_ind]
        );
        if (fallbackRows && fallbackRows.length > 0) {
          cod_etp = (fallbackRows[0].COD_ETP || "").trim();
          console.log(`🎓 Fallback COD_ETP=${cod_etp} from year ${fallbackRows[0].COD_ANU}`);
        }
      }
    } catch (etpErr) {
      console.warn("⚠️  COD_ETP query failed:", etpErr.message);
    }

    console.log(`✅ Apogee ${code} → COD_IND=${cod_ind}, COD_ETP=${cod_etp}`);

    return res.json({
      valid: true,
      student: {
        COD_IND:         String(cod_ind),
        LIB_NOM_PAT_IND: student.LIB_NOM_PAT_IND || "",
        LIB_PR1_IND:     student.LIB_PR1_IND || "",
        CIN_IND:         student.CIN_IND || "",
        COD_ETP:         cod_etp,
      },
    });
  } catch (err) {
    console.error("Apogee query error:", err.message);
    return res.status(500).json({
      valid: false,
      message: "Database query failed: " + err.message,
    });
  }
});

// ─── ROUTE: Get Salles from MySQL ─────────────────────────────────────────────
app.get("/api/salles", async (_req, res) => {
  if (!pgiConnected || !poolPgi) {
    return res.json({
      salles: [],
      offline: true,
      message: "pgi_ensa_db not connected — cannot load salles.",
    });
  }

  try {
    const [rows] = await poolPgi.query(
      `SELECT salle_name, salle_type FROM salle ORDER BY salle_name ASC`
    );

    const salles = rows.map((r) => ({
      id: r.salle_name.replace(/\s+/g, "_").toLowerCase(),
      salle_name: r.salle_name,
      salle_type: r.salle_type || "",
    }));

    console.log(`📋 Loaded ${salles.length} salles from MySQL`);
    return res.json({ salles, offline: false });
  } catch (err) {
    console.error("Salles query error:", err.message);
    return res.status(500).json({
      salles: [],
      offline: true,
      message: "Failed to load salles: " + err.message,
    });
  }
});

// ─── ROUTE: Upload base64 image ───────────────────────────────────────────────
app.post("/api/upload-base64/:apogee/:type", (req, res) => {
  const { apogee, type } = req.params;
  const { imageData }    = req.body;

  if (!["cin", "selfie"].includes(type)) {
    return res.status(400).json({ success: false, message: "Type must be 'cin' or 'selfie'." });
  }
  if (!imageData || imageData.length < 100) {
    return res.status(400).json({ success: false, message: "No valid imageData provided." });
  }

  try {
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
    const buffer     = Buffer.from(base64Data, "base64");

    if (buffer.length < 100) {
      return res.status(400).json({ success: false, message: "Image buffer is too small — capture failed." });
    }

    const studentDir = path.join(uploadsDir, "students", String(apogee));
    fs.mkdirSync(studentDir, { recursive: true });

    const fileName = `${type}.png`;
    const filePath = path.join(studentDir, fileName);
    fs.writeFileSync(filePath, buffer);

    const urlPath  = `/uploads/students/${apogee}/${fileName}`;
    const fileSize = buffer.length;

    console.log(`📸 Saved ${type} for apogee=${apogee} → ${filePath} (${fileSize} bytes)`);

    return res.json({
      success: true,
      path: urlPath,
      size: fileSize,
      message: `${type} image saved successfully.`,
    });
  } catch (err) {
    console.error("Upload error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to save image: " + err.message,
    });
  }
});

// ─── ROUTE: Check if student images exist ─────────────────────────────────────
app.get("/api/student-images/:apogee", (req, res) => {
  const { apogee } = req.params;
  const studentDir = path.join(uploadsDir, "students", String(apogee));

  const cinPath    = path.join(studentDir, "cin.png");
  const selfiePath = path.join(studentDir, "selfie.png");

  res.json({
    cin:    { exists: fs.existsSync(cinPath),    url: `/uploads/students/${apogee}/cin.png` },
    selfie: { exists: fs.existsSync(selfiePath), url: `/uploads/students/${apogee}/selfie.png` },
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`\n🚀 ENSAT-CHECKING API  →  http://localhost:${PORT}`);
  console.log(`📁 Uploads             →  ${uploadsDir}`);
  await initPools();
  console.log("\n─────────────────────────────────────────────────");
  console.log("  Press Ctrl+C to stop");
  console.log("─────────────────────────────────────────────────\n");
});
