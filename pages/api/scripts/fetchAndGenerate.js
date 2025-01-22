//pages/api/scripts/fetchAndGenerate.js

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
const MEDIA_PAGE_LIMIT = 50; // Change this value if you want to process more pages
let processedCount = 0; // Track the number of successfully processed pages
let embedder = null;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000;

// Add this retry wrapper function
const withRetry = async (operation, context) => {
  for (let i = 0; i < RETRY_ATTEMPTS; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === RETRY_ATTEMPTS - 1) throw error;
      console.warn(`[${context}] Attempt ${i + 1} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (i + 1)));
    }
  }
};


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

const debugDatabaseOperation = async (operation, params) => {
  try {
    const { data, error, count } = await supabase
      .from("processing_queue")
      .select("*", { count: 'exact' });

    console.log(`[Database Debug] Current queue count: ${count}`);
    console.log(`[Database Debug] Operation: ${operation}`);
    console.log(`[Database Debug] Parameters:`, params);

    if (error) {
      console.error(`[Database Debug] Error:`, error);
    }

    return { data, error, count };
  } catch (e) {
    console.error(`[Database Debug] Exception:`, e);
    return { error: e };
  }
};

const getQueueCount = async () => {
  const { count, error } = await supabase
    .from("processing_queue")
    .select("*", { count: "exact" });

  if (error) {
    console.error("[Queue Debug] ❌ Error fetching queue count:", error.message);
    return null;
  }

  console.log(`[Queue Debug] Current queue count: ${count}`);
  return count;
};

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
      description: "Generate structured FAQs from Wikipedia content by identifying key concepts and framing them as fascinating Q&A pairs. Start with the most interesting questions and work your way to the least interesting. Ensure clarity, relevance, and engagement, avoiding unnecessary jargon. Be thorough, using all of the information from Wikipedia, especially where there are specific details like names, dates, locations, numbers, formulas and so forth, but focus on what most people would find the most interesting questions to be answered and expand upon those answers. If there are any images that go with the answer, make sure to include those URLs. Do NOT change the case of Wikipedia page titles or cross-links",
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
      description: "Generate additional structured FAQs from Wikipedia content by identifying key concepts that weren't covered in the first pass. Like the initial pass, start with the most interesting questions and work your way to the least interesting. Ensure clarity, relevance, and engagement, avoiding unnecessary jargon. Be thorough in finding new angles and uncovered information from Wikipedia, but focus on what most people would find the most interesting questions that we did not already create questions and answers for. Make sure to expand upon those answers comprehensively, especially where there are specific details like names, dates, locations, numbers, formulas and so forth. If there are any images that go with the answer, make sure to include those URLs, being careful not to reuse images from the first pass. Do NOT change the case of Wikipedia page titles or cross-links",
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
  const cleanTitle = title.replace(/^\/wiki\//, ""); // Ensure clean title
  const slug = formatWikipediaSlug(cleanTitle); 

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


const handleBatchProcessingError = async (error, title, type) => {
  console.error(`[${type}] Error processing ${title}:`, error);

  try {
    // Update processing queue status if we're using one
    await updatePageStatus(title, 'failed', error.message);
  } catch (updateError) {
    console.error(`Failed to update error status for ${title}:`, updateError);
  }

  // Return null to indicate failure but allow processing to continue
  return null;
};


// Utility function to process batches of requests with rate limiting
async function processBatch(items, batchSize, processFn) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    console.log(`Processing batch ${i / batchSize + 1} of ${Math.ceil(items.length / batchSize)}`);

    // Process each item in the batch concurrently
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        try {
          return await processFn(item);
        } catch (error) {
          console.error(`Error processing item:`, error);
          return null;
        }
      })
    );

    results.push(...batchResults.filter(Boolean));

    // Add a small delay between batches to respect rate limits
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
}

// Modified generateStructuredFAQs to handle batches
async function generateStructuredFAQsBatch(pages, batchSize = 5) {
  const processFAQ = async (page) => {
    const { title, content, rawTimestamp, images } = page;

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
            content: "Generate structured FAQs from Wikipedia content by identifying key concepts and framing them as fascinating Q&A pairs. Start with the most interesting questions and work your way to the least interesting. Ensure clarity, relevance, and engagement, avoiding unnecessary jargon. Be thorough, using all of the information from Wikipedia, especially where there are specific details like names, dates, locations, numbers, formulas and so forth, but focus on what most people would find the most interesting questions to be answered and expand upon those answers. If there are any images that go with the answer, make sure to include those URLs. Do NOT change the case of Wikipedia page titles or cross-links"
          },
          {
            role: "user",
            content: `Extract structured questions and answers with subheaders,  cross-links and if available images from the following Wikipedia content:
              Title: ${title}
              Last Updated: ${rawTimestamp}
              Content:
              ${contentWithImages}`
          }
        ],
        tools
      });

      const toolCall = response.choices[0].message.tool_calls?.[0];
      if (!toolCall) {
        console.error(`No function call generated for ${title}.`);
        return null;
      }

      return JSON.parse(toolCall.function.arguments);
    } catch (error) {
      console.error(`Error generating FAQs for ${title}:`, error);
      return null;
    }
  };

  return await processBatch(pages, batchSize, processFAQ);
}

// Sliding window for managing two-pass processing
class ProcessingQueue {
  constructor(maxConcurrent = 500) {
    this.maxConcurrent = maxConcurrent;
    this.activeProcesses = new Map();
    this.firstPassResults = new Map();
    this.secondPassQueue = [];
    this.completed = new Set();
  }

  async processFirstPass(pages) {
    if (!Array.isArray(pages)) {
      console.error("[ProcessingQueue] Expected array of pages, got:", typeof pages);
      return [];
    }

    console.log(`[ProcessingQueue] Processing ${pages.length} pages in first pass`);
    const results = [];
    let currentIndex = 0;

    try {
      while (currentIndex < pages.length) {
        // Fill up to maxConcurrent requests
        while (this.activeProcesses.size < this.maxConcurrent && currentIndex < pages.length) {
          const page = pages[currentIndex];
          if (!this.validatePage(page)) {
            currentIndex++;
            continue;
          }

          const processPromise = this.processPage(page);
          this.activeProcesses.set(page.title, processPromise);
          currentIndex++;
        }

        // Wait for any process to complete
        if (this.activeProcesses.size > 0) {
          const [title, promise] = await this.getNextCompletedProcess();
          try {
            const result = await promise;
            this.activeProcesses.delete(title);

            if (result) {
              results.push(result);
              await this.queueSecondPass(result);
              console.log(`[ProcessingQueue] Successfully processed first pass for: ${title}`);
            }
          } catch (error) {
            console.error(`[ProcessingQueue] Error processing page ${title}:`, error);
            this.activeProcesses.delete(title);
          }
        }
      }

      await this.waitForActiveProcesses();
      return results;

    } catch (error) {
      console.error("[ProcessingQueue] Error in processFirstPass:", error);
      return results;
    }
  }

  validatePage(page) {
    if (!page || typeof page !== 'object') {
      console.error("[ProcessingQueue] Invalid page object:", page);
      return false;
    }

    const requiredFields = ['title', 'content', 'images', 'url', 'humanReadableName', 'lastUpdated'];
    const missingFields = requiredFields.filter(field => !page[field]);

    if (missingFields.length > 0) {
      console.error(`[ProcessingQueue] Page missing required fields: ${missingFields.join(', ')}`);
      return false;
    }

    return true;
  }

  async processPage(page) {
    try {
      console.log(`[ProcessingQueue] Starting first pass for: ${page.title}`);
      const { title, content, lastUpdated, images, url, humanReadableName } = page;

      // Generate initial FAQs
      const structuredFAQs = await generateStructuredFAQs(title, content, lastUpdated, images);

      if (!structuredFAQs) {
        throw new Error(`Initial FAQ generation failed for "${title}"`);
      }

      // Save initial FAQs
      const { faqs } = structuredFAQs;
      await saveStructuredFAQ(title, url, humanReadableName, lastUpdated, faqs);

      return {
        title,
        content,
        faqs,
        images,
        url,
        humanReadableName,
        lastUpdated
      };
    } catch (error) {
      console.error(`[ProcessingQueue] Error in processPage for ${page.title}:`, error);
      return null;
    }
  }

  async queueSecondPass(firstPassResult) {
    try {
      if (this.activeProcesses.size < this.maxConcurrent) {
        await this.processSecondPass(firstPassResult);
      } else {
        console.log(`[ProcessingQueue] Queuing second pass for: ${firstPassResult.title}`);
        this.secondPassQueue.push(firstPassResult);
      }
    } catch (error) {
      console.error(`[ProcessingQueue] Error queuing second pass for ${firstPassResult.title}:`, error);
    }
  }

  async processSecondPass(firstPassResult) {
    const { title, content, faqs, images, url, humanReadableName, lastUpdated } = firstPassResult;

    try {
      console.log(`[ProcessingQueue] Starting second pass for: ${title}`);
      const additionalFaqs = await generateAdditionalFAQs(title, content, faqs, images);

      if (additionalFaqs && additionalFaqs.length > 0) {
        await saveAdditionalFAQs(title, additionalFaqs, url, humanReadableName, lastUpdated);
        console.log(`[ProcessingQueue] Successfully processed second pass for: ${title}`);
      }

      this.completed.add(title);
    } catch (error) {
      console.error(`[ProcessingQueue] Error in second pass for ${title}:`, error);
    }
  }

  async getNextCompletedProcess() {
    const entries = Array.from(this.activeProcesses.entries());
    return entries[0];
  }

  async waitForActiveProcesses() {
    console.log('[ProcessingQueue] Waiting for remaining processes to complete...');
    while (this.activeProcesses.size > 0 || this.secondPassQueue.length > 0) {
      // Process any queued second pass items if we have capacity
      while (this.secondPassQueue.length > 0 && this.activeProcesses.size < this.maxConcurrent) {
        const nextItem = this.secondPassQueue.shift();
        if (nextItem) {
          await this.processSecondPass(nextItem);
        }
      }

      // Wait for active processes to complete
      if (this.activeProcesses.size > 0) {
        const [title, promise] = await this.getNextCompletedProcess();
        try {
          await promise;
        } catch (error) {
          console.error(`[ProcessingQueue] Error waiting for process ${title}:`, error);
        }
        this.activeProcesses.delete(title);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log('[ProcessingQueue] All processes completed');
  }
}

const truncateContent = (content, mediaLinks, maxTokens = 80000) => {
  // Estimate tokens based on characters (rough estimate: 4 characters = 1 token)
  const charLimit = maxTokens * 4;
  const mediaLinksText = mediaLinks.join("\n");

  if (content.length + mediaLinksText.length > charLimit) {
    console.warn(`[truncateContent] Content exceeds token limit. Truncating to ${maxTokens} tokens.`);

    // Truncate at the last complete sentence instead of a raw cut-off
    let truncatedContent = content.slice(0, charLimit - mediaLinksText.length - 1000);
    const lastSentenceEnd = truncatedContent.lastIndexOf(". ");

    if (lastSentenceEnd > 0) {
      truncatedContent = truncatedContent.slice(0, lastSentenceEnd + 1);
    }

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

// Add this before the openaiRateLimiter definition
class RateLimiter {
  constructor(maxRequests, timeWindow) {
    this.maxRequests = maxRequests;      // Maximum requests allowed
    this.timeWindow = timeWindow;        // Time window in milliseconds
    this.requests = [];                  // Array to track request timestamps
    this.isPaused = false;              // Flag to control rate limiting
  }

  async acquireToken() {
    // Wait if rate limiter is paused
    while (this.isPaused) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const now = Date.now();

    // Remove timestamps older than the time window
    this.requests = this.requests.filter(time => now - time < this.timeWindow);

    // If at capacity, wait until the oldest request expires
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.timeWindow - (now - oldestRequest);

      if (waitTime > 0) {
        console.log(`[RateLimiter] Rate limit reached. Waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      // Clean up expired timestamps again after waiting
      this.requests = this.requests.filter(time => Date.now() - time < this.timeWindow);
    }

    // Add current request timestamp
    this.requests.push(Date.now());
  }

  pause() {
    this.isPaused = true;
    console.log('[RateLimiter] Rate limiting paused');
  }

  resume() {
    this.isPaused = false;
    console.log('[RateLimiter] Rate limiting resumed');
  }

  getCurrentUsage() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.timeWindow);
    return this.requests.length;
  }

  getRemainingCapacity() {
    return this.maxRequests - this.getCurrentUsage();
  }
}

