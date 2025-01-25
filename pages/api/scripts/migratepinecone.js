import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Initialize Clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const indexName = "faq-embeddings";
const index = pc.index(indexName);

// CLI argument for batch size
const args = process.argv.slice(2);
const limitArg = args.find(arg => arg.startsWith("--limit="));
const BATCH_SIZE = limitArg ? parseInt(limitArg.split("=")[1], 10) : 1000; // Default to 10

console.log(`[Migration] 🚀 Starting migration with batch size: ${BATCH_SIZE}`);

// Function to check existing FAQs in Pinecone
async function checkExistingInPinecone(faqIds) {
  const existingIds = new Set();

  for (const id of faqIds) {
    try {
      const result = await index.fetch([id.toString()]);
      if (result.records && Object.keys(result.records).length > 0) {
        existingIds.add(id.toString());
      }
    } catch (error) {
      console.error(`[Pinecone] ❌ Error checking ID ${id}:`, error.message);
    }
  }

  return existingIds;
}

// Generate an embedding
async function generateEmbedding(text) {
  try {
    console.log(`[Embedding] 🧠 Generating embedding for: "${text.substring(0, 50)}..."`);
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text.replace(/\n/g, " "),
      dimensions: 1536
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error("[Embedding] ❌ Error generating embedding:", error.message);
    return null;
  }
}

// Fetch FAQs in batches, skipping already stored ones
async function fetchFAQs(limit, offset = 0) {
  console.log(`[Supabase] 🗄 Fetching up to ${limit} raw FAQs (offset: ${offset})...`);

  const { data: faqs, error } = await supabase
    .from("raw_faqs")
    .select(`
      id, faq_file_id, url, title, question, answer, 
      media_link, human_readable_name, last_updated, 
      subheader, cross_link, image_urls
    `)
    .order("last_updated", { ascending: true }) // Process oldest first
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[Supabase] ❌ Error fetching FAQs:", error.message);
    return [];
  }

  return faqs;
}

// Store new FAQs in Pinecone
async function storeInPinecone(faqs) {
  console.log(`[Pinecone] 🚀 Preparing to store ${faqs.length} FAQs...`);

  const vectors = [];

  for (const faq of faqs) {
    const textToEmbed = `
      Title: ${faq.title}
      Question: ${faq.question}
      Answer: ${faq.answer}
      Subheader: ${faq.subheader || ""}
      Related: ${faq.cross_link || ""}
    `.trim();

    const embedding = await generateEmbedding(textToEmbed);
    if (!embedding) continue;

    vectors.push({
      id: faq.id.toString(),
      values: embedding,
      metadata: {
        faq_file_id: faq.faq_file_id?.toString() || "unknown",
        question: faq.question || "Unknown Question",
        answer: faq.answer || "No Answer Available",
        url: faq.url || "",
        human_readable_name: faq.human_readable_name || "Unknown",
        last_updated: faq.last_updated || new Date().toISOString(),
        subheader: faq.subheader || "",
        cross_link: faq.cross_link ? faq.cross_link.split(",").map(link => link.trim()) : [],
        media_link: faq.media_link || "",
        image_urls: faq.image_urls ? faq.image_urls.split(",").map(url => url.trim()) : []
      }
    });
  }

  if (vectors.length > 0) {
    await index.upsert(vectors);
    console.log(`[Pinecone] ✅ Successfully stored ${vectors.length} FAQs.`);
  } else {
    console.log(`[Pinecone] ⚠️ No new FAQs to store.`);
  }
}

// Migration process that fetches FAQs until new ones are found
async function migrateFAQs() {
  let storedCount = 0;
  let offset = 0;

  while (storedCount < BATCH_SIZE) {
    console.log(`[Supabase] 🗄 Fetching up to ${BATCH_SIZE - storedCount} raw FAQs (offset: ${offset})...`);

    const faqs = await fetchFAQs(BATCH_SIZE - storedCount, offset);
    if (faqs.length === 0) {
      console.log("[Migration] 🛑 No more new FAQs to process. Stopping.");
      break;
    }

    console.log(`[Migration] 🔍 Checking ${faqs.length} fetched FAQs against Pinecone...`);
    const existingIds = await checkExistingInPinecone(faqs.map(faq => faq.id));
    const newFaqs = faqs.filter(faq => !existingIds.has(faq.id.toString()));

    if (newFaqs.length === 0) {
      console.log(`[Migration] 🔄 All fetched FAQs already exist. Moving to next batch...`);
      offset += BATCH_SIZE;
      continue;
    }

    const toStore = newFaqs.slice(0, BATCH_SIZE - storedCount); // Ensure we don’t exceed limit
    console.log(`[Pinecone] 🚀 Preparing to store ${toStore.length} FAQs...`);
    await storeInPinecone(toStore);

    storedCount += toStore.length;
    console.log(`[Migration] 🎉 Stored ${storedCount}/${BATCH_SIZE} FAQs so far.`);

    offset += BATCH_SIZE;
  }

  console.log(`[Migration] ✅ Finished migration run. Stored ${storedCount} FAQs.`);
}

// Run the migration
migrateFAQs();
