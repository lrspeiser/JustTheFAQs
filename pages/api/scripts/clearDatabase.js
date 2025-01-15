import pkg from "pg";
const { Client } = pkg;

// Database connection setup
const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

const clearDatabase = async () => {
  try {
    await client.connect();
    console.log("[DB] Connected to database.");

    // Begin transaction
    await client.query('BEGIN');

    try {
      // Clear the faq_embeddings table first (because it depends on raw_faqs)
      await client.query("DELETE FROM faq_embeddings");
      console.log("[DB] Cleared `faq_embeddings` table.");
      await client.query("ALTER SEQUENCE faq_embeddings_id_seq RESTART WITH 1");
      console.log("[DB] Reset primary key sequence for `faq_embeddings`.");

      // Clear the raw_faqs table
      await client.query("DELETE FROM raw_faqs");
      console.log("[DB] Cleared `raw_faqs` table.");
      await client.query("ALTER SEQUENCE raw_faqs_id_seq RESTART WITH 1");
      console.log("[DB] Reset primary key sequence for `raw_faqs`.");

      // Clear the faq_files table
      await client.query("DELETE FROM faq_files");
      console.log("[DB] Cleared `faq_files` table.");
      await client.query("ALTER SEQUENCE faq_files_id_seq RESTART WITH 1");
      console.log("[DB] Reset primary key sequence for `faq_files`.");

      // Commit transaction
      await client.query('COMMIT');
      console.log("[DB] All tables cleared and sequences reset successfully.");

    } catch (error) {
      // Rollback transaction on error
      await client.query('ROLLBACK');
      console.error("[DB] Error during table clearing:", error.message);
      throw error;
    }

  } catch (err) {
    console.error("[DB] Error clearing database:", err.message);
  } finally {
    await client.end();
    console.log("[DB] Connection closed.");
  }
};

clearDatabase();