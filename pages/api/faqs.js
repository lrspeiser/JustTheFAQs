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
    console.log("[API/faqs.js] ✅ Connected to the database.");

    const query = `
      SELECT id, question, answer, thumbnail_url, cross_link 
      FROM raw_faqs 
      ORDER BY created_at DESC 
      LIMIT 10;
    `;
    console.log("[API/faqs.js] 🔍 Executing query:", query);

    const result = await client.query(query);
    console.log("[API/faqs.js] 📊 Query result:", result.rows);

    // 🔹 Format results to include cross_links as an array
    const formattedResults = result.rows.map(faq => ({
      id: faq.id,
      question: faq.question,
      answer: faq.answer,
      thumbnail_url: faq.thumbnail_url || "", // Ensure we always return a string
      cross_links: faq.cross_link ? faq.cross_link.split(",") : [] // Convert CSV string to array
    }));

    console.log("[API/faqs.js] ✅ Returning formatted results.");
    res.status(200).json(formattedResults);
  } catch (error) {
    console.error("[API/faqs.js] ❌ Error fetching FAQs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    await client.end();
    console.log("[API/faqs.js] 🔴 Database connection closed.");
  }
}
