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
let poolApo      = null;
let poolPgi      = null;
let poolEdt      = null;
let apoConnected = false;
let pgiConnected = false;
let edtConnected = false;
let apoError     = null;
let pgiError     = null;
let edtError     = null;

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

  // ensat_apo
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

  // pgi_ensa_db
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

  // EDT database
  const edtDb = process.env.EDT_DATABASE || "ensat_edt-25-26_ac";
  try {
    poolEdt      = await createPool(edtDb);
    edtConnected = true;
    edtError     = null;
    console.log(`✅ MySQL connected → ${edtDb}`);
  } catch (err) {
    edtConnected = false;
    edtError     = err.message;
    poolEdt      = null;
    console.error(`❌ ${edtDb} FAILED:`, err.message);
  }
}

// ─── ROUTE: Health ────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    db_apo: apoConnected ? "connected" : "disconnected",
    db_pgi: pgiConnected ? "connected" : "disconnected",
    db_edt: edtConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// ─── ROUTE: DB Status ─────────────────────────────────────────────────────────
app.get("/api/db-status", (_req, res) => {
  res.json({
    connected: apoConnected && pgiConnected && edtConnected,
    apo: { connected: apoConnected, error: apoError },
    pgi: { connected: pgiConnected, error: pgiError },
    edt: { connected: edtConnected, error: edtError },
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: process.env.MYSQL_PORT || "3306",
    user: process.env.MYSQL_USER || "root",
  });
});

