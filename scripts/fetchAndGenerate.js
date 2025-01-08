import axios from "axios";
import fs from "fs-extra";
import path from "path";
import pkg from "pg";
const { Client } = pkg;
import OpenAI from "openai";
import * as cheerio from "cheerio";
import { exec } from "child_process";


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
      description: "Generate structured FAQs from Wikipedia content by identifying key concepts and framing them as fascinating Q&A pairs. Start with the most interesting questions and work your way to the least interesting. Ensure clarity, relevance, and engagement, avoiding unnecessary jargon. Be thorough, using all of the information from Wikipedia, but focus on what most people would find the most interesting questions to be answered and expand upon those answers. If there are any images that go with the answer, make sure to include those URLs.",
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
                  description: "Media links (e.g., images) relevant to the Q&A. Use the links exactly as they were provided in the original Wikipedia file sent to you. Don't reuse the same image for more than one Q&A.",
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


export default function handler(req, res) {
  if (req.method === "POST") {
    exec("node scripts/fetchAndGenerate.js", (error, stdout, stderr) => {
      if (error) {
        console.error(`[API] Error: ${error.message}`);
        res.status(500).json({ message: "Failed to run the script." });
        return;
      }
      console.log(`[API] Script Output:\n${stdout}`);
      if (stderr) console.error(`[API] Script Error Output:\n${stderr}`);
      res.status(200).json({ message: "Script executed successfully." });
    });
  } else {
    res.status(405).json({ message: "Method not allowed." });
  }
}

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




const truncateContent = (content, mediaLinks, maxTokens = 80000) => {
  // Estimate tokens based on characters (rough estimate: 4 characters = 1 token)
  const charLimit = maxTokens * 4;

  if (content.length + mediaLinks.join("\n").length > charLimit) {
    console.warn(
      `[truncateContent] Content exceeds token limit. Truncating to ${maxTokens} tokens.`
    );

    // Truncate content
    const truncatedContent = content.slice(0, charLimit - mediaLinks.join("\n").length - 1000);

    // Return truncated content and media links
    return {
      truncatedContent,
      truncatedMediaLinks: mediaLinks, // Media links remain unchanged
    };
  }

  return {
    truncatedContent: content,
    truncatedMediaLinks: mediaLinks,
  };
};

const generateStructuredFAQs = async (title, content, rawTimestamp, images) => {
  try {
    const { truncatedContent, truncatedMediaLinks } = truncateContent(content, images);

    const contentWithImages = `
      ${truncatedContent}
      Relevant Images:
      ${truncatedMediaLinks.map((url, index) => `[Image ${index + 1}]: ${url}`).join("\n")}
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a brilliant writer that extracts structured FAQs from Wikipedia content. Start with the most interesting questions and use all of the content from the entire page to generate fascinating and accurate answers. Include all media links provided.",
        },
        {
          role: "user",
          content: `Extract structured FAQs with subheaders and cross-links from the following Wikipedia content:

Title: ${title}
Last Updated: ${rawTimestamp}
Content:
${contentWithImages}`,
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



const fetchWikipediaPage = async (title) => {
  const endpoint = "https://en.wikipedia.org/w/api.php";
  const params = {
    action: "parse",
    page: title,
    prop: "text",
    format: "json",
  };

  try {
    console.log(`[fetchWikipediaPage] Fetching content for: ${title}`);
    const response = await axios.get(endpoint, { params });
    const page = response.data?.parse;

    if (!page) {
      console.error(`[fetchWikipediaPage] Page not found or missing for: ${title}`);
      return null;
    }

    const htmlContent = page.text?.["*"]; // The full HTML content of the page
    if (!htmlContent) {
      console.error(`[fetchWikipediaPage] No HTML content available for: ${title}`);
      return null;
    }

    // Use Cheerio to parse the HTML and extract image links
    const $ = cheerio.load(htmlContent);
    const images = [];
    $("img").each((_, img) => {
      let src = $(img).attr("src");
      if (src) {
        if (src.startsWith("//")) {
          src = `https:${src}`;
        } else if (!src.startsWith("http")) {
          src = `https://en.wikipedia.org${src}`;
        }
        images.push(src);
      }
    });

    console.log(`[fetchWikipediaPage] Content fetched for ${title}:\n${htmlContent.slice(0, 500)}`);
    console.log(`[fetchWikipediaPage] Media links fetched for ${title}:`, images);

    return { content: htmlContent, images };
  } catch (error) {
    console.error(`[fetchWikipediaPage] Error fetching page "${title}": ${error.message}`);
    return null;
  }
};




