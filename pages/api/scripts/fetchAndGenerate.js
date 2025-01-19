// scripts/fetchAndGenerate.js

import axios from "axios";
import OpenAI from "openai";
import * as cheerio from "cheerio";
import { pipeline } from "@xenova/transformers";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

console.log("Environment Variables:");
console.log("OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "Loaded" : "Missing");
console.log("NEXT_PUBLIC_SUPABASE_URL:", process.env.NEXT_PUBLIC_SUPABASE_URL || "Not Set");
console.log("NEXT_PUBLIC_SUPABASE_ANON_KEY:", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "Loaded" : "Missing");

let globalSupabase = null; // Ensure single instance
const BATCH_SIZE = 32;

let embedder = null;

const handleError = (context, error) => {
  console.error(`[${context}] Error:`, {
    message: error.message,
    stack: error.stack,
    cause: error.cause
  });
  return null;
};

// Use it in your error handlers
try {
  // Some operation
} catch (error) {
  handleError('saveStructuredFAQ', error);
}



async function initEmbedder() {
  if (!embedder) {
    console.log("[initEmbedder] Initializing BGE embedding model...");
    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        embedder = await pipeline('feature-extraction', 'BAAI/bge-large-en-v1.5', {
          revision: 'main',
          quantized: true,
          load_in_8bit: true, // Use 8-bit quantization
          low_memory: true // Enable low memory mode
        });
        console.log("[initEmbedder] ✅ BGE embedder initialized successfully.");
        break;
      } catch (error) {
        retries++;
        console.error(`[initEmbedder] Attempt ${retries} failed:`, error.message);
        if (retries === maxRetries) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      }
    }
  }
  return embedder;
}

const generateEmbedding = async (text) => {
  try {
    console.log('[generateEmbedding] Generating embedding for:', text);

    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
      dimensions: 1536  // Using 1536 dimensions for compatibility with existing database
    });

    console.log('[generateEmbedding] Successfully generated embedding');
    return embedding.data[0].embedding;
  } catch (error) {
    console.error('[generateEmbedding] Error generating embedding:', error.message);
    throw error;
  }
};



export function initClients() {
  console.log("[initClients] Initializing clients...");

  if (globalSupabase) {
    console.log("[initClients] Using cached Supabase client.");
    return { openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), supabase: globalSupabase };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[initClients] ❌ Missing Supabase environment variables");
    return { openai: null, supabase: null };
  }

  console.log("[initClients] Supabase URL:", supabaseUrl);
  console.log("[initClients] Supabase Anon Key:", supabaseAnonKey ? "✅ Loaded" : "❌ Missing");

  try {
    globalSupabase = createClient(supabaseUrl, supabaseAnonKey);
    console.log("[initClients] ✅ Supabase client successfully initialized!");

    return { openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), supabase: globalSupabase };
  } catch (error) {
    console.error("[initClients] ❌ Failed to initialize Supabase:", error.message);
    return { openai: null, supabase: null };
  }
}

// Initialize clients
const { openai, supabase } = initClients();

if (!openai || !supabase) {
  console.error("[startProcess] ❌ One or more clients failed to initialize.");
  process.exit(1);
}

console.log("[startProcess] ✅ Clients initialized. Starting main process...");


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
                  description: "Cross-links for the FAQ derived from the section. Don't include the portion before the slash / . For instance it should be Pro_Football_Hall_of_Fame not /wiki/Pro_Football_Hall_of_Fame"
                },
                media_links: {
                  type: "array",
                  items: { type: "string", description: "Relevant media links from the content." },
                  description: "Media links (e.g., images) relevant to the Q&A. Use the links exactly as they were provided in the original Wikipedia file sent to you. Don't reuse the same image for more than one Q&A. If there is no image that fits the question very well and would add value to the reader, then don't include a media link.",
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
  {
    type: "function",
    function: {
      name: "generate_additional_faqs",
      description: "Generate additional structured FAQs from Wikipedia content by identifying key concepts that weren't covered in the first pass. Like the initial pass, start with the most interesting questions and work your way to the least interesting. Ensure clarity, relevance, and engagement, avoiding unnecessary jargon. Be thorough in finding new angles and uncovered information from Wikipedia, but focus on what most people would find the most interesting questions that weren't already asked. Make sure to expand upon those answers comprehensively. If there are any unused images that go with the answer, make sure to include those URLs, being careful not to reuse images from the first pass.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The title of the Wikipedia page." },
          human_readable_name: { type: "string", description: "The human-readable page name." },
          last_updated: { type: "string", description: "The last update timestamp of the page." },
          additional_faqs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                subheader: { type: "string", description: "The subheader under which this FAQ falls." },
                question: { type: "string", description: "A new question derived from the content that wasn't covered in the first pass." },
                answer: { type: "string", description: "The comprehensive answer to the question." },
                cross_links: {
                  type: "array",
                  items: { type: "string", description: "Relevant cross-links from Wikipedia." },
                  description: "Cross-links for the FAQ derived from the section.",
                },
                media_links: {
                  type: "array",
                  items: { type: "string", description: "Relevant media links from the content." },
                  description: "Media links (e.g., images) relevant to the Q&A. Use the links exactly as they were provided in the original Wikipedia file sent to you. Don't reuse the same image for more than one Q&A or any images used in the first pass.",
                },
              },
              required: ["subheader", "question", "answer"],
            },
            description: "A list of additional FAQs organized by subheaders that complement the existing FAQs.",
          },
        },
        required: ["title", "human_readable_name", "last_updated", "additional_faqs"],
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

