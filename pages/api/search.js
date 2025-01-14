// pages/api/search.js
import { pipeline } from "@xenova/transformers";
import pool, { withTransaction } from '../../lib/db';

// Embedder initialization with timeout
let embedder = null;
async function initEmbedder() {
  if (!embedder) {
    console.log("[API/Search] Initializing embedder...");
    try {
      const embedderPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
      embedder = await Promise.race([
        embedderPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Embedder initialization timeout")), 10000)
        )
      ]);
      console.log("[API/Search] Embedder initialized.");
    } catch (error) {
      console.error("[API/Search] Embedder initialization failed:", error);
      throw error;
    }
  }
  return embedder;
}

const formatEmbeddingForPg = (embedding) => embedding.join(",");

async function generateEmbedding(embedder, text) {
  try {
    const embeddingPromise = embedder(text, { pooling: "mean", normalize: true });
    const result = await Promise.race([
      embeddingPromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Embedding generation timeout")), 5000)
      )
    ]);
    return Array.from(result.data);
  } catch (error) {
    console.error("[API/Search] Embedding generation failed:", error);
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    console.log("[API/Search] User triggered search.");

    const { query } = req.body;
    if (!query || query.trim().length < 3) {
      return res.status(400).json({ error: "Query must be at least 3 characters long." });
    }
    console.log("[API/Search] User query received:", query);

    // Initialize embedder and generate embedding first
    const localEmbedder = await initEmbedder();
    console.log("[API/Search] Generating embedding for user query...");
    const queryEmbedding = await generateEmbedding(localEmbedder, query);

    // Use withTransaction for database operations
    const searchResults = await withTransaction(async (client) => {
      console.log("[API/Search] Database connection successful.");

      const combinedSearchQuery = `
        WITH semantic_results AS (
          SELECT 
            r.id, 
            r.question, 
            r.answer, 
            r.title,
            r.media_link,
            r.thumbnail_url,
            r.cross_link,
            r.subheader,
            r.human_readable_name,
            f.slug, 
            1 - (e.embedding <=> $1::vector) AS semantic_score,
            CASE 
              WHEN r.question ILIKE $2 OR r.answer ILIKE $2 THEN true
              ELSE false
            END as has_text_match
          FROM 
            faq_embeddings e
          JOIN 
            raw_faqs r ON e.faq_id = r.id
          JOIN 
            faq_files f ON f.human_readable_name = r.human_readable_name
        )
        SELECT 
          *,
          CASE 
            WHEN has_text_match THEN 1.0
            ELSE semantic_score
          END as similarity
        FROM 
          semantic_results
        ORDER BY 
          has_text_match DESC,
          semantic_score DESC
        LIMIT 10;
      `;

      const result = await client.query(combinedSearchQuery, [
        `[${formatEmbeddingForPg(queryEmbedding)}]`,
        `%${query}%`
      ]);

      return result.rows;
    });

    console.log("[API/Search] Search completed successfully");

    const mappedResults = searchResults.map(row => ({
      ...row,
      cross_links: row.cross_link ? row.cross_link.split(',').map(link => link.trim()) : [],
      media_link: row.thumbnail_url || row.media_link,
      debug_info: {
        semantic_score: row.semantic_score,
        has_text_match: row.has_text_match,
        final_score: row.similarity
      }
    }));

    res.status(200).json(mappedResults);

  } catch (error) {
    console.error("[API/Search] Error occurred during execution:", error.message);
    console.error("[API/Search] Stack trace:", error.stack);
    res.status(500).json({ 
      error: error.message || "Internal server error",
      details: error.stack
    });
  } finally {
    console.log("[API/Search] Handler execution completed.");
  }
}