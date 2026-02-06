console.log("INDEX.JS LOADED");

import express from "express";
import sqlite3 from "sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { importCsv } from "./import_csv.js";

const app = express();
const PORT = process.env.PORT || 5000;

// ==========================
// ES MODULES __dirname
// ==========================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================
// STATICKÉ SOUBORY + FRONTEND
// ==========================
app.use(express.static(path.join(__dirname, "public")));

// ==========================
// SQLITE DATABÁZE
// ==========================
const db = new sqlite3.Database("./data/warranty.db", (err) => {
  if (err) {
    console.error("Chyba při otevření DB:", err.message);
  } else {
    console.log("Databáze připravena");
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS warranty_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_number TEXT NOT NULL,
      product_model TEXT,
      purchase_date TEXT,
      registration_date TEXT,
      country TEXT,
      source_note TEXT,
      imported_at TEXT
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_serial_number
    ON warranty_registrations(serial_number)
  `);
});

db.run(`
  CREATE TABLE IF NOT EXISTS import_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    imported_at TEXT
  )
`);

// ==========================
// ADMIN – TEST IMPORT (DOČASNÉ)
// ==========================
app.get("/admin/test-import", async (req, res) => {
  try {
    await importCsv("./warranty_import.csv");
    res.send("Import spuštěn (test)");
  } catch (e) {
    console.error(e);
    res.status(500).send("Chyba při importu");
  }
});

// ==========================
// API
// ==========================
app.get("/api/check", (req, res) => {
  const serial = (req.query.serial || "").trim().toUpperCase();

  if (!serial) {
    return res.status(400).json({ error: "Chybí sériové číslo" });
  }

  db.all(
    `
    SELECT
      id,
      serial_number,
      product_model,
      purchase_date,
      registration_date,
      country,
      source_note
    FROM warranty_registrations
    WHERE UPPER(serial_number) = ?
    ORDER BY registration_date DESC
    `,
    [serial],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Chyba databáze" });
      }

      res.json(rows);
    }
  );
});

// ==========================
// CSV IMPORT – INTERNÍ LOGIKA
// ==========================
function detectDelimiter(line) {
  return line.includes(";") ? ";" : ",";
}

function cleanHeader(h) {
  return h.replace(/^\uFEFF/, "").trim();
}

function importCsvFile(csvPath, filename) {
  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.split("\n").filter(l => l.trim() !== "");
  if (lines.length < 2) return;

  const delimiter = detectDelimiter(lines[0]);
  const headers = lines[0].split(delimiter).map(cleanHeader);

  const index = {
    serial_number: headers.indexOf("serial_number"),
    product_model: headers.indexOf("product_model"),
    purchase_date: headers.indexOf("purchase_date"),
    registration_date: headers.indexOf("registration_date"),
    country: headers.indexOf("country"),
    source_note: headers.indexOf("source_note")
  };

  if (index.serial_number === -1 || index.registration_date === -1) return;

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    const stmt = db.prepare(`
      INSERT INTO warranty_registrations (
        serial_number,
        product_model,
        purchase_date,
        registration_date,
        country,
        source_note,
        imported_at
      )
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delimiter);
      const serial = cols[index.serial_number]?.trim();
      const regDate =
        cols[index.registration_date]?.trim() ||
        cols[index.purchase_date]?.trim();

      if (!serial || !regDate) continue;

      stmt.run(
        serial,
        cols[index.product_model]?.trim() || null,
        cols[index.purchase_date]?.trim() || null,
        regDate,
        cols[index.country]?.trim() || null,
        cols[index.source_note]?.trim() || null
      );
    }

    stmt.finalize(() => db.run("COMMIT"));
  });
}

// ==========================
// IMPORT PŘI STARTU (LEGACY)
// ==========================
function runPendingImports() {
  const importsDir = path.join(__dirname, "new_imports");
  if (!fs.existsSync(importsDir)) return;

  const files = fs.readdirSync(importsDir).filter(f =>
    f.toLowerCase().endsWith(".csv")
  );

  if (files.length === 0) return;

  db.all(`SELECT filename FROM import_log`, (err, rows) => {
    if (err) return;
    const importedFiles = new Set(rows.map(r => r.filename));
    for (const file of files) {
      if (importedFiles.has(file)) continue;
      importCsvFile(path.join(importsDir, file), file);
    }
  });
}

runPendingImports();


// ==========================
// START SERVERU
// ==========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server běží na portu ${PORT}`);
});