// Save structured FAQs to the database and filesystem
const saveStructuredFAQ = async (title, url, humanReadableName, lastUpdated, faqs) => {
  if (!faqs || !faqs.length) {
    console.error("[saveStructuredFAQ] No FAQs to save.");
    return;
  }

  // Ensure database schema includes an 'image_urls' column
  const rawQuery = `
    INSERT INTO raw_faqs (url, title, human_readable_name, last_updated, subheader, question, answer, cross_link, media_link, image_urls)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT DO NOTHING;
  `;

  try {
    console.log("[saveStructuredFAQ] Raw media links before thumbnail generation:");
    const faqWithThumbnails = await Promise.all(
      faqs.map(async (faq, index) => {
        const mediaLink = faq.media_links?.[0] || null;
        const thumbnailURL = mediaLink
          ? await fetchThumbnailURL(mediaLink, 480)
          : null;

        console.log(`[saveStructuredFAQ] [FAQ ${index + 1}] Thumbnail URL:`, thumbnailURL);

        return { ...faq, thumbnailURL, mediaLinks: faq.media_links || [] };
      })
    );

    for (const faq of faqWithThumbnails) {
      const imageUrls = faq.mediaLinks.join(", "); // Convert array to comma-separated string
      console.log(`[saveStructuredFAQ] Writing to database - image_urls:`, imageUrls);

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
        imageUrls // Store all media links
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
          .faq-entry {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 16px;
            border-bottom: 1px solid #ddd;
            padding-bottom: 16px;
          }
          .faq-entry .faq-content {
            flex: 1;
            text-align: left;
          }
          .faq-entry img {
            max-width: 120px;
            max-height: 120px;
            margin-left: 16px;
            border-radius: 8px;
          }
          .faq-subheader {
            font-weight: bold;
            margin-bottom: 8px;
          }
          .faq-question {
            font-weight: bold;
            margin: 4px 0;
          }
          .faq-answer {
            margin: 4px 0;
          }
          .faq-links {
            margin-top: 8px;
            font-size: 0.9em;
          }
          .faq-links a {
            text-decoration: none;
            color: #0066cc;
          }
          @media (max-width: 600px) {
            .faq-entry {
              flex-direction: column-reverse;
              align-items: center;
              text-align: center;
            }
            .faq-entry img {
              margin: 16px 0 0 0;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>FAQs: ${humanReadableName}</h1>
          ${faqWithThumbnails
            .map((faq) => {
              const relatedLinks = faq.cross_links
                ? faq.cross_links
                    .map(
                      (link) =>
                        `<a href="/data/faqs/${link.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html">${link
                          .split("/")
                          .pop()
                          .replace(/_/g, " ")}</a>`
                    )
                    .join(", ")
                : "No related links.";

              return `
                <div class="faq-entry">
                  <div class="faq-content">
                    <div class="faq-subheader">${faq.subheader || "General"}</div>
                    <div class="faq-question">${faq.question}</div>
                    <div class="faq-answer">${faq.answer}</div>
                    <div class="faq-links">Related topics: ${relatedLinks}</div>
                  </div>
                  ${
                    faq.thumbnailURL
                      ? `<img src="${faq.thumbnailURL}" alt="Related Image">`
                      : ""
                  }
                </div>
              `;
            })
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
  // Check if the mediaLink is a Wikimedia image
  if (mediaLink.startsWith("https://upload.wikimedia.org")) {
    console.log(`[fetchThumbnailURL] Using existing media URL: ${mediaLink}`);
    return mediaLink.replace(/\/[0-9]+px-/, `/${size}px-`); // Adjust size dynamically
  }

  // Extract the file title from Wikipedia media links
  const match = mediaLink.match(/\/File:(.+)$/);
  if (!match) {
    console.warn(`[fetchThumbnailURL] Invalid media link format: ${mediaLink}`);
    return null;
  }

  const fileName = decodeURIComponent(match[1]);

  // Query Wikipedia API for the actual thumbnail URL
  const endpoint = "https://en.wikipedia.org/w/api.php";
  const params = {
    action: "query",
    titles: `File:${fileName}`,
    prop: "imageinfo",
    iiprop: "url",
    format: "json",
    iiurlwidth: size,
  };

  try {
    console.log(`[fetchThumbnailURL] Fetching thumbnail for: ${fileName}`);
    const response = await axios.get(endpoint, { params });
    const page = Object.values(response.data.query.pages)[0];

    if (page?.imageinfo?.[0]?.thumburl) {
      console.log(`[fetchThumbnailURL] Fetched thumbnail URL: ${page.imageinfo[0].thumburl}`);
      return page.imageinfo[0].thumburl;
    } else {
      console.warn(`[fetchThumbnailURL] No thumbnail found for: ${fileName}`);
      return null;
    }
  } catch (error) {
    console.error(`[fetchThumbnailURL] Error fetching thumbnail: ${error.message}`);
    return null;
  }
};







const fetchTopWikipediaPages = async (offset = 0, limit = 50) => {
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/2023/12/31`;
  try {
    console.log(`[fetchTopWikipediaPages] Fetching Wikipedia pages (offset: ${offset}, limit: ${limit})...`);
    const response = await axios.get(url);
    const articles = response.data.items[0].articles.slice(offset, offset + limit);
    return articles.map((article) => article.article);
  } catch (error) {
    console.error("[fetchTopWikipediaPages] Error fetching top pages:", error.message);
    return [];
  }
};



// Main process
const main = async (newPagesTarget = 50) => {
  console.log("[main] Starting FAQ generation process...");

  let processedCount = 0;
  let offset = 0;

  while (processedCount < newPagesTarget) {
    const titles = await fetchTopWikipediaPages(offset, 50); // Fetch the next 50 titles
    if (!titles.length) {
      console.error("[main] No more titles to fetch. Exiting...");
      break;
    }

    for (const title of titles) {
      if (processedCount >= newPagesTarget) {
        console.log(`[main] Processed ${processedCount} pages. Target reached.`);
        return;
      }

      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      console.log(`[main] Checking existence for slug: "${slug}"`);

      // Check if the slug already exists in the database
      try {
        const result = await client.query("SELECT slug FROM faq_files WHERE slug = $1;", [slug]);
        if (result.rows.length > 0) {
          console.log(`[main] Skipping "${title}" as it already exists in the database.`);
          continue;
        }
      } catch (error) {
        console.error(`[main] Error checking slug existence for "${slug}":`, error.message);
        continue;
      }

      console.log(`[main] Processing title: "${title}", slug: "${slug}"`);

      const url = `https://en.wikipedia.org/wiki/${title}`;
      const metadata = await fetchWikipediaMetadata(title);
      const { lastUpdated, humanReadableName } = metadata;

      if (!humanReadableName) {
        console.warn(`[main] No human-readable name found for "${title}". Skipping...`);
        continue;
      }

      const pageData = await fetchWikipediaPage(title);
      if (!pageData) {
        console.error(`[main] Skipping "${title}" due to empty or invalid content.`);
        continue;
      }

      const { content, images } = pageData;
      const structuredFAQs = await generateStructuredFAQs(title, content, lastUpdated, images);
      if (!structuredFAQs) {
        console.error(`[main] Skipping "${title}" due to FAQ generation failure.`);
        continue;
      }

      const { faqs, human_readable_name, last_updated } = structuredFAQs;
      await saveStructuredFAQ(title, url, human_readable_name, last_updated, faqs);
      await saveMetadata(slug, human_readable_name);

      console.log(`[main] Successfully processed and saved FAQs for "${title}".`);
      processedCount++;
    }

    offset += 50; // Move to the next batch
  }

  console.log(`[main] FAQ generation process completed. Processed ${processedCount} pages.`);
  process.exit(0); // Cleanly terminate the Node.js process
};

main(1)
  .then(() => console.log("[main] Execution finished successfully."))
  .catch((error) => {
    console.error("[main] An error occurred:", error);
    process.exit(1); // Exit with error code if something goes wrong
  });

