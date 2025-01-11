import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

client.connect().catch((err) => console.error('[DB] Connection error:', err.message));

export default async function handler(req, res) {
  const { slug } = req.query;

  try {
    // Fetch the FAQ data based on the slug
    const faqQuery = `
      SELECT title, human_readable_name, last_updated, subheader, question, answer, cross_link, media_link
      FROM raw_faqs
      WHERE slug = $1;
    `;
    const { rows } = await client.query(faqQuery, [slug]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'FAQ not found' });
    }

    // Format the data
    const faqs = rows.map((row) => ({
      subheader: row.subheader,
      question: row.question,
      answer: row.answer,
      cross_links: row.cross_link ? row.cross_link.split(',') : [],
      media_links: row.media_link ? [row.media_link] : [],
    }));

    const title = rows[0].title;
    const human_readable_name = rows[0].human_readable_name;

    res.status(200).json({ title, human_readable_name, faqs });
  } catch (error) {
    console.error('[API/FAQ] Error fetching FAQ data:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
