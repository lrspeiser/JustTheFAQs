// lib/processSinglePage.js

import axios from "axios";
import OpenAI from "openai";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";
dotenv.config();
import { generateAdditionalFAQs, saveAdditionalFAQs } from "./secondPass.js";


// ------------------------------------------------------------------
// Configure environment + Initialize Clients
// ------------------------------------------------------------------
console.log("Environment Variables:");
console.log("OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "Loaded" : "Missing");
console.log("NEXT_PUBLIC_SUPABASE_URL:", process.env.NEXT_PUBLIC_SUPABASE_URL || "Not Set");
console.log("NEXT_PUBLIC_SUPABASE_ANON_KEY:", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "Loaded" : "Missing");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[initClients] ❌ Missing Supabase environment variables");
}
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export { openai };

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const indexName = "faq-embeddings";
const index = pc.index(indexName);

const vectors = []; // We'll store embeddings to upsert in Pinecone
const RETRY_ATTEMPTS = 3;

// ------------------------------------------------------------------
// Functions array: Original function definitions for OpenAI
// (Updated to the modern "functions" shape.)
// ------------------------------------------------------------------
export const functions = [
  {
    name: "generate_structured_faqs",
    description:
      "Generate structured Questions and Answers from Wikipedia content by identifying key concepts and framing them as fascinating Q&A pairs. Start with the most interesting questions and work your way to the least interesting. Avoid unnecessary jargon and filler language. Be thorough, using all of the information from Wikipedia even if it is outside the section where you got the question. Try to be comprehensive on specific details like names, dates, locations, numbers, formulas, and so forth. If there are any images that would enrich the question or answer, make sure to include those URLs. Do NOT change the case of Wikipedia page titles or cross-links. There should be a minimum of one question for every section within the Wikipedia page.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "The title of the Wikipedia page. All of the questions and answers should be related specifically to this page."
        },
        human_readable_name: {
          type: "string",
          description: "The human-readable page name."
        },
        last_updated: {
          type: "string",
          description: "The last update timestamp of the page."
        },
        faqs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              subheader: {
                type: "string",
                description:
                  "The subheader under which this FAQ falls. We should not use sections that have less than 2 sentences of content about the subject of the page."
              },
              question: {
                type: "string",
                description:
                  "A question derived from the content. These should be interesting questions where we have something unique in the answer to share. There should be a minimum of one question for every section within the Wikipedia page and if that section has a lot of specific information, try to be comprehensive in your list of questions."
              },
              answer: {
                type: "string",
                description:
                  "The answer to the question. These should be rich with facts and data, but also written in an engaging manner that would appeal to a wide audience. They should have a minimum of 3 sentences of content and ideally 10 sentences of content, but no filler language, just facts unique to the question."
              },
              cross_links: {
                type: "array",
                items: {
                  type: "string",
                  description: "Relevant cross-links from Wikipedia."
                },
                description:
                  "These are references to relevant pages on Wikipedia to the question and answer, but are not the page we are getting content from. They must be pages that exist on Wikipedia as full pages. Do not use links that say: (Redirected from <link>) because they don't have Wikipedia pages. Don't provide links that mention redirects. Don't include the portion before the slash /. For instance, it should be Pro_Football_Hall_of_Fame, not /wiki/Pro_Football_Hall_of_Fame. Do not include anchor links (e.g., Auckland_Zoo#Major_exhibits)."
              },
              media_links: {
                type: "array",
                items: {
                  type: "string",
                  description: "Relevant media links from the content."
                },
                description:
                  "Media links (e.g., images) relevant to the Q&A. Use the links exactly as they were provided in the original Wikipedia file sent to you. It should start with https://. It should not start with 'url:https://'. Don't reuse the same image for more than one Q&A. Try hard to find a good image link for the topic, but if there is no image that fits the question very well and would add value to the reader, then don't include a media link."
              }
            },
            required: ["subheader", "question", "answer"]
          },
          description: "A list of FAQs organized by subheaders."
        }
      },
      required: ["title", "human_readable_name", "last_updated", "faqs"]
    }
  },
  {
    name: "generate_additional_faqs",
    description:
      "Generate additional structured FAQs from Wikipedia content by identifying key concepts that weren't covered in the first pass. Like the initial pass, start with the most interesting questions and work your way to the least interesting. Avoid unnecessary jargon and filler language. Be thorough, using all of the information from Wikipedia even if it is outside the section where you got the question. Try to be comprehensive on specific details like names, dates, locations, numbers, formulas, and so forth. If there are any images that would enrich the question or answer, make sure to include those URLs, being careful not to reuse images from the first pass. Do NOT change the case of Wikipedia page titles or cross-links. There should be a minimum of one question for every section within the Wikipedia page.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "The title of the Wikipedia page. All of the questions and answers should be related specifically to this page."
        },
        human_readable_name: {
          type: "string",
          description: "The human-readable page name."
        },
        last_updated: {
          type: "string",
          description: "The last update timestamp of the page."
        },
        additional_faqs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              subheader: {
                type: "string",
                description:
                  "The subheader under which this FAQ falls. We should not use sections that have less than 2 sentences of content about the subject of the page."
              },
              question: {
                type: "string",
                description:
                  "A new question derived from the content that wasn't covered in the first pass. These should be interesting questions where we have something unique in the answer to share. There should be a minimum of one question for every section within the Wikipedia page and if that section has a lot of specific information, try to be comprehensive in your list of questions."
              },
              answer: {
                type: "string",
                description:
                  "The answer to the question. These should be rich with facts and data, but also written in an engaging manner that would appeal to a wide audience. They should have a minimum of 3 sentences of content and ideally 10 sentences of content, but no filler language, just facts unique to the question."
              },
              cross_links: {
                type: "array",
                items: {
                  type: "string",
                  description: "Relevant cross-links from Wikipedia."
                },
                description:
                  "These are references to relevant pages on Wikipedia to the question and answer, but are not the page we are getting content from. They must be pages that exist on Wikipedia as full pages. Do not use links that say: (Redirected from <link>) because they don't have Wikipedia pages. Don't provide links that mention redirects. Don't include the portion before the slash /. For instance, it should be Pro_Football_Hall_of_Fame, not /wiki/Pro_Football_Hall_of_Fame. Do not include anchor links (e.g., Auckland_Zoo#Major_exhibits)."
              },
              media_links: {
                type: "array",
                items: {
                  type: "string",
                  description: "Relevant media links from the content."
                },
                description:
                  "Media links (e.g., images) relevant to the Q&A. Use the links exactly as they were provided in the original Wikipedia file sent to you. It should start with https://. It should not start with 'url:https://'. Don't reuse the same image for more than one Q&A. Try hard to find a good image link for the topic, but if there is no image that fits the question very well and would add value to the reader, then don't include a media link."
              }
            },
            required: ["subheader", "question", "answer"]
          },
          description:
            "A list of additional FAQs organized by subheaders that complement the existing FAQs."
        }
      },
      required: ["title", "human_readable_name", "last_updated", "additional_faqs"]
    }
  }
];


