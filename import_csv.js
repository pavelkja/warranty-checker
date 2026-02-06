import fs from "fs";
import sqlite3 from "sqlite3";

const DB_FILE = "./data/warranty.db";

// ==========================
// HLAVNÍ IMPORT FUNKCE
// ==========================
export function importCsv(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_FILE, err => {
      if (err) {
        return reject(err);
      }
    });

    // ==========================
    // INICIALIZACE DB
    // ==========================
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

    // ==========================
    // POMOCNÉ FUNKCE
    // ==========================
    function detectDelimiter(line) {
      return line.includes(";") ? ";" : ",";
    }

    function cleanHeader(h) {
      return h.replace(/^\uFEFF/, "").trim();
    }

    // ==========================
    // ČTENÍ CSV
    // ==========================
    fs.readFile(filePath, "utf-8", (err, content) => {
      if (err) {
        db.close();
        return reject(err);
      }

      const lines = content
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

      if (lines.length < 2) {
        db.close();
        return reject(new Error("CSV is empty or invalid"));
      }

      const delimiter = detectDelimiter(lines[0]);

      const headers = lines[0]
        .split(delimiter)
        .map(cleanHeader);

      const index = {
        serial_number: headers.indexOf("serial_number"),
        product_model: headers.indexOf("product_model"),
        purchase_date: headers.indexOf("purchase_date"),
        registration_date: headers.indexOf("registration_date"),
        country: headers.indexOf("country"),
        source_note: headers.indexOf("source_note")
      };

      if (index.serial_number === -1 || index.registration_date === -1) {
        db.close();
        return reject(new Error("Required columns not found in CSV header"));
      }

      let inserted = 0;
      let skipped = 0;

      // ==========================
      // IMPORT DAT
      // ==========================
      db.serialize(() => {
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

          const rawSerial = cols[index.serial_number];
          const rawRegDate = cols[index.registration_date];

          if (!rawSerial || !rawRegDate) {
            skipped++;
            continue;
          }

          // 🔑 NORMALIZACE SÉRIOVÉHO ČÍSLA
          const serial = rawSerial
            .replace(/\s+/g, "")
            .toUpperCase();

          const regDate = rawRegDate.trim();

          if (!serial || !regDate) {
            skipped++;
            continue;
          }

          stmt.run(
            serial,
            cols[index.product_model]?.trim() || null,
            cols[index.purchase_date]?.trim() || null,
            regDate,
            cols[index.country]?.trim() || null,
            cols[index.source_note]?.trim() || null
          );

          inserted++;
        }

        stmt.finalize(err => {
          db.close();

          if (err) {
            return reject(err);
          }

          resolve({
            inserted,
            skipped
          });
        });
      });
    });
  });
}


