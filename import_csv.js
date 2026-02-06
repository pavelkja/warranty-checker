import fs from "fs";
import sqlite3 from "sqlite3";

const CSV_FILE = "./warranty_import.csv"; // název tvého CSV
const DB_FILE = "./warranty.db";

const db = new sqlite3.Database(DB_FILE);

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

// detekce oddělovače
function detectDelimiter(headerLine) {
  if (headerLine.includes(";")) return ";";
  return ",";
}

// odstranění BOM
function cleanHeader(header) {
  return header.replace(/^\uFEFF/, "").trim();
}

fs.readFile(CSV_FILE, "utf-8", (err, content) => {
  if (err) {
    console.error("Cannot read CSV:", err.message);
    process.exit(1);
  }

  const lines = content.split("\n").filter(l => l.trim() !== "");
  if (lines.length < 2) {
    console.error("CSV is empty or invalid");
    process.exit(1);
  }

  const delimiter = detectDelimiter(lines[0]);
  console.log(`Detected delimiter: "${delimiter}"`);

  // HLAVIČKA
  const headers = lines[0]
    .split(delimiter)
    .map(h => cleanHeader(h));

  console.log("Detected headers:", headers);

  const index = {
    serial_number: headers.indexOf("serial_number"),
    product_model: headers.indexOf("product_model"),
    purchase_date: headers.indexOf("purchase_date"),
    registration_date: headers.indexOf("registration_date"),
    country: headers.indexOf("country"),
    source_note: headers.indexOf("source_note")
  };

  if (index.serial_number === -1 || index.registration_date === -1) {
    console.error("Required columns not found in CSV header");
    process.exit(1);
  }

  let inserted = 0;
  let skipped = 0;

  db.serialize(() => {
    const stmt = db.prepare(`
      INSERT INTO warranty_registrations
      (
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
      const regDate = cols[index.registration_date]?.trim();

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

    stmt.finalize(() => {
      console.log(`Import finished.`);
      console.log(`Inserted rows: ${inserted}`);
      console.log(`Skipped rows: ${skipped}`);
      db.close();
    });
  });
});