// ------------------------------------------------------------------
// Helper: Truncate long Wikipedia content
// ------------------------------------------------------------------
export function truncateContent(content, mediaLinks, maxTokens = 90000) {
  // Rough estimate: 4 characters per token
  const charLimit = maxTokens * 4;
  const mediaLinksText = mediaLinks.join("\n");

  if (content.length + mediaLinksText.length > charLimit) {
    console.warn(`[truncateContent] Content is too large. Truncating to ${maxTokens} tokens.`);
    let truncatedContent = content.slice(
      0,
      charLimit - mediaLinksText.length - 1000
    );
    const lastSentenceEnd = truncatedContent.lastIndexOf(". ");
    if (lastSentenceEnd > 0) {
      truncatedContent = truncatedContent.slice(0, lastSentenceEnd + 1);
    }
    return {
      truncatedContent,
      truncatedMediaLinks: mediaLinks
    };
  }
  return {
    truncatedContent: content,
    truncatedMediaLinks: mediaLinks
  };
}

// ------------------------------------------------------------------
// Helper: Generate Embedding
// ------------------------------------------------------------------
export async function generateEmbedding(text) {
  try {
    console.log("[generateEmbedding] Generating embedding for:", text);
    console.log("[generateEmbedding] 🟡 Starting OpenAI API call...");
    console.log("[generateEmbedding] Request params:", {
      model: "text-embedding-3-small",
      inputLength: text.length,
      dimensions: 1536
    });

    const startTime = Date.now();
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
      dimensions: 1536
    });
    const duration = Date.now() - startTime;

    console.log(`[generateEmbedding] ✅ OpenAI API call completed in ${duration}ms`);
    console.log(
      "[generateEmbedding] Response status:",
      embedding.data ? "200 OK" : "No data received"
    );
    console.log("[generateEmbedding] Successfully generated embedding");
    return embedding.data[0].embedding;
  } catch (error) {
    console.error("[generateEmbedding] Error generating embedding:", error.message);
    throw error;
  }
}

