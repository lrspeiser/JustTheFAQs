import axios from "axios";
import fs from "fs-extra";
import path from "path";
import pkg from "pg";
const { Client } = pkg;
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
});

// Database connection setup
const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

client.connect().catch((err) => console.error("[DB] Connection error:", err.message));

// Directory to save FAQ files
const FAQ_DIR = path.join(process.cwd(), "public/data/faqs");

// Define tools for OpenAI function calling
const tools = [
  {
    type: "function",
    function: {
      name: "generate_structured_faqs",
      description: `Generate structured FAQs with subheaders, cross-links, and media links from Wikipedia content. I want to rewrite content from a Wikipedia page in a Q&A format, making it engaging, informative, and concise. The goal is to present the most important concepts as direct questions followed by insightful answers. Use the following guidelines:

      1. Identify the core concepts from the source content.
      2. Frame each concept as a clear, focused question that an average reader might ask.
      3. Provide an accurate and well-structured answer, incorporating relevant details to enhance understanding without repeating content word-for-word.
      4. Use subcategories and examples where relevant to break down complex answers into simpler parts.
      5. Avoid unnecessary jargon and keep explanations clear for a non-specialist audience.

      Here’s an example format for reference:
      What is a leveraged buyout?
      A leveraged buyout (LBO) is a transaction where a company’s assets or stock are purchased primarily using borrowed funds, resulting in a capital structure dominated by debt. This is often executed through a new entity created by the buyer, followed by a merger to secure the target company’s assets. There are various forms of LBOs, such as management buyouts (MBOs), where existing managers become shareholders, and employee buyouts (EBOs), where employees use funds from an ESOP (employee stock ownership plan) to acquire the company.`,
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The title of the Wikipedia page." },
          human_readable_name: { type: "string", description: "The human-readable page name." },
          last_updated: { type: "string", description: "The last update timestamp of the page." },
          faqs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                subheader: { type: "string", description: "The subheader under which this FAQ falls." },
                question: { type: "string", description: "A question derived from the content." },
                answer: { type: "string", description: "The answer to the question." },
                cross_links: {
                  type: "array",
                  items: { type: "string", description: "Relevant cross-links from Wikipedia." },
                  description: "Cross-links for the FAQ derived from the section.",
                },
                media_links: {
                  type: "array",
                  items: { type: "string", description: "Relevant media links from the content." },
                  description: "Media links (e.g., images) relevant to the Q&A.",
                },
              },
              required: ["subheader", "question", "answer"],
            },
            description: "A list of FAQs organized by subheaders.",
          },
        },
        required: ["title", "human_readable_name", "last_updated", "faqs"],
      },
    },
  },
];



// Fetch Wikipedia metadata
const fetchWikipediaMetadata = async (title) => {
  const endpoint = `https://en.wikipedia.org/w/api.php`;
  const params = {
    action: "query",
    prop: "revisions|info",
    titles: title,
    rvprop: "timestamp",
    format: "json",
  };

  try {
    const response = await axios.get(endpoint, { params });
    const page = Object.values(response.data.query.pages)[0];
    const lastUpdated = page?.revisions?.[0]?.timestamp || null;
    const humanReadableName = page?.title || title;

    console.log(`[fetchWikipediaMetadata] Raw timestamp for ${title}: ${lastUpdated}`);

    return { lastUpdated, humanReadableName };
  } catch (error) {
    console.error(`[fetchWikipediaMetadata] Error: ${error.message}`);
    return { lastUpdated: null, humanReadableName: title };
  }
};

const saveMetadata = async (slug, humanReadableName) => {
  const relativeFilePath = `/data/faqs/${slug}.html`; // Construct file path
  const metadataQuery = `
    INSERT INTO faq_files (slug, file_path, human_readable_name, created_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (slug) 
    DO UPDATE SET 
      file_path = EXCLUDED.file_path, 
      human_readable_name = EXCLUDED.human_readable_name,
      created_at = NOW(); -- Optional to update timestamp
  `;
  const metadataValues = [slug, relativeFilePath, humanReadableName];

  console.log("[saveMetadata] Running query with values:", metadataValues);

  try {
    const result = await client.query(metadataQuery, metadataValues);
    console.log(`[saveMetadata] Metadata saved for: ${slug}`);
  } catch (err) {
    console.error("[saveMetadata] Error saving metadata:", err.message);
  }
};





// Generate structured FAQ data using OpenAI
const generateStructuredFAQs = async (title, content, rawTimestamp) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-2024-08-06",
      messages: [
        {
          role: "system",
          content: "You are a tool that extracts structured FAQ data and metadata from Wikipedia content.",
        },
        {
          role: "user",
          content: `Extract structured FAQs with subheaders and cross-links from the following Wikipedia content:

Title: ${title}
Last Updated: ${rawTimestamp}
Content:
${content}`,
        },
      ],
      tools,
    });

    const toolCall = response.choices[0].message.tool_calls?.[0];
    if (!toolCall) {
      console.error(`[generateStructuredFAQs] No function call generated for ${title}.`);
      return null;
    }

    const args = JSON.parse(toolCall.function.arguments);
    return args;
  } catch (error) {
    console.error(`[generateStructuredFAQs] Error: ${error.message}`);
    return null;
  }
};


