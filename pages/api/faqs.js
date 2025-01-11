import { Client } from "pg";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log("[API] Connected to the database.");

    const query = `
      SELECT id, question, answer 
      FROM raw_faqs 
      ORDER BY created_at DESC 
      LIMIT 10;
    `;
    console.log("[API] Executing query:", query);

    const result = await client.query(query);
    console.log("[API] Query result:", result.rows);

    res.status(200).json(result.rows);
  } catch (error) {
    console.error("[API] Error fetching FAQs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    await client.end();
    console.log("[API] Database connection closed.");
  }
}
