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
const MEDIA_PAGE_LIMIT = 1; // Change this value if you want to process more pages
let processedCount = 0; // Track the number of successfully processed pages

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
      description: "Generate structured FAQs from Wikipedia content by identifying key concepts and framing them as fascinating Q&A pairs. Start with the most interesting questions and work your way to the least interesting. Ensure clarity, relevance, and engagement, avoiding unnecessary jargon. Be thorough, using all of the information from Wikipedia, but focus on what most people would find the most interesting questions to be answered and expand upon those answers. If there are any images that go with the answer, make sure to include those URLs. Do NOT change the case of Wikipedia page titles or cross-links",
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
                question: { type: "string", description: "A question derived from the content. These should be interesting questions where we have something unique in the answer to share." },
                answer: { type: "string", description: "The answer to the question. These should be rich with facts and data, but also written in an engaging manner that would appeal to a wide audience." },
                cross_links: {
                  type: "array",
                  items: { type: "string", description: "Relevant cross-links from Wikipedia." },
                  description: "Cross-links for the FAQ derived from the section. Don't include the portion before the slash / . For instance it should be Pro_Football_Hall_of_Fame not /wiki/Pro_Football_Hall_of_Fame. Do not include anchor links (Auckland_Zoo#Major_exhibits is not ok, especially if you are already on the Auckland_Zoo page)"
                },
                media_links: {
                  type: "array",
                  items: { type: "string", description: "Relevant media links from the content." },
                  description: "Media links (e.g., images) relevant to the Q&A. Use the links exactly as they were provided in the original Wikipedia file sent to you. It should start with https://. It should not start with 'url:https://'. Don't reuse the same image for more than one Q&A. If there is no image that fits the question very well and would add value to the reader, then don't include a media link.",
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
      description: "Generate additional structured FAQs from Wikipedia content by identifying key concepts that weren't covered in the first pass. Like the initial pass, start with the most interesting questions and work your way to the least interesting. Ensure clarity, relevance, and engagement, avoiding unnecessary jargon. Be thorough in finding new angles and uncovered information from Wikipedia, but focus on what most people would find the most interesting questions that weren't already asked. Make sure to expand upon those answers comprehensively. If there are any unused images that go with the answer, make sure to include those URLs, being careful not to reuse images from the first pass. Do NOT change the case of Wikipedia page titles or cross-links",
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
                question: { type: "string", description: "A new question derived from the content that wasn't covered in the first pass. These should be interesting questions where we have something unique in the answer to share." },
                answer: { type: "string", description: "The answer to the question. These should be rich with facts and data, but also written in an engaging manner that would appeal to a wide audience." },
                cross_links: {
                  type: "array",
                  items: { type: "string", description: "Relevant cross-links from Wikipedia." },
                  description: "Cross-links for the FAQ derived from the section. Don't include the portion before the slash / . For instance it should be Pro_Football_Hall_of_Fame not /wiki/Pro_Football_Hall_of_Fame. Do not include anchor links (Auckland_Zoo#Major_exhibits is not ok, especially if you are already on the Auckland_Zoo page)",
                },
                media_links: {
                  type: "array",
                  items: { type: "string", description: "Relevant media links from the content." },
                  description: "Media links (e.g., images) relevant to the Q&A. Use the links exactly as they were provided in the original Wikipedia file sent to you. It should start with https://. It should not start with 'url:https://'. Don't reuse the same image for more than one Q&A. If there is no image that fits the question very well and would add value to the reader, then don't include a media link.",
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

const saveMetadata = async (title, humanReadableName, supabase) => {
  const slug = formatWikipediaSlug(title); 

  const data = {
    slug,  
    human_readable_name: humanReadableName,
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

    // Ensure images are passed in the prompt
    const contentWithImages = `
      ${truncatedContent}
      Relevant Images:
      ${truncatedMediaLinks.map((url, index) => `[Image ${index + 1}]: ${url}`).join("\n")}
    `;

    console.log(`[generateStructuredFAQs] Sending ${truncatedMediaLinks.length} images to OpenAI for processing.`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a brilliant writer that extracts structured FAQs from Wikipedia content. Start with the most interesting questions and use all of the content from the entire page to generate fascinating and accurate answers. **Use the images provided whenever relevant to the FAQ.**",
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
  console.log(`[processWithEnrichment] Processing "${title}"`);

  // **Pass ALL image URLs to OpenAI for FAQ generation**
  console.log(`[processWithEnrichment] Passing ${images.length} images to OpenAI for FAQ generation.`);

  // **First Pass: Generate Initial FAQs**
  const structuredFAQs = await generateStructuredFAQs(title, content, lastUpdated, images);
  if (!structuredFAQs) {
    console.error(`[processWithEnrichment] ❌ Initial FAQ generation failed for "${title}"`);
    return false;
  }

  // Save initial FAQs
  const { faqs, human_readable_name, last_updated } = structuredFAQs;
  await saveStructuredFAQ(title, url, human_readable_name, last_updated, faqs);

  // **Second Pass: Generate Additional FAQs**
  console.log(`[processWithEnrichment] Starting second pass for "${title}"`);
  const additionalFAQs = await generateAdditionalFAQs(title, content, faqs, images);

  if (additionalFAQs && additionalFAQs.length > 0) {
    console.log(`[processWithEnrichment] ✅ Found ${additionalFAQs.length} additional FAQs for "${title}"`);
    await saveAdditionalFAQs(title, additionalFAQs, url, human_readable_name, last_updated);
  } else {
    console.log(`[processWithEnrichment] No additional FAQs were generated for "${title}".`);
  }

  return true;
};












async function insertDataToSupabase(tableName, data) {
  try {
    // console.log(`[Supabase] Attempting to insert into ${tableName}:`, data);
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

    // console.log(`[Supabase] Successfully inserted into ${tableName}:`, insertedData);
    return insertedData;
  } catch (error) {
    console.error(`[Supabase] Unexpected error during insert into ${tableName}:`, error.message);
    throw error;
  }
}

const saveAdditionalFAQs = async (title, additionalFaqs, url, humanReadableName, lastUpdated) => {
  if (!additionalFaqs || !additionalFaqs.length) {
    console.error("[saveAdditionalFAQs] No additional FAQs to save.");
    return;
  }

  const slug = formatWikipediaSlug(title);
  console.log(`[saveAdditionalFAQs] Fetching FAQ file ID for "${slug}"`);

  const { data: faqFile, error } = await supabase
    .from("faq_files")
    .select("id")
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();

  if (error || !faqFile) {
    console.error(`[saveAdditionalFAQs] ❌ FAQ file not found for "${slug}". Skipping.`);
    return;
  }

  console.log(`[saveAdditionalFAQs] Found FAQ file ID: ${faqFile.id}`);

  for (const faq of additionalFaqs) {
    try {
      const relatedPages = faq.cross_links ? faq.cross_links.join(", ") : "No related pages";

      const embeddingText = `
        Page Title: ${title}
        Subcategory: ${faq.subheader || "General"}
        Question: ${faq.question}
        Answer: ${faq.answer}
        Related Pages: ${relatedPages}
      `.trim();

      let mediaLink = faq.media_links?.[0] || null;
      if (mediaLink && typeof mediaLink === 'object' && mediaLink.url) {
        mediaLink = mediaLink.url;
      }

      const faqData = {
        faq_file_id: faqFile.id,
        url: url || `https://en.wikipedia.org/wiki/${title}`,
        title: title,
        human_readable_name: humanReadableName, // ✅ Ensure this is saved
        last_updated: lastUpdated, // ✅ Ensure this is saved
        subheader: faq.subheader || null,
        question: faq.question,
        answer: faq.answer,
        cross_link: relatedPages,
        media_link: mediaLink,
      };

      console.log(`[saveAdditionalFAQs] Saving additional FAQ: "${faq.question}"`);
      const savedFaq = await insertDataToSupabase('raw_faqs', faqData);

      if (!savedFaq) {
        throw new Error('Failed to save additional FAQ');
      }

      // **Generate and Save Embedding**
      console.log(`[saveAdditionalFAQs] Generating embedding for additional FAQ: "${faq.question}"`);
      const embedding = await generateEmbedding(embeddingText);

      const embeddingData = {
        faq_id: savedFaq.id,
        question: faq.question,
        embedding,
      };

      await insertDataToSupabase('faq_embeddings', embeddingData);
      console.log(`[saveAdditionalFAQs] ✅ Saved additional FAQ and embedding for: "${faq.question}"`);

    } catch (error) {
      console.error(`[saveAdditionalFAQs] ❌ Error processing additional FAQ: "${faq.question}"`, error);
    }
  }
};










const formatWikipediaSlug = (title) => title.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();


const saveStructuredFAQ = async (title, url, humanReadableName, lastUpdated, faqs) => {
  if (!url) {
    console.error(`[saveStructuredFAQ] ❌ URL is missing for "${title}". Skipping...`);
    return;
  }

  if (!faqs || !faqs.length) {
    console.error("[saveStructuredFAQ] No FAQs to save.");
    return;
  }

  const slug = formatWikipediaSlug(title);
  const faqFileId = await saveMetadata(slug, humanReadableName, supabase);

  if (!faqFileId) {
    console.error("[saveStructuredFAQ] ❌ Failed to get or create FAQ file entry.");
    return;
  }

  console.log("[saveStructuredFAQ] Processing FAQs with FAQ file ID:", faqFileId);

  for (const faq of faqs) {
    try {
      const relatedPages = faq.cross_links ? faq.cross_links.join(", ") : "No related pages";

      // **Fix: Extract actual URL if media_links contain an object**
      let mediaUrl = faq.media_links?.[0] || null;
      if (mediaUrl && typeof mediaUrl === "object" && mediaUrl.url) {
        mediaUrl = mediaUrl.url; // Extract the actual URL
      }

      const embeddingText = `
        Page Title: ${title}
        Subcategory: ${faq.subheader || "General"}
        Question: ${faq.question}
        Answer: ${faq.answer}
        Related Pages: ${relatedPages}
      `.trim();

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
        media_link: mediaUrl, // **Fixed media URL**
      };

      console.log(`[saveStructuredFAQ] Saving FAQ: "${faq.question}"`);
      const savedFaq = await insertDataToSupabase('raw_faqs', faqData);

      if (!savedFaq) {
        throw new Error('Failed to save FAQ');
      }

      // **Generate and Save Embedding**
      console.log(`[saveStructuredFAQ] Generating embedding for FAQ: "${faq.question}"`);
      const embedding = await generateEmbedding(embeddingText);

      const embeddingData = {
        faq_id: savedFaq.id,
        question: faq.question,
        embedding,
      };

      await insertDataToSupabase('faq_embeddings', embeddingData);
      console.log(`[saveStructuredFAQ] ✅ Saved FAQ and embedding for: "${faq.question}"`);

    } catch (error) {
      console.error(`[saveStructuredFAQ] ❌ Error processing FAQ: "${faq.question}"`, error);
    }
  }
};


const convertWikipediaPathToUrl = (path) => {
    if (!path.startsWith("/wiki/")) {
        console.error(`[convertWikipediaPathToUrl] Invalid Wikipedia path: ${path}`);
        return null;
    }
    const wikipediaUrl = `https://en.wikipedia.org${path}`;
    console.log(`[convertWikipediaPathToUrl] Converted URL: ${wikipediaUrl}`);
    return wikipediaUrl;
};







// Add this utility function to handle cross-links properly
const formatCrossLinks = (links) => {
  if (!links) return [];
  try {
    if (typeof links === 'string') {
      return links.split(',')
        .map(link => link.trim())
        .filter(link => !link.includes('#')) // ❌ Remove anchor links
        .map(link => {
          // Remove /wiki/ prefix if present
          const cleanLink = link.replace(/^\/wiki\//, '');
          // Decode URL-encoded characters
          return decodeURIComponent(cleanLink);
        })
        .filter(Boolean); // Remove empty links
    }
    return links.filter(link => !link.includes('#')); // Remove anchors in array input
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

// **Step 1: Fetch Media Links from Existing FAQs**
async function fetchMediaLinksFromFAQs() {
  console.log("[fetchMediaLinksFromFAQs] Retrieving media links from stored FAQs...");

  try {
    const { data, error } = await supabase
      .from("raw_faqs")
      .select("media_link")
      .not("media_link", "is", null) // Ensure we're only getting non-null media links
      .limit(50); // Fetch up to 50 media links

    if (error) {
      console.error("[fetchMediaLinksFromFAQs] ❌ Error retrieving media links:", error.message);
      return [];
    }

    // Collect unique media URLs
    const uniqueMediaLinks = [...new Set(data.map(faq => faq.media_link).filter(Boolean))];

    console.log(`[fetchMediaLinksFromFAQs] Found ${uniqueMediaLinks.length} media links.`);
    return uniqueMediaLinks;
  } catch (error) {
    console.error("[fetchMediaLinksFromFAQs] ❌ Unexpected error:", error.message);
    return [];
  }
}


// **Step 2: Fetch Wikipedia Titles for Media Links**
async function fetchWikipediaTitlesForMedia(mediaLinks) {
  console.log(`[fetchWikipediaTitlesForMedia] Fetching Wikipedia titles for media links...`);

  let processedTitles = [];

  for (let link of mediaLinks) {
    if (processedTitles.length >= MEDIA_PAGE_LIMIT) break;  // 🔹 Cap number of pages

    const match = link.match(/\/wiki\/(File:[^/]+)/);
    if (!match) {
      console.warn(`[fetchWikipediaTitlesForMedia] Skipping invalid media link: ${link}`);
      continue;
    }

    const title = decodeURIComponent(match[1]);  // Extract Wikipedia File title
    if (await isTitleProcessed(title)) {
      console.log(`[fetchWikipediaTitlesForMedia] Skipping already processed title: ${title}`);
      continue;
    }

    processedTitles.push(title);
  }

  console.log(`[fetchWikipediaTitlesForMedia] Processing ${processedTitles.length} Wikipedia media pages.`);
  return processedTitles;
}

// **Step 3: Check if Wikipedia Title Already Processed**
async function isTitleProcessed(title) {
  const normalizedSlug = title.replace(/[^a-zA-Z0-9]+/g, "-"); // Keep the original case

  try {
    const { data, error } = await supabase
      .from("faq_files")
      .select("slug")
      .eq("slug", normalizedSlug)  // ✅ Ensuring case consistency
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(`[isTitleProcessed] ❌ Error checking existence for "${title}":`, error.message);
      return true;
    }

    return Boolean(data);
  } catch (error) {
    console.error(`[isTitleProcessed] ❌ Unexpected error:`, error.message);
    return true;
  }
}


// **Step 4: Fetch Wikipedia Page Content for Media Titles**
async function fetchWikipediaPage(title) {
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
      console.error(`[fetchWikipediaPage] Page not found for: ${title}`);
      return null;
    }

    const htmlContent = page.text?.["*"];
    if (!htmlContent) {
      console.error(`[fetchWikipediaPage] No content available for: ${title}`);
      return null;
    }

    // Parse and extract images
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

    console.log(`[fetchWikipediaPage] Extracted ${images.length} images for ${title}`);
    return { content: htmlContent, images };
  } catch (error) {
    console.error(`[fetchWikipediaPage] Error fetching page "${title}": ${error.message}`);
    return null;
  }
}

// **Step 5: Generate and Save FAQs for Wikipedia Media Pages**
async function processWikipediaMediaPages(maxPages) {
  console.log("[processWikipediaMediaPages] Starting process...");
  let processedCount = 0;

  const mediaLinks = await fetchMediaLinksFromFAQs();
  const wikipediaTitles = await fetchWikipediaTitlesForMedia(mediaLinks);

  for (let title of wikipediaTitles) {
    if (processedCount >= maxPages) {
      console.log(`[processWikipediaMediaPages] ✅ Processed enough media pages (${processedCount}). Stopping.`);
      return processedCount;
    }

    console.log(`[processWikipediaMediaPages] Processing Wikipedia media page: "${title}"`);

    const metadata = await fetchWikipediaMetadata(title);
    const { lastUpdated, humanReadableName } = metadata;

    if (!humanReadableName) {
      console.warn(`[processWikipediaMediaPages] No human-readable name for "${title}". Skipping.`);
      continue;
    }

    const pageData = await fetchWikipediaPage(title);
    if (!pageData) {
      console.error(`[processWikipediaMediaPages] Skipping "${title}" due to empty content.`);
      continue;
    }

    const { content, images } = pageData;
    const url = `https://en.wikipedia.org/wiki/${title}`;

    console.log(`[processWikipediaMediaPages] Generating FAQs for "${title}"`);
    const success = await processWithEnrichment(title, content, images, url, humanReadableName, lastUpdated);

    if (success) {
      processedCount++;
      console.log(`[processWikipediaMediaPages] ✅ Successfully processed media page: ${title} (Total: ${processedCount})`);
    } else {
      console.error(`[processWikipediaMediaPages] ❌ Failed to process media page: ${title}`);
    }
  }

  console.log(`[processWikipediaMediaPages] Process complete. Total processed: ${processedCount}`);
  return processedCount;
}

const isPageAlreadyProcessed = async (title) => {
  const slug = formatWikipediaSlug(title);

  const { data: existingEntry, error } = await supabase
    .from("faq_files")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  return !!existingEntry; // Returns true if the page already exists
};


async function main() {
  console.log("[main] Starting FAQ generation process...");

  let processedCount = 0;

  // **Step 1: Process Related Wikipedia Links (cross_links)**
  console.log("[main] Checking for related Wikipedia links that are missing pages...");

  const { data: relatedLinks, error: relatedLinksError } = await supabase
    .from("raw_faqs")
    .select("cross_link")
    .not("cross_link", "is", null)
    .limit(50); // Get up to 50 cross-links to process

  if (relatedLinksError) {
    console.error("[main] ❌ Error retrieving related links:", relatedLinksError.message);
  } else {
    const uniqueRelatedTitles = [...new Set(relatedLinks.flatMap(faq => faq.cross_link.split(',').map(link => link.trim())))];

    for (const path of uniqueRelatedTitles) {
      if (processedCount >= MEDIA_PAGE_LIMIT) {
        console.log(`[main] ✅ Target reached after processing related links.`);
        return;
      }

      // Convert "/wiki/Page_Name" -> "https://en.wikipedia.org/wiki/Page_Name"
      const url = convertWikipediaPathToUrl(path);
      if (!url) {
        console.warn(`[main] Invalid Wikipedia path: ${path}. Skipping...`);
        continue;
      }

      // Extract Wikipedia title from the path
      const title = path.replace(/^\/wiki\//, "").replace(/_/g, " ");
      console.log(`[main] Processing related Wikipedia page: "${title}"`);

      // Check if this page already exists
      const { data: existingEntry, error: existenceError } = await supabase
        .from("faq_files")
        .select("id")
        .eq("slug", formatWikipediaSlug(title))
        .limit(1)
        .maybeSingle();

      if (existenceError) {
        console.error(`[main] Error checking slug existence for "${title}":`, existenceError.message);
        continue;
      }

      if (existingEntry) {
        console.log(`[main] Skipping "${title}" as it already exists in the database.`);
        continue;
      }

      // Fetch Wikipedia Metadata and Content
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
      const metadataSaved = await saveMetadata(title, humanReadableName, supabase);

      if (!metadataSaved) {
        console.error(`[main] Failed to save metadata for "${title}".`);
        continue;
      }

      console.log(`[main] Metadata saved successfully. Proceeding to FAQ generation.`);
      const success = await processWithEnrichment(title, content, images, url, humanReadableName, lastUpdated);

      if (success) {
        processedCount++;
        console.log(`[main] ✅ Successfully processed: ${title} (Total: ${processedCount})`);
      } else {
        console.error(`[main] ❌ Enrichment process failed for "${title}".`);
      }
    }
  }

  // **Step 2: If we haven't reached our limit, process popular Wikipedia pages**
  if (processedCount < MEDIA_PAGE_LIMIT) {
    console.log("[main] Fetching top Wikipedia pages...");

    const topPages = await fetchTopWikipediaPages(0, MEDIA_PAGE_LIMIT);
    for (const title of topPages) {
      if (processedCount >= MEDIA_PAGE_LIMIT) {
        console.log(`[main] ✅ Reached target (${MEDIA_PAGE_LIMIT}) after processing top Wikipedia pages.`);
        return;
      }

      // Check if this page was already processed
      const alreadyProcessed = await isPageAlreadyProcessed(title);
      if (alreadyProcessed) {
        console.log(`[main] Skipping already processed page: "${title}"`);
        continue;
      }

      console.log(`[main] Fetching Wikipedia metadata for: "${title}"`);
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
      const metadataSaved = await saveMetadata(title, humanReadableName, supabase);

      if (!metadataSaved) {
        console.error(`[main] Failed to save metadata for "${title}".`);
        continue;
      }

      console.log(`[main] Metadata saved successfully. Proceeding to FAQ generation.`);
      const success = await processWithEnrichment(title, content, images, `https://en.wikipedia.org/wiki/${title}`, humanReadableName, lastUpdated);

      if (success) {
        processedCount++;
        console.log(`[main] ✅ Successfully processed: ${title} (Total: ${processedCount})`);
      } else {
        console.error(`[main] ❌ Enrichment process failed for "${title}".`);
      }
    }
  }

  console.log(`[main] FAQ generation process completed. Processed ${processedCount} pages.`);
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
    await main(openai, supabase, MEDIA_PAGE_LIMIT);
    console.log("[startProcess] 🎉 Execution finished successfully.");
    process.exit(0);
  } catch (error) {
    console.error("[startProcess] ❌ An error occurred:", error);
    process.exit(1);
  }
}

// Call the function once (prevents duplication)
startProcess();