// ------------------------------------------------------------------
// 1st Pass: generateStructuredFAQs
// ------------------------------------------------------------------
export async function generateStructuredFAQs(title, content, rawTimestamp, images) {
  let lastError = null;
  const retryAttempts = 3;

  for (let attempt = 0; attempt < retryAttempts; attempt++) {
    try {
      const { truncatedContent, truncatedMediaLinks } = truncateContent(
        content,
        images
      );
      console.log(
        `[generateStructuredFAQs] Attempt ${attempt + 1}/${retryAttempts} for "${title}"`
      );

      const contentWithImages = `
${truncatedContent}

Relevant Images:
${truncatedMediaLinks
  .map((url, index) => `[Image ${index + 1}]: ${url}`)
  .join("\n")}
      `;

      const startTime = Date.now();
      console.log(`[generateStructuredFAQs] 🟡 Calling OpenAI for "${title}"...`);
      const [response] = await Promise.all([
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Generate structured FAQs from Wikipedia content by identifying key concepts and framing them as fascinating Q&A pairs. Start with the most interesting questions and work your way to the least interesting. Ensure clarity, relevance, and engagement, avoiding unnecessary jargon. Be thorough, using all of the information from Wikipedia, especially where there are specific details like names, dates, locations, numbers, formulas and so forth, but focus on what most people would find the most interesting questions to be answered and expand upon those answers. If there are any images that go with the answer, make sure to include those URLs. Do NOT change the case of Wikipedia page titles or cross-links"
            },
            {
              role: "user",
              content: `Extract structured questions and answers with subheaders, cross-links and if available images from the following Wikipedia content:

Title: ${title}
Last Updated: ${rawTimestamp}
Content:
${contentWithImages},
`
            }
          ],
          functions,
          // This instructs the model to automatically call any function if relevant
          function_call: "auto"
        })
      ]);

      const duration = Date.now() - startTime;
      console.log(`[generateStructuredFAQs] ✅ Done in ${duration}ms`);

      // Use the newer function_call property instead of .tool_calls
      const functionCall = response.choices[0].message.function_call;
      if (!functionCall) {
        throw new Error(`No function call generated for ${title}`);
      }

      const args = JSON.parse(functionCall.arguments);
      console.log(`[generateStructuredFAQs] ✅ Successfully generated FAQs for "${title}"`);
      return args;
    } catch (error) {
      lastError = error;
      console.error(
        `[generateStructuredFAQs] Attempt ${attempt + 1} failed for "${title}":`,
        error.message
      );
      if (attempt < retryAttempts - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[generateStructuredFAQs] Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  console.error(
    `[generateStructuredFAQs] ❌ All attempts failed for "${title}".`
  );
  return false;
}

// ------------------------------------------------------------------
// Save to DB: Insert row in raw_faqs
// ------------------------------------------------------------------
export async function insertDataToSupabase(tableName, data) {
  try {
    const { data: insertedData, error } = await supabase
      .from(tableName)
      .insert([data])
      .select("*")
      .single();
    if (error) {
      console.error(`[Supabase] Error inserting into ${tableName}:`, error.message);
      throw error;
    }
    if (!insertedData) {
      throw new Error(`No data returned from ${tableName} insert`);
    }
    return insertedData;
  } catch (error) {
    console.error(
      `[Supabase] Unexpected error during insert into ${tableName}:`,
      error.message
    );
    throw error;
  }
}

// ------------------------------------------------------------------
// Utility: Format cross-links
// ------------------------------------------------------------------
export function formatCrossLinks(faqs) {
  if (!Array.isArray(faqs)) {
    console.error("[formatCrossLinks] ❌ Invalid faqs input:", faqs);
    return [];
  }
  return faqs
    .flatMap((faq) => faq.cross_links || [])
    .filter(Boolean)
    .filter((link) => !link.includes("#")) // remove anchor links
    .map((link) => link.replace(/^\/wiki\//, "")) // remove "/wiki/"
    .map((link) => decodeURIComponent(link))
    .filter(Boolean);
}

// ------------------------------------------------------------------
// Utility: Save or find metadata for a page in faq_files
// ------------------------------------------------------------------
export function formatWikipediaSlug(title) {
  return title.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
}

export async function saveMetadata(title, humanReadableName) {
  const slug = formatWikipediaSlug(title);
  const data = {
    slug,
    human_readable_name: humanReadableName,
    created_at: new Date().toISOString()
  };

  console.log("[saveMetadata] Checking or creating metadata:", data);
  try {
    // Check if it exists
    const { data: existingEntry, error: checkError } = await supabase
      .from("faq_files")
      .select("id, slug")
      .eq("slug", slug)
      .limit(1)
      .maybeSingle();

    if (checkError) {
      console.error("[saveMetadata] ❌ Error checking slug:", checkError.message);
      return null;
    }
    if (existingEntry) {
      console.log(
        `[saveMetadata] Found existing entry for "${slug}", ID ${existingEntry.id}`
      );
      return existingEntry.id;
    }

    // Insert new row
    const { data: newEntry, error } = await supabase
      .from("faq_files")
      .insert([data])
      .select("id")
      .single();

    if (error) {
      console.error("[saveMetadata] ❌ Error inserting metadata:", error.message);
      return null;
    }

    console.log(`[saveMetadata] ✅ Created new entry for "${slug}", ID ${newEntry.id}`);
    return newEntry.id;
  } catch (err) {
    console.error("[saveMetadata] ❌ Unexpected error:", err.message);
    return null;
  }
}

// ------------------------------------------------------------------
// Save first-pass FAQs
// ------------------------------------------------------------------
export async function saveStructuredFAQ(
  title,
  url,
  humanReadableName,
  lastUpdated,
  faqs
) {
  if (!url) {
    console.error(`[saveStructuredFAQ] ❌ Missing URL for "${title}".`);
    return;
  }
  if (!faqs || !faqs.length) {
    console.error("[saveStructuredFAQ] No FAQs to save.");
    return;
  }

  const faqFileId = await saveMetadata(title, humanReadableName);
  if (!faqFileId) {
    console.error(
      `[saveStructuredFAQ] ❌ Failed to get or create FAQ file for "${title}".`
    );
    return;
  }
  console.log(`[saveStructuredFAQ] Using faq_file_id=${faqFileId} for "${title}"`);

  // Optionally add cross-links to queue
  const allCrossLinks = formatCrossLinks(faqs);
  for (const link of allCrossLinks) {
    const crossLinkSlug = formatWikipediaSlug(link);
    const crossLinkTitle = link.replace(/_/g, " ");
    const crossLinkUrl = `https://en.wikipedia.org/wiki/${link}`;
    try {
      // If you still want to queue cross-links:
      const { data: existing } = await supabase
        .from("processing_queue")
        .select("id")
        .eq("slug", crossLinkSlug)
        .maybeSingle();

      if (!existing) {
        await supabase.from("processing_queue").insert([
          {
            title: crossLinkTitle,
            slug: crossLinkSlug,
            url: crossLinkUrl,
            human_readable_name: crossLinkTitle,
            status: "pending",
            source: "cross_link"
          }
        ]);
        console.log(
          `[saveStructuredFAQ] ✅ Queued cross-link: ${crossLinkTitle}`
        );
      }
    } catch (error) {
      console.error(
        `[saveStructuredFAQ] Error queueing cross-link ${crossLinkTitle}:`,
        error
      );
    }
  }

  // Now insert each FAQ
  for (const faq of faqs) {
    try {
      console.log(`[saveStructuredFAQ] Inserting FAQ: "${faq.question}"`);
      let mediaUrl = faq.media_links?.[0] || null;
      if (mediaUrl && typeof mediaUrl === "object" && mediaUrl.url) {
        mediaUrl = mediaUrl.url;
      }

      const relatedPages = Array.isArray(faq.cross_links)
        ? faq.cross_links
            .filter(Boolean)
            .map((link) => link.replace(/^\/wiki\//, ""))
            .join(", ") || null
        : null;

      const faqData = {
        faq_file_id: faqFileId,
        url,
        title,
        human_readable_name: humanReadableName,
        last_updated: lastUpdated,
        subheader: faq.subheader || null,
        question: faq.question,
        answer: faq.answer,
        cross_link: relatedPages,
        media_link: mediaUrl
      };

      const savedFaq = await insertDataToSupabase("raw_faqs", faqData);
      if (!savedFaq) {
        throw new Error("Failed to insert FAQ");
      }

      // Generate embedding
      const embeddingText = `
Page Title: ${title}
Subcategory: ${faq.subheader || "General"}
Question: ${faq.question}
Answer: ${faq.answer}
Related Pages: ${relatedPages}
      `.trim();

      console.log(
        `[saveStructuredFAQ] Generating embedding for FAQ: "${faq.question}"`
      );
      const embedding = await generateEmbedding(embeddingText);

      // FIXED: Safely convert each media_links item to a trimmed string
      let cleanedMediaLinks = [];
      if (faq.media_links && Array.isArray(faq.media_links)) {
        cleanedMediaLinks = faq.media_links.map((item) => {
          if (typeof item === "string") {
            return item.trim();
          } else if (item && typeof item === "object" && item.url) {
            return item.url.trim();
          } else if (item && typeof item === "object" && item.media) {
            return item.media.trim();
          }
          return "";
        });
      }

      const vector = {
        id: savedFaq.id.toString(),
        values: embedding,
        metadata: {
          faq_file_id: faqFileId.toString(),
          question: faq.question || "Unknown Question",
          answer: faq.answer || "No Answer Available",
          url,
          human_readable_name: humanReadableName || "Unknown",
          last_updated: lastUpdated || new Date().toISOString(),
          subheader: faq.subheader || "",
          cross_link: relatedPages
            ? relatedPages.split(",").map((x) => x.trim())
            : [],
          media_link: mediaUrl || "",
          image_urls: cleanedMediaLinks
        }
      };

      vectors.push(vector);
    } catch (err) {
      console.error(`[saveStructuredFAQ] ❌ Error handling FAQ "${faq.question}":`, err);
    }
  }

  // Upsert everything in one go
  if (vectors.length > 0) {
    console.log(
      `[saveStructuredFAQ] 🟡 Upserting ${vectors.length} embeddings to Pinecone...`
    );
    try {
      await index.upsert(vectors);
      console.log(
        `[saveStructuredFAQ] ✅ Upserted ${vectors.length} FAQs to Pinecone.`
      );

      const justUpsertedIds = vectors.map((v) => parseInt(v.id, 10));
      const { error: updateError } = await supabase
        .from("raw_faqs")
        .update({ pinecone_upsert_success: true })
        .in("id", justUpsertedIds);

      if (updateError) {
        console.error(
          `[saveStructuredFAQ] ❌ Error marking pinecone_upsert_success:`,
          updateError.message
        );
      } else {
        console.log(
          `[saveStructuredFAQ] ✅ Marked pinecone_upsert_success=true for ${justUpsertedIds.length} rows.`
        );
      }
    } catch (upsertError) {
      console.error(`[saveStructuredFAQ] ❌ Pinecone upsert failed:`, upsertError.message);
    }
  } else {
    console.log(`[saveStructuredFAQ] ⚠️ No vectors to upsert.`);
  }

  console.log(
    `[saveStructuredFAQ] ✅ Completed saving ${faqs.length} first-pass FAQs for "${title}".`
);
}


// ------------------------------------------------------------------
// Fetch Wikipedia metadata
// ------------------------------------------------------------------
export async function fetchWikipediaMetadata(title) {
  const endpoint = "https://en.wikipedia.org/w/api.php";
  const params = {
    action: "query",
    prop: "revisions|info",
    titles: title,
    rvprop: "timestamp",
    format: "json"
  };

  try {
    console.log(`[fetchWikipediaMetadata] Fetching metadata for ${title}`);
    const response = await axios.get(endpoint, { params });
    const page = Object.values(response.data.query.pages)[0];
    const lastUpdated = page?.revisions?.[0]?.timestamp || null;
    const humanReadableName = page?.title || title;
    return { lastUpdated, humanReadableName };
  } catch (error) {
    console.error(`[fetchWikipediaMetadata] Error: ${error.message}`);
    return { lastUpdated: null, humanReadableName: title };
  }
}

// ------------------------------------------------------------------
// Fetch Wikipedia page content
// ------------------------------------------------------------------
export async function fetchWikipediaPage(title) {
  const endpoint = "https://en.wikipedia.org/w/api.php";
  const params = {
    action: "parse",
    page: title,
    prop: "text",
    format: "json"
  };

  try {
    console.log(`[fetchWikipediaPage] Fetching content for: ${title}`);
    const response = await axios.get(endpoint, { params });
    const page = response.data?.parse;
    if (!page) {
      console.error(`[fetchWikipediaPage] Page not found for: ${title}`);
      return null;
    }

    const htmlContent = page.text?.["*"];
    if (!htmlContent) {
      console.error(`[fetchWikipediaPage] No text for: ${title}`);
      return null;
    }

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

    console.log(`[fetchWikipediaPage] Found ${images.length} images for "${title}"`);
    return { content: htmlContent, images };
  } catch (error) {
    console.error(`[fetchWikipediaPage] Error: ${error.message}`);
    return null;
  }
}

// ------------------------------------------------------------------
// The MAIN Single-Page Function
// This is what you'll call, e.g. processOnePageFromDB(123)
// ------------------------------------------------------------------
export async function processOnePageFromDB(id) {
  console.log(`[processOnePageFromDB] Processing queue entry ID=${id}`);

  // 1) Fetch the row from your "processing_queue" (or whichever table) by ID
  const { data: record, error } = await supabase
    .from("processing_queue")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error(`[processOnePageFromDB] ❌ Error fetching row ID=${id}:`, error.message);
    return false;
  }
  if (!record) {
    console.error(`[processOnePageFromDB] ❌ No record found with ID=${id}.`);
    return false;
  }

  // You can check if it's already done, or in progress, etc.
  if (record.status !== "pending") {
    console.log(
      `[processOnePageFromDB] Row ${id} not in "pending" status. Current status: ${record.status}`
    );
    return false;
  }

  // 2) Update to "processing" status
  await supabase
    .from("processing_queue")
    .update({ status: "processing", attempts: (record.attempts || 0) + 1 })
    .eq("id", record.id);

  // 3) Gather Wikipedia data:
  const { title } = record;
  console.log(`[processOnePageFromDB] Title to process: "${title}"`);

  const { lastUpdated, humanReadableName } = await fetchWikipediaMetadata(title);
  const pageData = await fetchWikipediaPage(title);

  if (!pageData) {
    console.error(
      `[processOnePageFromDB] ❌ No Wikipedia content for "${title}". Marking failed.`
    );
    await supabase
      .from("processing_queue")
      .update({
        status: "failed",
        error_message: "No content found",
        processed_at: new Date().toISOString()
      })
      .eq("id", record.id);
    return false;
  }

  const { content, images } = pageData;
  const pageUrl = record.url || `https://en.wikipedia.org/wiki/${title}`;

  // 4) First Pass
  console.log(
    `[processOnePageFromDB] Generating structured FAQs (first pass) for "${title}"...`
  );
  const structured = await generateStructuredFAQs(
    title,
    content,
    lastUpdated,
    images
  );
  if (!structured) {
    console.error(
      `[processOnePageFromDB] ❌ First pass failed for "${title}". Marking failed.`
    );
    await supabase
      .from("processing_queue")
      .update({
        status: "failed",
        error_message: "First pass generation failed",
        processed_at: new Date().toISOString()
      })
      .eq("id", record.id);
    return false;
  }

  const { faqs, human_readable_name, last_updated } = structured;
  const finalName = human_readable_name || humanReadableName;
  const finalTimestamp = last_updated || lastUpdated;

  console.log(`[processOnePageFromDB] Saving first pass FAQs for "${title}"...`);
  await saveStructuredFAQ(title, pageUrl, finalName, finalTimestamp, faqs);

  // 5) Second Pass
  console.log(
    `[processOnePageFromDB] Generating additional FAQs (second pass) for "${title}"...`
  );
  const additionalFaqs = await generateAdditionalFAQs(
    title,
    content,
    faqs,
    images
  );
  if (additionalFaqs && additionalFaqs.length > 0) {
    console.log(
      `[processOnePageFromDB] Saving ${additionalFaqs.length} additional FAQ(s) for "${title}"...`
    );
    await saveAdditionalFAQs(
      title,
      additionalFaqs,
      pageUrl,
      finalName,
      finalTimestamp
    );
  } else {
    console.log(`[processOnePageFromDB] No additional FAQs returned for "${title}".`);
  }

  // 6) Done! Mark record as completed
  await supabase
    .from("processing_queue")
    .update({
      status: "completed",
      processed_at: new Date().toISOString(),
      error_message: null
    })
    .eq("id", record.id);

  console.log(`[processOnePageFromDB] ✅ All done for ID=${id}. Marked "completed".`);
  return true;
}
