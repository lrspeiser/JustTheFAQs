import { supabase } from '../../lib/db';

export default async function handler(req, res) {
  console.log("[sitemap] Generating sitemap...");

  try {
    // Query the total number of items in the database
    const { count, error } = await supabase
      .from('faq_files')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error("[sitemap] Supabase error:", error);
      return res.status(500).send("Error fetching data.");
    }

    const PAGE_SIZE = 200;
    const totalPages = Math.ceil(count / PAGE_SIZE);

    // XML sitemap header
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    sitemap += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    // Add main pages
    const mainPages = [
      'https://justthefaqs.org/',
      'https://justthefaqs.org/util/all-pages'
    ];

    mainPages.forEach(url => {
      sitemap += `  <url>\n`;
      sitemap += `    <loc>${url}</loc>\n`;
      sitemap += `    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n`;
      sitemap += `    <changefreq>weekly</changefreq>\n`;
      sitemap += `    <priority>0.9</priority>\n`;
      sitemap += `  </url>\n`;
    });

    // Add paginated pages
    for (let i = 1; i <= totalPages; i++) {
      sitemap += `  <url>\n`;
      sitemap += `    <loc>https://justthefaqs.org/util/all-pages?paged=${i}</loc>\n`;
      sitemap += `    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n`;
      sitemap += `    <changefreq>weekly</changefreq>\n`;
      sitemap += `    <priority>0.8</priority>\n`;
      sitemap += `  </url>\n`;
    }

    sitemap += `</urlset>`;

    // Return sitemap as XML
    res.setHeader('Content-Type', 'application/xml');
    return res.status(200).send(sitemap);
  } catch (err) {
    console.error("[sitemap] Unexpected error:", err);
    return res.status(500).send("Internal server error.");
  }
}