const generateThumbnailURL = (mediaLink) => {
  if (!mediaLink || !mediaLink.includes("/")) {
    console.warn(`[generateThumbnailURL] Malformed media link: ${mediaLink}`);
    return null;
  }

  const urlParts = mediaLink.split("/");
  const filename = urlParts.pop(); // Get the file name
  const path = urlParts.slice(-2).join("/"); // Get the last two parts of the path
  const size = "480px"; // Define desired thumbnail size

  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${path}/${filename}/${size}-${filename}`;
};

const fetchWikipediaPage = async (title) => {
  const endpoint = "https://en.wikipedia.org/w/api.php";
  const params = {
    action: "expandtemplates",
    text: `{{:${title}}}`,
    prop: "wikitext",
    format: "json",
  };

  try {
    console.log(`[fetchWikipediaPage] Fetching content for: ${title}`);
    const response = await axios.get(endpoint, {
      params,
      headers: { "User-Agent": "justthefaqs/1.0 (justthefaqs@replit.app)" },
    });

    const content = response.data?.expandtemplates?.wikitext;

    // Check for empty or malformed content
    if (!content || content.trim() === "") {
      console.error(`[fetchWikipediaPage] Error: Content is empty or invalid for ${title}`);
      return null;
    }

    console.log(
      `[fetchWikipediaPage] Content for ${title} (first 500 chars):\n${content.slice(0, 500)}`
    );

    return content;
  } catch (error) {
    console.error(
      `[fetchWikipediaPage] Error fetching page "${title}": ${error.message}`,
      error.response?.data || error
    );
    return null;
  }
};



// Save structured FAQs to the database and filesystem
const saveStructuredFAQ = async (title, url, humanReadableName, lastUpdated, faqs) => {
  if (!faqs || !faqs.length) {
    console.error("[saveStructuredFAQ] No FAQs to save.");
    return;
  }

  const rawQuery = `
    INSERT INTO raw_faqs (url, title, human_readable_name, last_updated, subheader, question, answer, cross_link, media_link)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT DO NOTHING;
  `;

  try {
    // Fetch thumbnails for each FAQ
    const faqWithThumbnails = await Promise.all(
      faqs.map(async (faq) => {
        const mediaLink = faq.media_links?.[0] || null;
        const thumbnailURL = mediaLink
          ? await fetchThumbnailURL(mediaLink, 480)
          : null;
        return { ...faq, thumbnailURL };
      })
    );

    for (const faq of faqWithThumbnails) {
      const values = [
        url,
        title,
        humanReadableName,
        lastUpdated,
        faq.subheader || null,
        faq.question,
        faq.answer,
        faq.cross_links ? faq.cross_links.join(", ") : null,
        faq.thumbnailURL,
      ];
      await client.query(rawQuery, values);
      console.log(`[DB] FAQ saved: "${faq.question}" under "${faq.subheader || "No Subheader"}"`);
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>FAQs: ${humanReadableName}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
          }
          .container {
            padding: 16px;
            max-width: 800px;
            margin: auto;
          }
          h1 {
            text-align: center;
            margin-bottom: 24px;
          }
          .faq-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
          }
          .faq-table td {
            vertical-align: top;
            padding: 8px;
          }
          .faq-table .image-cell {
            width: 120px;
            text-align: center;
          }
          .faq-table img {
            max-width: 100px;
            border-radius: 8px;
          }
          .faq-content {
            padding: 8px 16px;
          }
          @media (max-width: 600px) {
            .faq-table {
              display: block;
            }
            .faq-table tr {
              display: flex;
              flex-wrap: wrap;
              margin-bottom: 16px;
              border-bottom: 1px solid #ddd;
            }
            .faq-table td {
              display: block;
              width: 100%;
            }
            .faq-table .image-cell {
              width: 100%;
              text-align: center;
              margin-bottom: 8px;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>FAQs: ${humanReadableName}</h1>
          ${faqWithThumbnails
            .map((faq) => `
              <table class="faq-table">
                <tr>
                  <td class="image-cell">
                    ${
                      faq.thumbnailURL
                        ? `<img src="${faq.thumbnailURL}" alt="Related Image">`
                        : `<div style="width: 100px; height: 100px;"></div>`
                    }
                  </td>
                  <td class="faq-content">
                    <strong>${faq.subheader || "General"} - ${faq.question}</strong><br>${faq.answer}
                  </td>
                </tr>
              </table>`)
            .join("\n")}
        </div>
      </body>
      </html>
    `;

    const filePath = path.join(FAQ_DIR, `${slug}.html`);
    await fs.ensureDir(FAQ_DIR);
    await fs.writeFile(filePath, htmlContent, "utf8");
    console.log(`[saveStructuredFAQ] FAQ file created: ${filePath}`);
  } catch (err) {
    console.error("[saveStructuredFAQ] Error saving FAQs or metadata:", err.message);
  }
};







