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
// ------------------------------------------------------------------
export const functions = [
  {
    name: "generate_structured_faqs",
    description:
      "You are the professor of the subject of this wikipedia page, provide a list of at least 5 questions and answers that are the most important elements of this subject. Make sure that you answer with details, like names, dates, places, references, and so forth. If there are any images that would enrich the question or answer, make sure to include those URLs. Do NOT change the case of Wikipedia page titles or cross-links. Make sure we have broad coverage of the subject, there should be a minimum of one question for every section within the Wikipedia page.",
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
                  description:
                    "If the wikipedia page has links to other wikipedia pages, include the exact name of the page with the same case and underscores. Also don't include anchor links or redirects, only unique pages that exist."
                },
                description:
                  "These are references to relevant pages on Wikipedia to the question and answer, but are not the page we are getting content from. They must be pages that exist on Wikipedia as full pages. Do not use links that say: (Redirected from <link>) because they don't have Wikipedia pages. Don't provide links that mention redirects. Don't include the portion before the slash /. For instance, it should be Pro_Football_Hall_of_Fame, not /wiki/Pro_Football_Hall_of_Fame. Do not include anchor links (e.g., Auckland_Zoo#Major_exhibits)."
              },
              media_links: {
                type: "array",
                items: {
                  type: "string",
                  description:
                    "If there is a link to an image in the section where we are getting the question/answer pair, include it here. The link should start with https://. It should not start with 'url:https://'. Do not provide a { or other wrapping aroudn the media_link URL. Don't reuse the same image for more than one Q&A. DO NOT MAKE UP A LINK."
                },
                description:
                  "If there is a link to an image in the section where we are getting the question/answer pair, include it here. The link should start with https://. It should not start with 'url:https://'. Do not provide a { or other wrapping aroudn the media_link URL. Don't reuse the same image for more than one Q&A. DO NOT MAKE UP A LINK."
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
      "This is the second run of the same function, we have included the questions and answers we generated from the first pass so you don't repeat those. You are still the professor of the subject of this wikipedia page, provide a list of at least 5 questions and answers that are the most important elements of this subject. Make sure that you answer with details, like names, dates, places, references, and so forth. If there are any images that would enrich the question or answer, make sure to include those URLs. Do NOT change the case of Wikipedia page titles or cross-links. Make sure we have broad coverage of the subject, there should be a minimum of one question for every section within the Wikipedia page.",
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
                  description:
                    "If the wikipedia page has links to other wikipedia pages, include the exact name of the page with the same case and underscores. Also don't include anchor links or redirects, only unique pages that exist."
                },
                description:
                  "These are references to relevant pages on Wikipedia to the question and answer, but are not the page we are getting content from. They must be pages that exist on Wikipedia as full pages. Do not use links that say: (Redirected from <link>) because they don't have Wikipedia pages. Don't provide links that mention redirects. Don't include the portion before the slash /. For instance, it should be Pro_Football_Hall_of_Fame, not /wiki/Pro_Football_Hall_of_Fame. Do not include anchor links (e.g., Auckland_Zoo#Major_exhibits)."
              },
              media_links: {
                type: "array",
                items: {
                  type: "string",
                  description:
                    "If there is a link to an image in the section where we are getting the question/answer pair, include it here. The link should start with https://. It should not start with 'url:https://'. Do not provide a { or other wrapping aroudn the media_link URL. Don't reuse the same image for more than one Q&A. DO NOT MAKE UP A LINK."
                },
                description:
                  "If there is a link to an image in the section where we are getting the question/answer pair, include it here. The link should start with https://. It should not start with 'url:https://'. Do not provide a { or other wrapping aroudn the media_link URL. Don't reuse the same image for more than one Q&A. DO NOT MAKE UP A LINK."
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
export function truncateContent(content, maxTokens = 90000) {
  // Rough estimate: 4 characters per token
  const charLimit = maxTokens * 4;

  // If content alone exceeds the limit, we slice it
  if (content.length > charLimit) {
    console.warn(
      `[truncateContent] Content is too large. Truncating to ${maxTokens} tokens.`
    );

    // Trim some extra room (e.g., 1000 chars) to finish on a sentence boundary
    let truncatedContent = content.slice(0, charLimit - 1000);

    // Attempt to end nicely at the last sentence boundary
    const lastSentenceEnd = truncatedContent.lastIndexOf(". ");
    if (lastSentenceEnd > 0) {
      truncatedContent = truncatedContent.slice(0, lastSentenceEnd + 1);
    }

    return {
      truncatedContent
    };
  }

  // Otherwise, return the full content if it's below the limit
  return {
    truncatedContent: content
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
export async function generateStructuredFAQs(title, content, rawTimestamp) {
  const retryAttempts = 3;
  let lastError = null; 

  for (let attempt = 0; attempt < retryAttempts; attempt++) {
    try {
      const { truncatedContent } = truncateContent(content);
      const contentSnippet = truncatedContent;

      console.log(
        `[generateStructuredFAQs] Attempt ${attempt + 1} for "${title}"`
      );

      const userMessage = `
Title: ${title}
Last Updated: ${rawTimestamp}
Content:
${contentSnippet}
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
                "You are the professor of the subject of this wikipedia page, provide a list of at least 5 questions and answers that are the most important elements of this subject. Make sure that you answer with details, like names, dates, places, references, and so forth. If there are any images that go with the answer, make sure to include those URLs. Do NOT change the case of Wikipedia page titles or cross-links"
            },
            {
              role: "user",
              content: `You are the professor of the subject of this wikipedia page, provide a list of at least 5 questions and answers that are the most important elements of this subject. Make sure that you answer with details, like names, dates, places, references, and so forth. If there are any images that go with the answer, make sure to include those URLs. Do NOT change the case of Wikipedia page titles or cross-links. Content includes:

Title: ${title}
Last Updated: ${rawTimestamp}
Content:
${contentSnippet},
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

      // NEW LOGGING FOR DEBUGGING:
      console.log("[generateStructuredFAQs] openaiResponse usage:", response.usage || "No usage data");
      console.log("[generateStructuredFAQs] openaiResponse headers:", response.headers || "No headers present");
      console.log("[generateStructuredFAQs] openaiRequestId:", response.headers?.["openai-request-id"] || "No request ID");

      // The model's choices
      const firstChoiceText = response.choices[0]?.message?.content?.slice(0, 200) || "";
      console.log("[generateStructuredFAQs] Excerpt of the first choice (200 chars):", firstChoiceText);

      // Use the newer function_call property
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
// Utility: Format cross-links without altering case or underscores
// ------------------------------------------------------------------
export function formatCrossLinks(faqs) {
  if (!Array.isArray(faqs)) {
    console.error("[formatCrossLinks] ❌ Invalid faqs input:", faqs);
    return [];
  }

  return faqs
    .flatMap((faq) => faq.cross_links || [])
    .filter(Boolean)
    // Exclude links with '#', e.g. anchor links
    .filter((link) => !link.includes("#"))
    .map((link) => {
      // If it starts with '/wiki/', remove that prefix
      if (link.startsWith("/wiki/")) {
        return link.slice("/wiki/".length); // e.g. from "/wiki/Anthony_van_Dyck" => "Anthony_van_Dyck"
      }
      return link;
    })
    // Ensure we filter out empty strings (just in case)
    .filter(Boolean);
}


// ------------------------------------------------------------------
// Utility: Save or find metadata for a page in faq_files
// ------------------------------------------------------------------
export function formatWikipediaSlug(title) {
  // We want to see exactly what comes in and out
  console.log("[formatWikipediaSlug] Received title:", title);
  // If it starts with "/wiki/", remove that prefix
  if (title.startsWith("/wiki/")) {
    const newSlug = title.slice("/wiki/".length);
    console.log("[formatWikipediaSlug] Stripping '/wiki/' prefix =>", newSlug);
    return newSlug;
  }
  // Otherwise, just return exactly what was passed
  console.log("[formatWikipediaSlug] Returning title as-is =>", title);
  return title;
}


export async function saveMetadata(title, humanReadableName) {
  console.log(`[saveMetadata] Called with title="${title}" and humanReadableName="${humanReadableName}"`);
  const slug = formatWikipediaSlug(title);

  // Extra logs for debugging
  console.log("[saveMetadata] Computed slug:", slug);

  const data = {
    slug,
    human_readable_name: humanReadableName,
    created_at: new Date().toISOString()
  };

  console.log("[saveMetadata] Checking or creating metadata with data:", data);
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
        `[saveMetadata] Found existing entry for slug="${slug}", ID ${existingEntry.id}`
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

    console.log(`[saveMetadata] ✅ Created new entry for slug="${slug}", ID ${newEntry.id}`);
    return newEntry.id;
  } catch (err) {
    console.error("[saveMetadata] ❌ Unexpected error:", err.message);
    return null;
  }
}

// A simple “search-like” function, referencing your existing code
async function searchWikipediaForTitle(searchTerm) {
  const apiUrl = new URL('https://en.wikipedia.org/w/api.php');
  apiUrl.searchParams.set('action', 'query');
  apiUrl.searchParams.set('list', 'search');
  apiUrl.searchParams.set('srsearch', searchTerm);
  apiUrl.searchParams.set('utf8', '1');
  apiUrl.searchParams.set('format', 'json');

  // Provide a custom user agent
  const resp = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'MyWikiFixScript/1.0 (myemail@domain.com)'
    }
  });

  if (resp.status === 429) {
    throw new Error(`429 Too Many Requests => ${searchTerm}`);
  }
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} - ${resp.statusText} => ${searchTerm}`);
  }

  const json = await resp.json();
  const results = json?.query?.search;
  if (!results?.length) return null;

  // Return top result
  return results[0].title; // e.g. "Anthony van Dyck"
}


// ------------------------------------------------------------------
// Save first-pass FAQs
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// Save first-pass FAQs
// ------------------------------------------------------------------
export async function saveStructuredFAQ(
  slugTitle,           // This should be the Wikipedia slug version (e.g. "Danny_Elfman")
  url,                 // Full URL of the Wikipedia page
  humanReadableName,   // The human-friendly name (e.g. "Danny Elfman")
  lastUpdated,         // Last update timestamp from Wikipedia
  faqs                 // Array of FAQ objects
) {
  // Check for a valid URL
  if (!url) {
    console.error(`[saveStructuredFAQ] ❌ Missing URL for "${slugTitle}".`);
    return;
  }

  // Check that there are FAQs to save
  if (!faqs || !faqs.length) {
    console.error("[saveStructuredFAQ] No FAQs to save.");
    return;
  }

  // Log the start of the save process using the Wikipedia slug
  console.log(`[saveStructuredFAQ] -> Start, will call saveMetadata with slugTitle="${slugTitle}"`);

  // Save or retrieve metadata using the slug (not the human-readable title)
  const faqFileId = await saveMetadata(slugTitle, humanReadableName);

  // Retrieve the slug from the database for logging/verification purposes
  const { data: fileRow, error: fileErr } = await supabase
    .from("faq_files")
    .select("slug")
    .eq("id", faqFileId)
    .single();
  const dbSlug = fileRow?.slug || "";
  console.log(`[saveStructuredFAQ] -> Retrieved dbSlug="${dbSlug}" from faq_files for ID=${faqFileId}`);

  // If we failed to get a FAQ file ID, log an error and return early
  if (!faqFileId) {
    console.error(
      `[saveStructuredFAQ] ❌ Failed to get or create FAQ file for slugTitle="${slugTitle}".`
    );
    return;
  }
  console.log(`[saveStructuredFAQ] Using faq_file_id=${faqFileId} for slugTitle="${slugTitle}"`);

  // Format cross-links from the FAQ array for later processing
  const allCrossLinks = formatCrossLinks(faqs);
  console.log("[saveStructuredFAQ] Found cross_links after formatting:", allCrossLinks);

  // Process each cross-link to queue additional pages for processing
  for (const link of allCrossLinks) {
    const crossLinkTitle = link.replace(/_/g, " "); // e.g. convert "Danny_Elfman" to "Danny Elfman"
    let bestPageTitle = null;
    try {
      console.log(`[saveStructuredFAQ] Searching Wikipedia for cross_link="${link}" => crossLinkTitle="${crossLinkTitle}"`);
      bestPageTitle = await searchWikipediaForTitle(crossLinkTitle);
    } catch (err) {
      console.error(`[saveStructuredFAQ] Search error: ${err.message} for crossLink="${link}"`);
    }

    // Use the best page title found or fallback to the original link
    const finalPageName = bestPageTitle || link; 
    // Convert spaces to underscores for the final slug
    const pageSlug = finalPageName.replace(/\s/g, "_");
    const crossLinkUrl = `https://en.wikipedia.org/wiki/${pageSlug}`;
    const crossLinkSlug = formatWikipediaSlug(pageSlug);

    console.log(`[saveStructuredFAQ] Cross-link from GPT: "${link}" => bestPageTitle="${finalPageName}" => crossLinkSlug="${crossLinkSlug}" => final URL=${crossLinkUrl}`);

    try {
      const { data: existing } = await supabase
        .from("processing_queue")
        .select("id")
        .eq("slug", crossLinkSlug)
        .maybeSingle();

      if (!existing) {
        await supabase.from("processing_queue").insert([
          {
            title: finalPageName,
            slug: crossLinkSlug,
            url: crossLinkUrl,
            human_readable_name: finalPageName,
            status: "pending",
            source: "cross_link"
          }
        ]);
        console.log(`[saveStructuredFAQ] ✅ Queued cross-link: ${finalPageName} => ${crossLinkUrl}`);
      } else {
        console.log(`[saveStructuredFAQ] Cross-link "${finalPageName}" already in queue with slug="${crossLinkSlug}"`);
      }
    } catch (error) {
      console.error(`[saveStructuredFAQ] Error queueing cross-link for ${finalPageName}:`, error);
    }
  }

  // Prepare to insert each FAQ into the database and generate embeddings for them
  for (const faq of faqs) {
    try {
      console.log(`[saveStructuredFAQ] Inserting FAQ with question="${faq.question}"`);
      let mediaUrl = faq.media_links?.[0] || null;
      if (mediaUrl && typeof mediaUrl === "object" && mediaUrl.url) {
        mediaUrl = mediaUrl.url;
      }

      // Process cross-links for the FAQ: join them as a comma-separated string
      const relatedPages = Array.isArray(faq.cross_links)
        ? faq.cross_links
            .filter(Boolean)
            .map((link) => link.replace(/^\/wiki\//, ""))
            .join(", ") || null
        : null;

      // Build the FAQ data object for insertion into the "raw_faqs" table
      const faqData = {
        faq_file_id: faqFileId,
        url,
        title: slugTitle, // Use the Wikipedia slug here
        human_readable_name: humanReadableName,
        last_updated: lastUpdated,
        subheader: faq.subheader || null,
        question: faq.question,
        answer: faq.answer,
        cross_link: relatedPages,
        media_link: mediaUrl
      };

      console.log("[saveStructuredFAQ] FAQ data (before insert):", faqData);
      const savedFaq = await insertDataToSupabase("raw_faqs", faqData);
      if (!savedFaq) {
        throw new Error("Failed to insert FAQ");
      }

      // Generate embedding text for the FAQ
      const embeddingText = `
Page Title: ${slugTitle}
Subcategory: ${faq.subheader || "General"}
Question: ${faq.question}
Answer: ${faq.answer}
Related Pages: ${relatedPages}
      `.trim();

      console.log(`[saveStructuredFAQ] Generating embedding for FAQ question="${faq.question}"`);
      const embedding = await generateEmbedding(embeddingText);

      // Clean up media links if needed
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

      // Prepare the vector data for Pinecone upsert
      const vector = {
        id: savedFaq.id.toString(),
        values: embedding,
        metadata: {
          faq_file_id: faqFileId.toString(),
          slug: dbSlug,
          question: faq.question || "Unknown Question",
          answer: faq.answer || "No Answer Available",
          url,
          human_readable_name: humanReadableName || "Unknown",
          last_updated: lastUpdated || new Date().toISOString(),
          subheader: faq.subheader || "",
          cross_link: relatedPages ? relatedPages.split(",").map((x) => x.trim()) : [],
          media_link: mediaUrl || ""
        }
      };

      console.log("[saveStructuredFAQ] Prepared vector for Pinecone upsert:", vector);
      vectors.push(vector);
    } catch (err) {
      console.error(`[saveStructuredFAQ] ❌ Error handling FAQ "${faq.question}":`, err);
    }
  }

  // Upsert embeddings to Pinecone in chunks if any vectors exist
  if (vectors.length > 0) {
    console.log(`[saveStructuredFAQ] 🟡 Preparing to upsert ${vectors.length} embeddings to Pinecone in chunks...`);
    const CHUNK_SIZE = 50;
    const justUpsertedIds = [];

    try {
      // Upsert vectors in chunks
      for (let i = 0; i < vectors.length; i += CHUNK_SIZE) {
        const chunk = vectors.slice(i, i + CHUNK_SIZE);
        console.log(`[saveStructuredFAQ] 🟡 Upserting chunk [${i}..${i + chunk.length - 1}] (size ${chunk.length}) to Pinecone...`);
        await index.upsert(chunk);
        console.log(`[saveStructuredFAQ] ✅ Chunk of ${chunk.length} upserted.`);
        for (const v of chunk) {
          justUpsertedIds.push(parseInt(v.id, 10));
        }
      }

      // Mark the rows in the database as having been successfully upserted to Pinecone
      const { error: updateError } = await supabase
        .from("raw_faqs")
        .update({ pinecone_upsert_success: true })
        .in("id", justUpsertedIds);

      if (updateError) {
        console.error(`[saveStructuredFAQ] ❌ Error marking pinecone_upsert_success:`, updateError.message);
      } else {
        console.log(`[saveStructuredFAQ] ✅ Marked pinecone_upsert_success=true for ${justUpsertedIds.length} rows.`);
      }
    } catch (upsertError) {
      console.error(`[saveStructuredFAQ] ❌ Pinecone upsert failed:`, upsertError.message);
    }
  } else {
    console.log(`[saveStructuredFAQ] ⚠️ No vectors to upsert.`);
  }

  console.log(`[saveStructuredFAQ] ✅ Completed saving ${faqs.length} first-pass FAQs for slugTitle="${slugTitle}".`);
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

  console.log(`[fetchWikipediaMetadata] Fetching metadata for slug: "${title}"`);

  try {
    console.log(`[fetchWikipediaMetadata] Full request to: ${endpoint}, params:`, params);
    const response = await axios.get(endpoint, { params });
    const page = Object.values(response.data.query.pages)[0];
    const lastUpdated = page?.revisions?.[0]?.timestamp || null;
    const humanReadableName = page?.title || title;
    console.log(`[fetchWikipediaMetadata] => lastUpdated="${lastUpdated}", humanReadableName="${humanReadableName}"`);
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

    // Return the raw HTML string
    return { content: htmlContent };
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

  // 1) Fetch the row from "processing_queue" by ID
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

  // Check if status is "pending"
  if (record.status !== "pending") {
    console.log(
      `[processOnePageFromDB] Row ${id} not in "pending" status. Current status: ${record.status}`
    );
    return false;
  }

  // 2) Update status to "processing"
  await supabase
    .from("processing_queue")
    .update({ status: "processing", attempts: (record.attempts || 0) + 1 })
    .eq("id", record.id);

  const { title, url: wikiUrl } = record;

  console.log(`[processOnePageFromDB] -> Title in DB record: "${title}"`);
  console.log(`[processOnePageFromDB] -> wikiUrl in DB record: "${wikiUrl}"`);

  // Suppose wikiUrl = "https://en.wikipedia.org/wiki/The_Chicks" or "https://en.wikipedia.org/wiki/San_Diego"
  // We want the part after /wiki/
  // Extract the wikiPageParam from the URL
  let wikiPageParam = null;
  try {
    if (!wikiUrl) {
      throw new Error("No 'url' found in record. Can't fetch Wikipedia page.");
    }
    const parsed = new URL(wikiUrl);
    const pathParts = parsed.pathname.split("/");
    wikiPageParam = pathParts[2] || title; 
    console.log(`[processOnePageFromDB] -> Extracted wikiPageParam="${wikiPageParam}" from url="${wikiUrl}"`);
  } catch (err) {
    console.error(`[processOnePageFromDB] ❌ Could not parse wikiUrl: ${wikiUrl}`, err.message);
    await supabase
      .from("processing_queue")
      .update({
        status: "failed",
        error_message: "Malformed wikiUrl",
        processed_at: new Date().toISOString()
      })
      .eq("id", record.id);
    return false;
  }
  // 3) Fetch metadata (lastUpdated, humanReadableName) and actual content
  const { lastUpdated, humanReadableName } = await fetchWikipediaMetadata(wikiPageParam);
  const pageData = await fetchWikipediaPage(wikiPageParam);

  if (!pageData) {
    console.error(
      `[processOnePageFromDB] ❌ No Wikipedia content for "${wikiPageParam}". Marking failed.`
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

  const { content } = pageData;
  const pageUrl = wikiUrl; // We'll keep the original DB url

  // 4) First Pass
  console.log(`[processOnePageFromDB] -> Generating structured FAQs (1st pass) for "${wikiPageParam}"...`);
  const structured = await generateStructuredFAQs(
    wikiPageParam, // still pass "wikiPageParam" for the prompt
    content,
    lastUpdated
  );
  if (!structured) {
    console.error(
      `[processOnePageFromDB] ❌ First pass failed for "${wikiPageParam}". Marking failed.`
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

  console.log(`[processOnePageFromDB] -> finalName after 1st pass = "${finalName}"`);
  console.log(`[processOnePageFromDB] -> finalTimestamp after 1st pass = "${finalTimestamp}"`);

  console.log(`[processOnePageFromDB] -> Saving first pass FAQs for "${wikiPageParam}"...`);
  await saveStructuredFAQ(wikiPageParam, pageUrl, finalName, finalTimestamp, faqs);

  // 5) Second Pass
  console.log(`[processOnePageFromDB] -> Generating additional FAQs (2nd pass) for "${wikiPageParam}"...`);
  const additionalFaqs = await generateAdditionalFAQs(wikiPageParam, content, faqs);
  if (additionalFaqs && additionalFaqs.length > 0) {
    console.log(
      `[processOnePageFromDB] -> Saving ${additionalFaqs.length} additional FAQ(s) for "${wikiPageParam}"...`
    );
    await saveAdditionalFAQs(
      wikiPageParam,
      additionalFaqs,
      pageUrl,
      finalName,
      finalTimestamp
    );
  } else {
    console.log(`[processOnePageFromDB] -> No additional FAQs returned for "${wikiPageParam}".`);
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
