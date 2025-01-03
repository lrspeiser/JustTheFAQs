import pkg from "pg";

const { Client } = pkg;

// Database connection setup
const client = new Client({
  connectionString: process.env.DATABASE_URL, // Replit provides this automatically
});

const clearDatabase = async () => {
  try {
    await client.connect();
    console.log("[DB] Connected to database.");

    // Clear the `faq_files` table
    await client.query("DELETE FROM faq_files");
    console.log("[DB] Cleared `faq_files` table.");

    // Reset the primary key sequence for `faq_files`
    await client.query("ALTER SEQUENCE faq_files_id_seq RESTART WITH 1");
    console.log("[DB] Reset primary key sequence for `faq_files`.");

    // Clear the `raw_faqs` table
    await client.query("DELETE FROM raw_faqs");
    console.log("[DB] Cleared `raw_faqs` table.");

    // Reset the primary key sequence for `raw_faqs`
    await client.query("ALTER SEQUENCE raw_faqs_id_seq RESTART WITH 1");
    console.log("[DB] Reset primary key sequence for `raw_faqs`.");
  } catch (err) {
    console.error("[DB] Error clearing database:", err.message);
  } finally {
    await client.end();
    console.log("[DB] Connection closed.");
  }
};

clearDatabase();
