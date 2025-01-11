// generateEmbeddings.js

import { Client } from 'pg';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Database connection setup
const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

client.connect().catch((err) => console.error("[DB] Connection error:", err.message));



async function generateEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('[generateEmbedding] Error:', error.message);
    throw error;
  }
}

async function fetchAndGenerateEmbeddings() {
  try {
    // Start a transaction
    await client.query('BEGIN');

    // Fetch all FAQs that don't have embeddings yet
    const result = await client.query(`
      SELECT r.id, r.question 
      FROM raw_faqs r 
      LEFT JOIN faq_embeddings e ON r.id = e.faq_id 
      WHERE e.id IS NULL
    `);

    console.log(`[fetchAndGenerateEmbeddings] Found ${result.rows.length} FAQs without embeddings`);

    // Process each FAQ
    for (const row of result.rows) {
      try {
        const embedding = await generateEmbedding(row.question);

        await client.query(
          `INSERT INTO faq_embeddings (faq_id, question, embedding) 
           VALUES ($1, $2, $3)`,
          [row.id, row.question, embedding]
        );

        console.log(`[fetchAndGenerateEmbeddings] Generated and saved embedding for FAQ ID: ${row.id}`);
      } catch (error) {
        console.error(`[fetchAndGenerateEmbeddings] Error processing FAQ ID ${row.id}:`, error);
        // Continue with the next FAQ even if one fails
        continue;
      }
    }

    // Commit the transaction
    await client.query('COMMIT');
    console.log('[fetchAndGenerateEmbeddings] Successfully completed embedding generation');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[fetchAndGenerateEmbeddings] Error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the script
fetchAndGenerateEmbeddings()
  .then(() => {
    console.log('[main] Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[main] Script failed:', error);
    process.exit(1);
  });