const saveMetadata = async (slug, humanReadableName, supabase) => {
  const data = {
    slug,
    human_readable_name: humanReadableName,
    file_path: "",
    created_at: new Date().toISOString(),
  };

  console.log("[saveMetadata] Saving metadata:", JSON.stringify(data, null, 2));

  try {
    const { data: existingEntry, error: checkError } = await supabase
      .from("faq_files")
      .select("id, slug")
      .eq("slug", slug)
      .limit(1)
      .maybeSingle();

    if (checkError) {
      console.error("[saveMetadata] ❌ Error checking for existing slug:", checkError.message);
      return null;
    }

    if (existingEntry) {
      console.log(`[saveMetadata] 🔹 Found existing entry for "${slug}"`);
      return existingEntry.id;
    }

    const { data: newEntry, error } = await supabase
      .from("faq_files")
      .insert([data])
      .select('id')
      .single();

    if (error) {
      console.error("[saveMetadata] ❌ Error inserting metadata:", error.message);
      return null;
    }

    console.log(`[saveMetadata] ✅ Successfully saved: ${slug}, ID: ${newEntry.id}`);
    return newEntry.id;
  } catch (error) {
    console.error("[saveMetadata] ❌ Unexpected error:", error.message);
    return null;
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


const generateAdditionalFAQs = async (title, content, existingFAQs, images) => {
  try {
    const { truncatedContent, truncatedMediaLinks } = truncateContent(content, images);

    // Create a set of used images to avoid reuse
    const usedImages = new Set(existingFAQs.flatMap(faq => faq.media_links || []));
    const unusedImages = truncatedMediaLinks.filter(img => !usedImages.has(img));

    const existingQuestions = existingFAQs.map(faq => `- ${faq.question}\n  Subheader: ${faq.subheader}\n  Used images: ${(faq.media_links || []).join(", ")}`).join('\n');

    const contentWithImages = `
      ${truncatedContent}

      Available Unused Images:
      ${unusedImages.map((url, index) => `[Image ${index + 1}]: ${url}`).join("\n")}
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a brilliant writer tasked with extracting additional fascinating FAQs from Wikipedia content that weren't covered in the first pass. Start with the most interesting uncovered questions and work your way down. Focus on clarity, relevance, and engagement while avoiding jargon. Use all available information from Wikipedia, but prioritize what most people would find most interesting among the topics not yet covered. Ensure comprehensive answers and proper use of available images that haven't been used before.",
        },
        {
          role: "user",
          content: `Generate additional structured FAQs from this Wikipedia content, avoiding overlap with existing questions while maintaining the same high quality standards. Focus on interesting aspects that weren't covered in the first pass. DO NOT REPEAT EXISTING QUESTIONS.

Title: ${title}

Content:
${contentWithImages}

Existing Questions (to avoid duplication):
${existingQuestions}

Requirements:
1. Generate entirely new questions that don't overlap with existing ones
2. Focus on the most interesting uncovered aspects first
3. Provide comprehensive, engaging answers
4. Only use images that weren't used in the first pass
5. Maintain the same high standards of clarity and relevance
6. Group under appropriate subheaders
7. Include relevant cross-links`,
        },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "generate_additional_faqs" } }
    });

    const toolCall = response.choices[0].message.tool_calls?.[0];
    if (!toolCall) {
      console.error(`[generateAdditionalFAQs] No function call generated for ${title}.`);
      return null;
    }

    const args = JSON.parse(toolCall.function.arguments);
    return args.additional_faqs;
  } catch (error) {
    console.error(`[generateAdditionalFAQs] Error: ${error.message}`);
    return [];
  }
};


const processWithEnrichment = async (title, content, images, url, humanReadableName, lastUpdated) => {
  console.log(`[processWithEnrichment] Starting enrichment process for "${title}"`);

  // First pass - generate initial FAQs
  const structuredFAQs = await generateStructuredFAQs(title, content, lastUpdated, images);
  if (!structuredFAQs) {
    console.error(`[processWithEnrichment] Initial FAQ generation failed for "${title}"`);
    return false;
  }

  // Save initial FAQs
  const { faqs, human_readable_name, last_updated } = structuredFAQs;
  await saveStructuredFAQ(title, url, human_readable_name, last_updated, faqs);

  // Second pass - generate additional FAQs
  console.log(`[processWithEnrichment] Starting second pass for "${title}"`);
  const additionalFAQs = await generateAdditionalFAQs(title, content, faqs, images);

  if (additionalFAQs && additionalFAQs.length > 0) {
    console.log(`[processWithEnrichment] Found ${additionalFAQs.length} additional FAQs for "${title}"`);
    await saveStructuredFAQ(title, url, human_readable_name, last_updated, additionalFAQs);
  }

  return true;
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

async function insertDataToSupabase(tableName, data) {
  try {
    console.log(`[Supabase] Attempting to insert into ${tableName}:`, data);
    const { data: insertedData, error } = await supabase
      .from(tableName)
      .insert([data])
      .select('*')  // Add this to get the inserted data back
      .single();    // Add this to get a single row

    if (error) {
      console.error(`[Supabase] Error inserting into ${tableName}:`, error.message);
      throw error;
    }

    if (!insertedData) {
      throw new Error(`No data returned from ${tableName} insert`);
    }

    console.log(`[Supabase] Successfully inserted into ${tableName}:`, insertedData);
    return insertedData;
  } catch (error) {
    console.error(`[Supabase] Unexpected error during insert into ${tableName}:`, error.message);
    throw error;
  }
}




const saveStructuredFAQ = async (title, url, humanReadableName, lastUpdated, faqs) => {
  if (!faqs || !faqs.length) {
    console.error("[saveStructuredFAQ] No FAQs to save.");
    return;
  }

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const faqFileId = await saveMetadata(slug, humanReadableName, supabase);

  if (!faqFileId) {
    console.error("[saveStructuredFAQ] Failed to get or create FAQ file entry.");
    return;
  }

  console.log("[saveStructuredFAQ] Processing FAQs with FAQ file ID:", faqFileId);

  // Process FAQs in batches
  const BATCH_SIZE = 5;
  const batches = [];

  for (let i = 0; i < faqs.length; i += BATCH_SIZE) {
    batches.push(faqs.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    await Promise.all(
      batch.map(async (faq) => {
        try {
          // Prepare FAQ data
          const faqData = {
            faq_file_id: faqFileId,
            url,
            title,
            human_readable_name: humanReadableName,
            last_updated: lastUpdated,
            subheader: faq.subheader || null,
            question: faq.question,
            answer: faq.answer,
            cross_link: faq.cross_links ? faq.cross_links.join(", ") : null,
            media_link: faq.media_links?.[0] || null,
            image_urls: faq.media_links ? faq.media_links.join(", ") : null,
          };

          // Save FAQ
          console.log(`[saveStructuredFAQ] Saving FAQ: "${faq.question}"`);
          const savedFaq = await insertDataToSupabase('raw_faqs', faqData);

          if (!savedFaq) {
            throw new Error('Failed to save FAQ');
          }

          // Generate and save embedding
          console.log(`[saveStructuredFAQ] Generating embedding for: "${faq.question}"`);
          const embedding = await generateEmbedding(faq.question);

          // Save embedding
          const embeddingData = {
            faq_id: savedFaq.id,
            question: faq.question,
            embedding
          };

          await insertDataToSupabase('faq_embeddings', embeddingData);
          console.log(`[saveStructuredFAQ] ✅ Saved FAQ and embedding for: "${faq.question}"`);

        } catch (error) {
          console.error(`[saveStructuredFAQ] Error processing FAQ: "${faq.question}"`, error);
        }
      })
    );
  }
};


// Add this utility function to handle cross-links properly
const formatCrossLinks = (links) => {
  if (!links) return [];
  try {
    if (typeof links === 'string') {
      return links.split(',')
        .map(link => link.trim())
        .map(link => {
          // Remove /wiki/ prefix if present
          const cleanLink = link.replace(/^\/wiki\//, '');
          // Decode URL-encoded characters
          return decodeURIComponent(cleanLink);
        })
        .filter(Boolean); // Remove empty links
    }
    return links;
  } catch {
    return [];
  }
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



export async function main(openai, supabase, newPagesTarget = 50) {
  console.log("[main] Verifying received clients...");
  console.log("[main] OpenAI client:", openai ? "✅ Initialized" : "❌ Missing");
  console.log("[main] Supabase client:", supabase ? "✅ Initialized" : "❌ Missing");

  if (!openai || !supabase) {
    console.error("[main] ❌ Missing required clients. Exiting...");
    throw new Error("[main] Missing required clients");
  }

  console.log("[main] Starting FAQ generation process...");
  let processedCount = 0;
  let offset = 0;

  try {
    console.log("[main] Checking Supabase client initialization...");
    console.log("[Supabase] Client Instance:", supabase ? "Initialized" : "❌ Not Initialized");

    console.log("[main] Testing Supabase connection...");
    const { data: connectionTest, error: connectionError } = await supabase.rpc("test_connection");
    if (connectionError) {
      throw new Error(`[Supabase] Connection test failed: ${connectionError.message}`);
    }
    console.log("[Supabase] Connection test successful:", connectionTest);

    while (processedCount < newPagesTarget) {
      const titles = await fetchTopWikipediaPages(offset, 50);
      if (!titles.length) {
        console.error("[main] No more titles to fetch. Exiting...");
        break;
      }

      for (const title of titles) {
        if (processedCount >= newPagesTarget) {  // 🔹 Ensure we stop exactly at 2
          console.log(`[main] Processed ${processedCount} pages. Target reached.`);
          return;
        }

        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        console.log(`[main] Checking existence for slug: "${slug}"`);

        const { data: existingEntry, error: existenceError } = await supabase
          .from("faq_files")
          .select("slug")
          .eq("slug", slug)
          .limit(1)
          .maybeSingle(); 

        if (existenceError) {
          console.error(`[main] Error checking slug existence for "${slug}":`, existenceError.message);
          continue;
        }

        if (existingEntry) {
          console.log(`[main] Skipping "${title}" as it already exists in the database.`);
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

        console.log(`[main] Saving metadata for "${title}"`);
        const metadataSaved = await saveMetadata(slug, humanReadableName, supabase);
        if (!metadataSaved) {
          console.error(`[main] Failed to save metadata for "${title}".`);
          continue;
        }

        console.log(`[main] Metadata saved successfully. Proceeding to FAQ generation for "${title}"`);

        const success = await processWithEnrichment(title, content, images, url, humanReadableName, lastUpdated);

        if (success) {
          processedCount++; // 🔹 Only increment if the process succeeds
          console.log(`[main] ✅ Successfully processed: ${title} (Total: ${processedCount})`);
        } else {
          console.error(`[main] ❌ Enrichment process failed for "${title}".`);
        }
      }

      offset += 50; // Move to next batch of Wikipedia pages
    }


    console.log(`[main] FAQ generation process completed. Processed ${processedCount} pages.`);
  } catch (error) {
    console.error(`[main] Unexpected error:`, error.message);
    throw error;
  }
}





// 🚀 **Fix: Call `startProcess()` Only Once**
async function startProcess() {
  console.log("[startProcess] Initializing clients...");

  // Ensure clients are only initialized once
  const { openai, supabase } = initClients();

  if (!openai || !supabase) {
    console.error("[startProcess] ❌ One or more clients failed to initialize.");
    process.exit(1);
  }

  console.log("[startProcess] ✅ Clients initialized. Starting main process...");

  try {
    await main(openai, supabase, 2);
    console.log("[startProcess] 🎉 Execution finished successfully.");
    process.exit(0);
  } catch (error) {
    console.error("[startProcess] ❌ An error occurred:", error);
    process.exit(1);
  }
}

// Call the function once (prevents duplication)
startProcess();