// ─── ROUTE: DB Reconnect ──────────────────────────────────────────────────────
app.post("/api/db-reconnect", async (_req, res) => {
  poolApo = null; poolPgi = null; poolEdt = null;
  apoConnected = false; pgiConnected = false; edtConnected = false;
  apoError = null; pgiError = null; edtError = null;
  await initPools();
  res.json({
    connected: apoConnected && pgiConnected && edtConnected,
    apo: { connected: apoConnected, error: apoError },
    pgi: { connected: pgiConnected, error: pgiError },
    edt: { connected: edtConnected, error: edtError },
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

    let cod_etp = "";
    try {
      const [yearRows] = await poolApo.query(
        `SELECT COD_ANU FROM annee_uni WHERE TRIM(ETA_ANU_IAE) = 'O' ORDER BY COD_ANU DESC LIMIT 1`
      );

      if (yearRows && yearRows.length > 0) {
        const activeYear = yearRows[0].COD_ANU;

        const [etpRows] = await poolApo.query(
          `SELECT COD_ETP FROM ins_adm_etp WHERE COD_IND = ? AND COD_ANU = ? LIMIT 1`,
          [cod_ind, activeYear]
        );

        if (etpRows && etpRows.length > 0) {
          cod_etp = (etpRows[0].COD_ETP || "").trim();
        } else {
          const [fallbackRows] = await poolApo.query(
            `SELECT COD_ETP, COD_ANU FROM ins_adm_etp WHERE COD_IND = ? ORDER BY COD_ANU DESC LIMIT 1`,
            [cod_ind]
          );
          if (fallbackRows && fallbackRows.length > 0) {
            cod_etp = (fallbackRows[0].COD_ETP || "").trim();
          }
        }
      } else {
        const [fallbackRows] = await poolApo.query(
          `SELECT COD_ETP, COD_ANU FROM ins_adm_etp WHERE COD_IND = ? ORDER BY COD_ANU DESC LIMIT 1`,
          [cod_ind]
        );
        if (fallbackRows && fallbackRows.length > 0) {
          cod_etp = (fallbackRows[0].COD_ETP || "").trim();
        }
      }
    } catch (etpErr) {
      console.warn("⚠️  COD_ETP query failed:", etpErr.message);
    }

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
      id:         r.salle_name.replace(/\s+/g, "_").toLowerCase(),
      salle_name: r.salle_name,
      salle_type: r.salle_type || "",
    }));

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
//
// Handles three types:
//   cin      → uploads/students/<apogee>/cin.png
//   selfie   → uploads/students/<apogee>/selfie.png
//   scan_face→ uploads/students/<apogee>/scan_faces/<clientFilename || timestamp>.jpg
//
app.post("/api/upload-base64/:apogee/:type", (req, res) => {
  const { apogee, type }                   = req.params;
  const { imageData, filename: clientFilename } = req.body;







  
  console.log(`📸 [upload request] type=${type}, apogee=${apogee}, dataLength=${imageData?.length || 0}, filename=${clientFilename || 'none'}`);

  const ALLOWED_TYPES = ["cin", "selfie", "scan_face"];
  if (!ALLOWED_TYPES.includes(type)) {
    return res.status(400).json({ success: false, message: `Unknown type: ${type}.` });
  }
  if (!imageData || imageData.length < 100) {
    console.error(`❌ [upload] Rejected: imageData too short (${imageData?.length || 0} chars)`);
    return res.status(400).json({ success: false, message: "No valid imageData provided." });
  }


  try {
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
    const buffer     = Buffer.from(base64Data, "base64");

    if (buffer.length < 100) {
      return res.status(400).json({ success: false, message: "Image buffer is too small." });
    }

    let absolutePath;
    let relativePath;

    if (type === "scan_face") {
      // ── Scan-face: store in student's dedicated scan_faces/ subfolder ──────
      // Use the rich filename sent by the client:
      //   e.g. 2025-03-24_seance3_SALLE-A3_1711234567890.jpg
      // Falls back to a bare timestamp if client didn't send one.
      const fname  = clientFilename || `${Date.now()}.jpg`;
      const folder = path.join(uploadsDir, "students", String(apogee), "scan_faces");
      fs.mkdirSync(folder, { recursive: true });
      absolutePath = path.join(folder, fname);
      relativePath = `/uploads/students/${apogee}/scan_faces/${fname}`;
    } else {
      // ── cin / selfie: stored directly in student folder ───────────────────
      const folder = path.join(uploadsDir, "students", String(apogee));
      fs.mkdirSync(folder, { recursive: true });
      const fname  = `${type}.png`;
      absolutePath = path.join(folder, fname);
      relativePath = `/uploads/students/${apogee}/${fname}`;
    }

    fs.writeFileSync(absolutePath, buffer);

    console.log(`📸 [upload] ${type} for apogee=${apogee} → ${relativePath} (${buffer.length} bytes)`);

    return res.json({
      success: true,
      path:    relativePath,
      size:    buffer.length,
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
  const { apogee }  = req.params;
  const studentDir  = path.join(uploadsDir, "students", String(apogee));
  const cinPath     = path.join(studentDir, "cin.png");
  const selfiePath  = path.join(studentDir, "selfie.png");
  const scanFaceDir = path.join(studentDir, "scan_faces");

  // List existing scan_face files if folder exists
  let scanFaces = [];
  if (fs.existsSync(scanFaceDir)) {
    scanFaces = fs.readdirSync(scanFaceDir).map((f) => ({
      filename: f,
      url:      `/uploads/students/${apogee}/scan_faces/${f}`,
    }));
  }

  res.json({
    cin:    { exists: fs.existsSync(cinPath),    url: `/uploads/students/${apogee}/cin.png` },
    selfie: { exists: fs.existsSync(selfiePath), url: `/uploads/students/${apogee}/selfie.png` },
    scanFaces,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PROFESSOR / EDT ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── ROUTE: Prof Login ────────────────────────────────────────────────────────
app.post("/api/prof/login", async (req, res) => {
  const { identifiant, password } = req.body;

  if (!identifiant || !password) {
    return res.status(400).json({ success: false, message: "Identifiant and password are required." });
  }

  if (!edtConnected || !poolEdt) {
    return res.status(503).json({
      success: false,
      message: `EDT database not connected. ${edtError ? "Error: " + edtError : ""}`,
    });
  }

  try {
    const [rows] = await poolEdt.query(
      `SELECT codeProf, nom, prenom, identifiant, email, specialite
       FROM ressources_profs
       WHERE identifiant = ? AND deleted = 0
       LIMIT 1`,
      [identifiant.trim()]
    );

    if (!rows || rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "No professor found with this PPR code.",
      });
    }

    const prof = rows[0];

    console.log(`✅ Prof login: ${prof.nom} ${prof.prenom} (PPR: ${identifiant}, codeProf: ${prof.codeProf})`);

    return res.json({
      success: true,
      prof: {
        codeProf:    prof.codeProf,
        nom:         prof.nom,
        prenom:      prof.prenom,
        identifiant: prof.identifiant,
        email:       prof.email || "",
        specialite:  prof.specialite || 0,
      },
    });
  } catch (err) {
    console.error("Prof login error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Database error: " + err.message,
    });
  }
});

// ─── ROUTE: Prof Timetable (week view) ────────────────────────────────────────
app.get("/api/prof/:codeProf/timetable", async (req, res) => {
  const { codeProf }    = req.params;
  const { week, year }  = req.query;

  if (!edtConnected || !poolEdt) {
    return res.status(503).json({
      success: false,
      message: "EDT database not connected.",
      sessions: [],
    });
  }

  try {
    const currentYear = parseInt(year) || new Date().getFullYear();
    const currentWeek = parseInt(week) || getISOWeek(new Date());

    const monday = getMondayOfWeek(currentYear, currentWeek);
    const days   = [];
    for (let d = 0; d < 6; d++) {
      const date = new Date(monday);
      date.setDate(date.getDate() + d);
      days.push(date.toISOString().split("T")[0]);
    }

    const startDate = days[0];
    const endDate   = days[5];

    console.log(`📅 Timetable for codeProf=${codeProf}, week=${currentWeek}, year=${currentYear}, ${startDate} → ${endDate}`);

    const [sessions] = await poolEdt.query(
      `SELECT 
         s.codeSeance,
         s.dateSeance,
         s.heureSeance,
         s.dureeSeance,
         s.commentaire,
         s.codeEnseignement,
         e.nom AS enseignement_nom,
         e.alias AS enseignement_alias,
         e.codeTypeActivite,
         m.nom AS matiere_nom,
         m.alias AS matiere_alias,
         m.codeMatiere,
         m.couleurFond AS matiere_couleur
       FROM seances_profs sp
       JOIN seances s ON sp.codeSeance = s.codeSeance
       LEFT JOIN enseignements e ON s.codeEnseignement = e.codeEnseignement
       LEFT JOIN matieres m ON e.codeMatiere = m.codeMatiere
       WHERE sp.codeRessource = ?
         AND sp.deleted = 0
         AND s.deleted = 0
         AND s.dateSeance >= ?
         AND s.dateSeance <= ?
       ORDER BY s.dateSeance ASC, s.heureSeance ASC`,
      [codeProf, startDate, endDate]
    );

    const enrichedSessions = [];

    for (const session of sessions) {
      const [salles] = await poolEdt.query(
        `SELECT rs.codeSalle, rs.nom AS salle_nom, rs.alias AS salle_alias
         FROM seances_salles ss
         JOIN ressources_salles rs ON ss.codeRessource = rs.codeSalle
         WHERE ss.codeSeance = ? AND ss.deleted = 0 AND rs.deleted = 0
         ORDER BY rs.nom`,
        [session.codeSeance]
      );

      const [groupes] = await poolEdt.query(
        `SELECT rg.codeGroupe, rg.nom AS groupe_nom, rg.alias AS groupe_alias
         FROM seances_groupes sg
         JOIN ressources_groupes rg ON sg.codeRessource = rg.codeGroupe
         WHERE sg.codeSeance = ? AND sg.deleted = 0 AND rg.deleted = 0
         ORDER BY rg.nom`,
        [session.codeSeance]
      );

      let typeLabel = "";
      if (session.codeTypeActivite) {
        const [types] = await poolEdt.query(
          `SELECT alias FROM types_activites WHERE codeTypeActivite = ? LIMIT 1`,
          [session.codeTypeActivite]
        );
        if (types.length > 0) typeLabel = types[0].alias;
      }

      // Parse time: heureSeance=900 → "09:00", heureSeance=1045 → "10:45"
      const heureStr  = String(session.heureSeance).padStart(4, "0");
      const startHour = heureStr.substring(0, heureStr.length - 2);
      const startMin  = heureStr.substring(heureStr.length - 2);
      const startTime = `${startHour.padStart(2, "0")}:${startMin}`;

      // Parse duration: dureeSeance=130 → 1h30
      const dureeStr = String(session.dureeSeance).padStart(4, "0");
      const durHour  = parseInt(dureeStr.substring(0, dureeStr.length - 2)) || 0;
      const durMin   = parseInt(dureeStr.substring(dureeStr.length - 2)) || 0;

      const totalStartMin = parseInt(startHour) * 60 + parseInt(startMin);
      const totalEndMin   = totalStartMin + durHour * 60 + durMin;
      const endHour       = Math.floor(totalEndMin / 60);
      const endMin        = totalEndMin % 60;
      const endTime       = `${String(endHour).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`;

      // Parse enseignement name — extract between first two underscores
      let displayName = session.matiere_nom || "";
      const parts     = (session.enseignement_nom || "").split("_");
      if (parts.length >= 2) {
        displayName = parts[1] || parts[0];
      }

      enrichedSessions.push({
        codeSeance:        session.codeSeance,
        date:              session.dateSeance instanceof Date
                             ? session.dateSeance.toISOString().split("T")[0]
                             : String(session.dateSeance),
        startTime,
        endTime,
        duration:          `${durHour}h${String(durMin).padStart(2, "0")}`,
        durationMinutes:   durHour * 60 + durMin,
        matiere:           session.matiere_nom || "",
        matiereAlias:      session.matiere_alias || "",
        enseignement:      session.enseignement_nom || "",
        enseignementAlias: session.enseignement_alias || "",
        displayName,
        typeActivite:      typeLabel,
        codeTypeActivite:  session.codeTypeActivite,
        commentaire:       session.commentaire || "",
        couleur:           session.matiere_couleur || 16777215,
        salles:            salles.map(s => ({
          codeSalle: s.codeSalle,
          nom:       s.salle_nom,
          alias:     s.salle_alias || s.salle_nom,
        })),
        groupes:           groupes.map(g => ({
          codeGroupe: g.codeGroupe,
          nom:        g.groupe_nom,
          alias:      g.groupe_alias || g.groupe_nom,
        })),
      });
    }

    return res.json({
      success:  true,
      week:     currentWeek,
      year:     currentYear,
      monday:   startDate,
      saturday: endDate,
      sessions: enrichedSessions,
    });
  } catch (err) {
    console.error("Timetable query error:", err.message);
    return res.status(500).json({
      success:  false,
      message:  "Failed to load timetable: " + err.message,
      sessions: [],
    });
  }
});

// ─── ROUTE: Prof Matieres ─────────────────────────────────────────────────────
app.get("/api/prof/:codeProf/matieres", async (req, res) => {
  const { codeProf } = req.params;

  if (!edtConnected || !poolEdt) {
    return res.status(503).json({ success: false, matieres: [] });
  }

  try {
    const [rows] = await poolEdt.query(
      `SELECT DISTINCT m.codeMatiere, m.nom, m.alias, m.couleurFond
       FROM seances_profs sp
       JOIN seances s ON sp.codeSeance = s.codeSeance
       JOIN enseignements e ON s.codeEnseignement = e.codeEnseignement
       JOIN matieres m ON e.codeMatiere = m.codeMatiere
       WHERE sp.codeRessource = ?
         AND sp.deleted = 0
         AND s.deleted = 0
         AND e.deleted = 0
         AND m.deleted = 0
       ORDER BY m.nom`,
      [codeProf]
    );

    return res.json({
      success:  true,
      matieres: rows.map(r => ({
        codeMatiere: r.codeMatiere,
        nom:         r.nom,
        alias:       r.alias,
        couleur:     r.couleurFond,
      })),
    });
  } catch (err) {
    console.error("Matieres query error:", err.message);
    return res.status(500).json({ success: false, matieres: [] });
  }
});

// ─── Helper: ISO week number ──────────────────────────────────────────────────
function getISOWeek(date) {
  const d      = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ─── Helper: Monday of ISO week ───────────────────────────────────────────────
function getMondayOfWeek(year, week) {
  const jan4      = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday    = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
  return monday;
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`\n🚀 ENSAT-CHECKING API  →  http://localhost:${PORT}`);
  console.log(`📁 Uploads             →  ${uploadsDir}`);
  await initPools();
  console.log("\n─────────────────────────────────────────────────");
  console.log("  Press Ctrl+C to stop");
  console.log("─────────────────────────────────────────────────\n");
});