// Initialize the rate limiter for OpenAI API
const openaiRateLimiter = new RateLimiter(30000, 60000); // 30k requests per minute for gpt-4o-mini


const generateStructuredFAQs = async (title, content, rawTimestamp, images) => {
  const retryAttempts = 3;
  let lastError = null;

  for (let attempt = 0; attempt < retryAttempts; attempt++) {
    try {
      // Wait for rate limit token
      await openaiRateLimiter.acquireToken();

      const { truncatedContent, truncatedMediaLinks } = truncateContent(content, images);

      // Log attempt information
      console.log(`[generateStructuredFAQs] Processing ${title} (Attempt ${attempt + 1}/${retryAttempts})`);
      console.log(`[generateStructuredFAQs] Sending ${truncatedMediaLinks.length} images to OpenAI for processing.`);

      // Ensure images are passed in the prompt (preserved original structure)
      const contentWithImages = `
        ${truncatedContent}
        Relevant Images:
        ${truncatedMediaLinks.map((url, index) => `[Image ${index + 1}]: ${url}`).join("\n")}
      `;

      // Create OpenAI request with preserved system and user messages
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Generate structured FAQs from Wikipedia content by identifying key concepts and framing them as fascinating Q&A pairs. Start with the most interesting questions and work your way to the least interesting. Ensure clarity, relevance, and engagement, avoiding unnecessary jargon. Be thorough, using all of the information from Wikipedia, especially where there are specific details like names, dates, locations, numbers, formulas and so forth, but focus on what most people would find the most interesting questions to be answered and expand upon those answers. If there are any images that go with the answer, make sure to include those URLs. Do NOT change the case of Wikipedia page titles or cross-links",
          },
          {
            role: "user",
            content: `Extract structured questions and answers with subheaders, cross-links and if available images from the following Wikipedia content:

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
        throw new Error(`No function call generated for ${title}`);
      }

      const args = JSON.parse(toolCall.function.arguments);
      console.log(`[generateStructuredFAQs] ✅ Successfully generated FAQs for ${title}`);
      return args;

    } catch (error) {
      lastError = error;
      console.error(`[generateStructuredFAQs] Attempt ${attempt + 1} failed for ${title}:`, error.message);

      if (attempt < retryAttempts - 1) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.log(`[generateStructuredFAQs] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`[generateStructuredFAQs] All attempts failed for ${title}:`, lastError);
  return null;
};

const generateAdditionalFAQs = async (title, content, existingFAQs, images) => {
  const retryAttempts = 3;
  let lastError = null;

  for (let attempt = 0; attempt < retryAttempts; attempt++) {
    try {
      // Wait for rate limit token
      await openaiRateLimiter.acquireToken();

      console.log(`[generateAdditionalFAQs] Processing ${title} (Attempt ${attempt + 1}/${retryAttempts})`);

      const { truncatedContent, truncatedMediaLinks } = truncateContent(content, images);

      // Preserve image handling logic
      const usedImages = new Set(existingFAQs.flatMap(faq => faq.media_links || []));
      const unusedImages = truncatedMediaLinks.filter(img => !usedImages.has(img));

      // Preserve existing questions formatting
      const existingQuestions = existingFAQs.map(faq => 
        `- ${faq.question}\n  Subheader: ${faq.subheader}\n  Used images: ${(faq.media_links || []).join(", ")}`
      ).join('\n');

      // Preserve content structure
      const contentWithImages = `
        ${truncatedContent}

        Available Unused Images:
        ${unusedImages.map((url, index) => `[Image ${index + 1}]: ${url}`).join("\n")}
      `;

      // Create OpenAI request with preserved messages
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
        throw new Error(`No function call generated for ${title}`);
      }

      const args = JSON.parse(toolCall.function.arguments);
      console.log(`[generateAdditionalFAQs] ✅ Successfully generated additional FAQs for ${title}`);
      return args.additional_faqs;

    } catch (error) {
      lastError = error;
      console.error(`[generateAdditionalFAQs] Attempt ${attempt + 1} failed for ${title}:`, error.message);

      if (attempt < retryAttempts - 1) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.log(`[generateAdditionalFAQs] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`[generateAdditionalFAQs] All attempts failed for ${title}:`, lastError);
  return [];
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

  // Collect all cross-links before processing FAQs
  const allCrossLinks = formatCrossLinks(faqs);

  // Add cross-links to processing queue
  for (const link of allCrossLinks) {
    const crossLinkTitle = link.replace(/_/g, " ");
    const crossLinkSlug = formatWikipediaSlug(crossLinkTitle);
    const crossLinkUrl = `https://en.wikipedia.org/wiki/${link}`;

    try {
      // Check if already in queue
      const { data: existing } = await supabase
        .from("processing_queue")
        .select("id")
        .eq("slug", crossLinkSlug)
        .maybeSingle();

      if (!existing) {
        // Add to queue if not exists
        await supabase
          .from("processing_queue")
          .insert([{
            title: crossLinkTitle,
            slug: crossLinkSlug,
            url: crossLinkUrl,
            human_readable_name: crossLinkTitle,
            status: 'pending',
            source: 'cross_link'
          }]);
        console.log(`[saveAdditionalFAQs] ✅ Added cross-link ${crossLinkTitle} to processing queue`);
      }
    } catch (error) {
      console.error(`[saveAdditionalFAQs] Error adding cross-link ${crossLinkTitle} to queue:`, error);
    }
  }

  // Process all FAQs concurrently with Promise.all to improve performance
  await Promise.all(
    additionalFaqs.map(async (faq) => {
      try {
        console.log(`[saveAdditionalFAQs] Processing FAQ: "${faq.question}"`);

        const relatedPages = Array.isArray(faq.cross_links) 
        ? faq.cross_links
            .filter(Boolean)
            .map(link => link.replace(/^\/wiki\//, "")) // ✅ Strip "/wiki/" from links
            .join(", ") || null
        : null;

        const embeddingText = `
          Page Title: ${title}
          Subcategory: ${faq.subheader || "General"}
          Question: ${faq.question}
          Answer: ${faq.answer}
          Related Pages: ${relatedPages}
        `.trim();

        let mediaLink = faq.media_links?.[0] || null;
        if (mediaLink && typeof mediaLink === "object" && mediaLink.url) {
          mediaLink = mediaLink.url;
        }

        const faqData = {
          faq_file_id: faqFile.id,
          url: url || `https://en.wikipedia.org/wiki/${title}`,
          title: title,
          human_readable_name: humanReadableName,
          last_updated: lastUpdated,
          subheader: faq.subheader || null,
          question: faq.question,
          answer: faq.answer,
          cross_link: relatedPages,
          media_link: mediaLink,
        };

        console.log(`[saveAdditionalFAQs] Saving additional FAQ: "${faq.question}"`);
        const savedFaq = await insertDataToSupabase("raw_faqs", faqData);

        if (!savedFaq) {
          throw new Error("Failed to save additional FAQ");
        }

        // Generate and Save Embedding
        console.log(`[saveAdditionalFAQs] Generating embedding for FAQ: "${faq.question}"`);
        const embedding = await generateEmbedding(embeddingText);

        const embeddingData = {
          faq_id: savedFaq.id,
          question: faq.question,
          embedding,
        };

        await insertDataToSupabase("faq_embeddings", embeddingData);
        console.log(`[saveAdditionalFAQs] ✅ Successfully saved FAQ and embedding for: "${faq.question}"`);

        // Introduce a short delay to prevent rate-limiting
        await new Promise((resolve) => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`[saveAdditionalFAQs] ❌ Error processing FAQ: "${faq.question}"`, error);
      }
    })
  );

  console.log(`[saveAdditionalFAQs] ✅ Finished processing all additional FAQs for "${title}".`);
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

  // Collect all cross-links before processing FAQs
  const allCrossLinks = formatCrossLinks(faqs);

  // Add cross-links to processing queue
  for (const link of allCrossLinks) {
    const crossLinkTitle = link.replace(/_/g, " ");
    const crossLinkSlug = formatWikipediaSlug(crossLinkTitle);
    const crossLinkUrl = `https://en.wikipedia.org/wiki/${link}`;

    try {
      // Check if already in queue
      const { data: existing } = await supabase
        .from("processing_queue")
        .select("id")
        .eq("slug", crossLinkSlug)
        .maybeSingle();

      if (!existing) {
        // Add to queue if not exists
        await supabase
          .from("processing_queue")
          .insert([{
            title: crossLinkTitle,
            slug: crossLinkSlug,
            url: crossLinkUrl,
            human_readable_name: crossLinkTitle,
            status: 'pending',
            source: 'cross_link'
          }]);
        console.log(`[saveStructuredFAQ] ✅ Added cross-link ${crossLinkTitle} to processing queue`);
      }
    } catch (error) {
      console.error(`[saveStructuredFAQ] Error adding cross-link ${crossLinkTitle} to queue:`, error);
    }
  }

  // Use `Promise.all()` to process all FAQs in parallel
  await Promise.all(
    faqs.map(async (faq) => {
      try {
        console.log(`[saveStructuredFAQ] Processing FAQ: "${faq.question}"`);

        const relatedPages = Array.isArray(faq.cross_links) 
        ? faq.cross_links
            .filter(Boolean)
            .map(link => link.replace(/^\/wiki\//, "")) // ✅ Strip "/wiki/" from links
            .join(", ") || null
        : null;

        // Extract actual URL if media_links contain an object
        let mediaUrl = faq.media_links?.[0] || null;
        if (mediaUrl && typeof mediaUrl === "object" && mediaUrl.url) {
          mediaUrl = mediaUrl.url;
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
          media_link: mediaUrl, // Fixed media URL
        };

        console.log(`[saveStructuredFAQ] Saving FAQ: "${faq.question}"`);
        const savedFaq = await insertDataToSupabase("raw_faqs", faqData);

        if (!savedFaq) {
          throw new Error("Failed to save FAQ");
        }

        // Generate and Save Embedding
        console.log(`[saveStructuredFAQ] Generating embedding for FAQ: "${faq.question}"`);
        const embedding = await generateEmbedding(embeddingText);

        const embeddingData = {
          faq_id: savedFaq.id,
          question: faq.question,
          embedding,
        };

        await insertDataToSupabase("faq_embeddings", embeddingData);
        console.log(`[saveStructuredFAQ] ✅ Successfully saved FAQ and embedding for: "${faq.question}"`);

        // Introduce a small delay to prevent potential rate-limiting
        await new Promise((resolve) => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`[saveStructuredFAQ] ❌ Error processing FAQ: "${faq.question}"`, error);
      }
    })
  );

  console.log(`[saveStructuredFAQ] ✅ Finished processing all structured FAQs for "${title}".`);
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
const formatCrossLinks = (faqs) => {
  if (!faqs) return [];

  try {
    return faqs
      .flatMap(faq => faq.cross_links || [])  // ✅ Extract links from FAQs
      .filter(Boolean)                        // ✅ Remove null/undefined values
      .filter(link => !link.includes('#'))    // ✅ Remove anchor links
      .map(link => link.replace(/^\/wiki\//, ''))  // ✅ Remove "/wiki/" prefix
      .map(link => decodeURIComponent(link))  // ✅ Decode URL-encoded characters
      .filter(Boolean);                        // ✅ Remove any empty strings
  } catch (error) {
    console.error("[formatCrossLinks] ❌ Error processing cross-links:", error);
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


const processWithEnrichment = async (title, content, images, url, humanReadableName, lastUpdated) => {
  console.log(`[processWithEnrichment] Processing "${title}"`);

  try {
    // First Pass: Generate Initial FAQs
    console.log(`[processWithEnrichment] Starting first pass for "${title}"`);
    const structuredFAQs = await generateStructuredFAQs(title, content, lastUpdated, images);

    if (!structuredFAQs) {
      console.error(`[processWithEnrichment] ❌ Initial FAQ generation failed for "${title}"`);
      return false;
    }

    // Save initial FAQs
    const { faqs, human_readable_name, last_updated } = structuredFAQs;
    await saveStructuredFAQ(title, url, human_readable_name, last_updated, faqs);

    // Second Pass: Generate Additional FAQs
    console.log(`[processWithEnrichment] Starting second pass for "${title}"`);
    const additionalFAQs = await generateAdditionalFAQs(title, content, faqs, images);

    if (additionalFAQs && additionalFAQs.length > 0) {
      console.log(`[processWithEnrichment] ✅ Found ${additionalFAQs.length} additional FAQs for "${title}"`);
      await saveAdditionalFAQs(title, additionalFAQs, url, human_readable_name, last_updated);
    } else {
      console.log(`[processWithEnrichment] No additional FAQs were generated for "${title}".`);
    }

    console.log(`[processWithEnrichment] ✅ Successfully completed all processing for "${title}"`);
    return true;

  } catch (error) {
    console.error(`[processWithEnrichment] ❌ Error processing "${title}":`, error);
    return false;
  }
};




const debugQueueCount = async () => {
  const { count, error } = await supabase
    .from("processing_queue")
    .select("*", { count: "exact" });

  if (error) {
    console.error("[Database Debug] ❌ Error fetching queue count:", error.message);
    return null;
  }

  console.log(`[Database Debug] Current queue count: ${count}`);
  return count;
};

const fetchTopWikipediaPages = async (offset = 0, limit = 10) => {
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/2023/12/31`;

  try {
    console.log(`[fetchTopWikipediaPages] Fetching Wikipedia pages...`);
    const response = await axios.get(url);

    // Get articles and filter out special pages
    const articles = response.data.items[0].articles
      .filter(article => !article.article.includes(':')) // Filter out special pages
      .filter(article => !article.article.startsWith('Main_')) // Filter out main pages
      .slice(offset, offset + limit); // Only get limited articles

    console.log(`[fetchTopWikipediaPages] Found ${articles.length} pages.`);
    return articles.map(article => article.article);
  } catch (error) {
    console.error("[fetchTopWikipediaPages] ❌ Error fetching top pages:", error.message);
    return [];
  }
};

const addPagesToQueue = async (pages) => {
  for (const title of pages) {
    const cleanTitle = title.replace(/^\/wiki\//, ""); // ✅ Remove "/wiki/"
    const slug = formatWikipediaSlug(cleanTitle);
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(cleanTitle)}`;

    try {
      console.log(`[addPagesToQueue] Checking queue for ${cleanTitle}`);

      const { data: existing } = await supabase
        .from("processing_queue")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();

      if (!existing) {
        console.log(`[addPagesToQueue] Adding ${cleanTitle} to queue`);

        await supabase
          .from("processing_queue")
          .insert([
            {
              title: cleanTitle,
              slug,
              url,
              human_readable_name: cleanTitle,
              status: "pending",
              source: "top_pages",
            },
          ]);

        console.log(`[addPagesToQueue] ✅ Added ${cleanTitle} to processing queue`);
      } else {
        console.log(`[addPagesToQueue] Skipping ${cleanTitle}, already in queue`);
      }
    } catch (error) {
      console.error(`[addPagesToQueue] Error adding ${cleanTitle} to queue:`, error);
    }
  }
};


const processWikipediaPages = async () => {
  const queueCount = await debugQueueCount();
  if (queueCount >= MAX_QUEUE_COUNT) {
    console.log(`[Queue Limit] 🚨 Queue already at max capacity (${MAX_QUEUE_COUNT}). Skipping.`);
    return;
  }

  const remainingSlots = MAX_QUEUE_COUNT - queueCount;
  console.log(`[Queue Limit] 🏁 Only ${remainingSlots} more slots available. Fetching limited pages.`);
  const topPages = await fetchTopWikipediaPages(0, remainingSlots);

  await addPagesToQueue(topPages);
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

const addCrossLinksToQueue = async (crossLinks) => {
  if (!crossLinks || !crossLinks.length) return;

  for (const link of crossLinks) {
    const cleanTitle = link.replace(/^\/wiki\//, ""); // ✅ Remove "/wiki/"
    const slug = formatWikipediaSlug(cleanTitle);
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(cleanTitle)}`;

    try {
      // Check if already in queue
      const { data: existing } = await supabase
        .from("processing_queue")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();

      if (!existing) {
        // Add to queue if not exists
        await supabase
          .from("processing_queue")
          .insert([{
            title: cleanTitle,
            slug,
            url,
            human_readable_name: cleanTitle,
            status: 'pending',
            source: 'cross_link'
          }]);
        console.log(`[addCrossLinksToQueue] ✅ Added ${cleanTitle} to processing queue`);
      }
    } catch (error) {
      console.error(`[addCrossLinksToQueue] Error processing ${cleanTitle}:`, error);
    }
  }
};




async function main() {
  console.log("[main] Starting FAQ generation process...");
  console.log(`[main] Page limit set to: ${MEDIA_PAGE_LIMIT}`);

  try {
    // Debug initial state
    console.log("[main] Checking initial database state...");
    await debugDatabaseOperation("initial-check", {});

    // Get pending pages from processing queue
    const { data: pendingPages, error: pendingError } = await supabase
      .from("processing_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(MEDIA_PAGE_LIMIT);

    if (pendingError) {
      console.error("[main] ❌ Error retrieving pending pages:", pendingError.message);
    } else {
      const availablePages = pendingPages.length;
      console.log(`[main] Found ${availablePages} pending pages in queue`);

      // **Fetch Wikipedia pages if the queue is empty or not enough pages are available**
      if (availablePages < MEDIA_PAGE_LIMIT) {
        const neededPages = MEDIA_PAGE_LIMIT - availablePages;
        console.log(`[main] 🚀 Need ${neededPages} more pages. Fetching from Wikipedia...`);

        const topPages = await fetchTopWikipediaPages(0, neededPages);

        // Add new Wikipedia pages to queue
        await Promise.all(
          topPages.map(async (title) => {
            const cleanTitle = title.replace(/^\/wiki\//, ""); // Remove "/wiki/"
            const slug = formatWikipediaSlug(cleanTitle);
            const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(cleanTitle)}`;

            try {
              console.log(`[main] Checking queue for ${cleanTitle}`);

              const { data: existing } = await supabase
                .from("processing_queue")
                .select("id")
                .eq("slug", slug)
                .maybeSingle();

              if (!existing) {
                console.log(`[main] Adding ${cleanTitle} to queue`);

                await supabase
                  .from("processing_queue")
                  .insert([
                    {
                      title: cleanTitle,
                      slug,
                      url,
                      human_readable_name: cleanTitle,
                      status: "pending",
                      source: "top_pages",
                    },
                  ]);

                console.log(`[main] ✅ Added Wikipedia page ${cleanTitle} to processing queue`);
              } else {
                console.log(`[main] Page ${cleanTitle} already exists in queue`);
              }
            } catch (error) {
              console.error(`[main] Error adding Wikipedia page ${cleanTitle} to queue:`, error);
            }
          })
        );
      }

      // Refresh queue count after fetching new pages
      const { data: updatedPendingPages, error: updatedPendingError } = await supabase
        .from("processing_queue")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(MEDIA_PAGE_LIMIT);

      if (updatedPendingError) {
        console.error("[main] ❌ Error retrieving updated pending pages:", updatedPendingError.message);
        return;
      }

      const pagesToProcess = updatedPendingPages.length;
      console.log(`[main] ✅ Ready to process ${pagesToProcess} pages in parallel`);

      if (pagesToProcess > 0) {
        console.log(`[main] 🚀 Sending ${pagesToProcess} pages to OpenAI in parallel...`);

        // **Send all pages to OpenAI in parallel**
        await Promise.all(
          updatedPendingPages.map(async (pendingPage) => {
            try {
              const cleanTitle = pendingPage.title.replace(/^\/wiki\//, ""); // Ensure correct title
              console.log(`[main] Processing page from queue: "${cleanTitle}"`);

              // Update status to processing
              const { error: updateError } = await supabase
                .from("processing_queue")
                .update({
                  status: "processing",
                  attempts: (pendingPage.attempts || 0) + 1,
                })
                .eq("id", pendingPage.id);

              if (updateError) {
                console.error(`[main] Error updating page status:`, updateError);
                return;
              }

              // Check if already exists in FAQ files
              const { data: existingEntry, error: existenceError } = await supabase
                .from("faq_files")
                .select("id")
                .eq("slug", formatWikipediaSlug(cleanTitle))
                .limit(1)
                .maybeSingle();

              if (existenceError) {
                console.error(`[main] Error checking slug existence for "${cleanTitle}":`, existenceError.message);
                return;
              }

              if (existingEntry) {
                console.log(`[main] Skipping "${cleanTitle}" as it already exists in the database.`);

                // Update queue status to completed for already existing pages
                await supabase
                  .from("processing_queue")
                  .update({
                    status: "completed",
                    processed_at: new Date().toISOString(),
                  })
                  .eq("id", pendingPage.id);

                return;
              }

              // Metadata fetching
              const metadata = await fetchWikipediaMetadata(cleanTitle);
              const { lastUpdated, humanReadableName } = metadata;

              if (!humanReadableName) {
                console.warn(`[main] No human-readable name found for "${cleanTitle}". Skipping...`);

                await supabase
                  .from("processing_queue")
                  .update({
                    status: "failed",
                    error_message: "No human-readable name found",
                    processed_at: new Date().toISOString(),
                  })
                  .eq("id", pendingPage.id);

                return;
              }

              const pageData = await fetchWikipediaPage(cleanTitle);
              if (!pageData) {
                console.error(`[main] Skipping "${cleanTitle}" due to empty or invalid content.`);

                await supabase
                  .from("processing_queue")
                  .update({
                    status: "failed",
                    error_message: "Failed to fetch page content",
                    processed_at: new Date().toISOString(),
                  })
                  .eq("id", pendingPage.id);

                return;
              }

              const { content, images } = pageData;

              // Save metadata
              console.log(`[main] Saving metadata for "${cleanTitle}"`);
              const metadataSaved = await saveMetadata(cleanTitle, humanReadableName, supabase);

              if (!metadataSaved) {
                console.error(`[main] Failed to save metadata for "${cleanTitle}".`);

                await supabase
                  .from("processing_queue")
                  .update({
                    status: "failed",
                    error_message: "Failed to save metadata",
                    processed_at: new Date().toISOString(),
                  })
                  .eq("id", pendingPage.id);

                return;
              }

              // Process the page
              const success = await processWithEnrichment(
                cleanTitle,
                content,
                images,
                pendingPage.url,
                humanReadableName,
                lastUpdated
              );

              if (success) {
                console.log(`[main] ✅ Successfully processed: ${cleanTitle}`);

                // Update queue status to completed
                await supabase
                  .from("processing_queue")
                  .update({
                    status: "completed",
                    processed_at: new Date().toISOString(),
                  })
                  .eq("id", pendingPage.id);
              }
            } catch (error) {
              console.error(`[main] Error processing page ${pendingPage.title}:`, error);
            }
          })
        );
      }
    }

    console.log("[main] ✅ FAQ generation process completed.");
  } catch (error) {
    console.error("[main] ❌ Fatal error in main process:", error);
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
    await main(openai, supabase, MEDIA_PAGE_LIMIT);
    console.log("[startProcess] 🎉 Execution finished successfully.");
    process.exit(0);
  } catch (error) {
    console.error("[startProcess] ❌ An error occurred:", error);
    process.exit(1);
  }
}

export { main };

// Call the function once (prevents duplication)
// commenting this out startProcess();
if (process.argv[1].includes('fetchAndGenerate.js')) {
  startProcess().catch(error => {
    console.error("[Script] Fatal error:", error);
    process.exit(1);
  });
}