const normalizeMediaLink = (mediaLink) => {
  if (!mediaLink) return null;

  if (mediaLink.startsWith("https://upload.wikimedia.org")) {
    // Extract filename from the full URL
    const match = mediaLink.match(/\/([^\/]+)$/);
    return match ? `File:${decodeURIComponent(match[1])}` : null;
  }

  // Assume it's already a `File:` title
  return mediaLink;
};

const fetchThumbnailURL = async (mediaLink, size = 480) => {
  // Directly return the URL if it is already a Wikimedia image
  if (mediaLink.startsWith("https://upload.wikimedia.org")) {
    console.log(`[fetchThumbnailURL] Using existing media URL: ${mediaLink}`);
    return mediaLink.replace(/\/[0-9]+px-/, `/${size}px-`); // Adjust size dynamically
  }

  // Normalize the media link for API usage
  const normalizedLink = normalizeMediaLink(mediaLink);
  if (!normalizedLink) {
    console.warn(`[fetchThumbnailURL] Invalid media link: ${mediaLink}`);
    return null;
  }

  // Query Wikipedia API for the thumbnail
  const endpoint = "https://en.wikipedia.org/w/api.php";
  const params = {
    action: "query",
    titles: normalizedLink,
    prop: "pageimages",
    format: "json",
    pithumbsize: size,
  };

  try {
    console.log(`[fetchThumbnailURL] Fetching thumbnail for: ${normalizedLink}`);
    const response = await axios.get(endpoint, { params });
    const page = Object.values(response.data.query.pages)[0];
    if (page?.thumbnail?.source) {
      console.log(`[fetchThumbnailURL] Fetched thumbnail: ${page.thumbnail.source}`);
      return page.thumbnail.source;
    } else {
      console.warn(`[fetchThumbnailURL] No thumbnail available for: ${normalizedLink}`);
      return null;
    }
  } catch (error) {
    console.error(`[fetchThumbnailURL] Error fetching thumbnail: ${error.message}`);
    return null;
  }
};






const fetchTopWikipediaPages = async () => {
  const url = "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/2023/12/31";
  try {
    console.log("[fetchTopWikipediaPages] Fetching top Wikipedia pages...");
    const response = await axios.get(url);
    const articles = response.data.items[0].articles.slice(0, 20);
    return articles.map((article) => article.article);
  } catch (error) {
    console.error("[fetchTopWikipediaPages] Error fetching top pages:", error.message);
    return [];
  }
};


// Main process
const main = async (newPagesTarget = 5) => {
  console.log("[main] Starting FAQ generation process...");

  // Fetch top Wikipedia pages
  const titles = await fetchTopWikipediaPages();
  if (!titles.length) {
    console.error("[main] No titles fetched. Exiting...");
    return;
  }

  let processedCount = 0;

  for (const title of titles) {
    if (processedCount >= newPagesTarget) {
      console.log(`[main] Processed ${processedCount} pages. Target reached.`);
      break;
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    console.log(`[main] Processing title: "${title}", slug: "${slug}"`);

    // Check if the slug already exists in the database
    const query = `
      SELECT slug FROM faq_files WHERE slug = $1;
    `;
    const values = [slug];

    try {
      const result = await client.query(query, values);
      if (result.rows.length > 0) {
        console.log(`[main] Skipping "${title}" as it already exists in the database.`);
        continue; // Skip processing this title
      }
    } catch (error) {
      console.error(`[main] Error checking slug existence for "${slug}":`, error.message);
      continue; // Skip this entry to prevent breaking the script
    }

    try {
      // Fetch metadata for the page
      const url = `https://en.wikipedia.org/wiki/${title}`;
      const metadata = await fetchWikipediaMetadata(title);
      const { lastUpdated, humanReadableName } = metadata;

      if (!humanReadableName) {
        console.warn(`[main] No human-readable name found for "${title}". Skipping...`);
        continue;
      }

      // Fetch the Wikipedia page content
      const wikipediaText = await fetchWikipediaPage(title);
      if (!wikipediaText) {
        console.error(`[main] Skipping "${title}" due to empty or invalid content.`);
        continue;
      }

      // Generate structured FAQs
      const structuredFAQs = await generateStructuredFAQs(title, wikipediaText, lastUpdated);
      if (!structuredFAQs) {
        console.error(`[main] Skipping "${title}" due to FAQ generation failure.`);
        continue;
      }

      const { faqs, human_readable_name, last_updated } = structuredFAQs;

      // Save the FAQs and metadata
      await saveStructuredFAQ(title, url, human_readable_name, last_updated, faqs);

      // Save metadata separately for visibility
      await saveMetadata(slug, human_readable_name);

      console.log(`[main] Successfully processed and saved FAQs for "${title}".`);
      processedCount++; // Increment counter

    } catch (error) {
      console.error(`[main] Error processing "${title}":`, error.message);
      continue; // Continue with the next title
    }
  }

  if (processedCount < newPagesTarget) {
    console.log(
      `[main] Only ${processedCount} new pages were processed. Check database or adjust fetch size.`
    );
  }

  console.log("[main] FAQ generation process completed.");
};

main(3);
