import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

client.connect().catch((err) => console.error('[DB] Connection error:', err.message));

export default async function handler(req, res) {
  const { slug } = req.query;

  try {
    // Join faq_files with raw_faqs to fetch the necessary data
    const query = `
      SELECT 
        r.title, 
        r.human_readable_name, 
        r.last_updated, 
        r.subheader, 
        r.question, 
        r.answer, 
        r.cross_link, 
        r.media_link
      FROM 
        faq_files f
      INNER JOIN 
        raw_faqs r 
      ON 
        f.human_readable_name = r.human_readable_name
      WHERE 
        f.slug = $1;
    `;
    const { rows } = await client.query(query, [slug]);

    if (rows.length === 0) {
      return res.status(404).json({ error: `FAQ not found for slug: ${slug}` });
    }

    // Format the response
    const faqs = rows.map((row) => ({
      subheader: row.subheader,
      question: row.question,
      answer: row.answer,
      cross_links: row.cross_link ? row.cross_link.split(',') : [],
      media_links: row.media_link ? [row.media_link] : [],
    }));

    res.status(200).json({
      title: rows[0].title,
      human_readable_name: rows[0].human_readable_name,
      faqs,
    });
  } catch (error) {
    console.error('[API/FAQ] Error fetching FAQ data:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}