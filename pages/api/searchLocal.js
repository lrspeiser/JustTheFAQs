import { Client } from "pg";

export default async function handler(req, res) {
  console.log("[Server/handler] Handler invoked. Method:", req.method);

  // Check if the HTTP method is POST
  if (req.method !== "POST") {
    console.warn("[Server/handler] Invalid method:", req.method);
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Log incoming request body
  console.log("[Server/handler] Request body received:", req.body);

  const { embedding } = req.body;

  // Validate the embedding
  if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
    console.error("[Server/handler] Invalid embedding:", embedding);
    return res.status(400).json({ message: "Valid embedding is required" });
  }

  console.log("[Server/handler] Embedding validated. Length:", embedding.length);

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log("[Server/handler] Connecting to database...");
    await client.connect();
    console.log("[Server/handler] Connected to database.");

    // Define the query for vector similarity search
    const query = `
      SELECT 
        e.id,
        e.question,
        r.human_readable_name,
        f.slug,
        1 - (e.embedding <=> $1) AS similarity
      FROM 
        faq_embeddings e
        JOIN raw_faqs r ON e.faq_id = r.id
        JOIN faq_files f ON r.title = f.slug
      WHERE 
        e.embedding <=> $1 < 0.8
      ORDER BY 
        similarity DESC
      LIMIT 5;
    `;

    console.log("[Server/handler] Performing similarity search...");
    console.log("[Server/handler] Query:", query);
    console.log("[Server/handler] Query parameters:", [embedding]);

    // Execute the query
    const result = await client.query(query, [embedding]);
    console.log("[Server/handler] Query executed successfully.");
    console.log("[Server/handler] Rows fetched:", result.rows.length);
    console.log("[Server/handler] Rows data:", result.rows);

    // Map results to response format
    const mappedResults = result.rows.map((row) => ({
      id: row.id,
      question: row.question,
      human_readable_name: row.human_readable_name,
      slug: row.slug,
      similarity: row.similarity,
    }));
    console.log("[Server/handler] Mapped results for response:", mappedResults);

    res.status(200).json({ results: mappedResults });
  } catch (error) {
    console.error("[Server/handler] Search error:", error);
    res.status(500).json({ message: "Error performing search", error: error.message });
  } finally {
    console.log("[Server/handler] Closing database connection...");
    await client.end();
    console.log("[Server/handler] Database connection closed.");
  }
}
