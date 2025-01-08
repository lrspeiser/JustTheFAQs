import pkg from "pg";
import fs from "fs-extra";
import path from "path";

const { Client } = pkg;

// Database connection setup
const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

// Directory to save FAQ files
const FAQ_DIR = path.join(process.cwd(), "public/data/faqs");

const slugify = (url) => {
  return url
    .toLowerCase() // Convert to lowercase to ensure case insensitivity
    .split("/")
    .pop()
    .replace(".html", "")
    .replace(/[^a-z0-9]+/g, "-");
};

const regenerateHTMLFiles = async () => {
  try {
    await client.connect();
    console.log("[DB] Connected to the database.");

    // Query to fetch raw FAQs where the corresponding HTML file is missing
    const query = `
      SELECT DISTINCT url, title, human_readable_name, last_updated, subheader, question, answer, cross_link, media_link, image_urls
      FROM raw_faqs
    `;

    const result = await client.query(query);
    console.log(`[DB] Fetched ${result.rows.length} entries.`);

    if (result.rows.length === 0) {
      console.log("[DB] No entries found. Exiting.");
      return;
    }

    // Group raw data by `slug` for each HTML file
    const groupedData = result.rows.reduce((acc, row) => {
      const slug = slugify(row.url);
      if (!acc[slug]) {
        acc[slug] = {
          title: row.title,
          humanReadableName: row.human_readable_name,
          lastUpdated: row.last_updated,
          faqs: [],
        };
      }
      acc[slug].faqs.push({
        subheader: row.subheader,
        question: row.question,
        answer: row.answer,
        cross_links: row.cross_link ? row.cross_link.split(",") : [],
        media_link: row.media_link,
        image_urls: row.image_urls ? row.image_urls.split(", ") : [],
      });
      return acc;
    }, {});

    // Regenerate HTML files
    for (const [slug, data] of Object.entries(groupedData)) {
      const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>FAQs: ${data.humanReadableName}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 16px; }
            h1 { text-align: center; margin-bottom: 24px; }
            .faq-entry { display: flex; align-items: flex-start; margin-bottom: 16px; border-bottom: 1px solid #ddd; padding-bottom: 16px; }
            .faq-content { flex: 1; text-align: left; }
            .faq-subheader { font-weight: bold; margin-bottom: 8px; }
            .faq-question { font-weight: bold; margin: 4px 0; }
            .faq-answer { margin: 4px 0; }
            .faq-links { font-size: 0.9em; margin-top: 8px; }
            .faq-links a { color: #0066cc; text-decoration: none; }
            .faq-links a:hover { text-decoration: underline; }
            img { max-width: 120px; max-height: 120px; margin-left: 16px; border-radius: 8px; }
          </style>
        </head>
        <body>
          <h1>FAQs: ${data.humanReadableName}</h1>
          ${data.faqs
            .map((faq) => {
              const relatedLinks = faq.cross_links.length
                ? `<div class="faq-links">Related topics: ${faq.cross_links
                    .map(
                      (link) =>
                        `<a href="/data/faqs/${slugify(link)}.html">${link.replace(
                          /_/g,
                          " "
                        )}</a>`
                    )
                    .join(", ")}</div>`
                : "";

              const image = faq.image_urls.length
                ? `<img src="${faq.image_urls[0]}" alt="FAQ Image">`
                : "";

              return `
                <div class="faq-entry">
                  <div class="faq-content">
                    <div class="faq-subheader">${faq.subheader || "General"}</div>
                    <div class="faq-question">${faq.question}</div>
                    <div class="faq-answer">${faq.answer}</div>
                    ${relatedLinks}
                  </div>
                  ${image}
                </div>
              `;
            })
            .join("\n")}
        </body>
        </html>
      `;

      const filePath = path.join(FAQ_DIR, `${slug}.html`);
      await fs.ensureDir(FAQ_DIR);
      await fs.writeFile(filePath, htmlContent, "utf8");
      console.log(`[RegenerateHTML] Created: ${filePath}`);
    }

    console.log("[RegenerateHTML] All missing files regenerated.");
  } catch (error) {
    console.error("[RegenerateHTML] Error:", error.message);
  } finally {
    await client.end();
    console.log("[DB] Database connection closed.");
  }
};

regenerateHTMLFiles();
