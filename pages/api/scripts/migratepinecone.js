// migratepinecone.js

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
const BATCH_SIZE = limitArg ? parseInt(limitArg.split("=")[1], 10) : 20000; // Default to 10000

// NEW: We'll define a smaller chunk size to fetch each loop
const CHUNK_SIZE = 1000;

console.log(`[Migration] 🚀 Starting migration with batch size: ${BATCH_SIZE}`);

//
// 1. Check existing IDs in Pinecone
//
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

//
// 2. Generate an embedding
//
async function generateEmbedding(text) {
  try {
    console.log(
      `[Embedding] 🧠 Generating embedding for: "${text.substring(0, 50)}..."`
    );
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

//
// 3. Fetch FAQs from Supabase (including faq_files.slug)
//
async function fetchFAQs(limit, offset = 0) {
  console.log(
    `[Supabase] 🗄 Fetching up to ${limit} raw FAQs (offset: ${offset})...`
  );

  const { data: faqs, error } = await supabase
    .from("raw_faqs")
    .select(`
      id,
      faq_file_id,
      url,
      title,
      question,
      answer,
      media_link,
      human_readable_name,
      last_updated,
      subheader,
      cross_link,
      image_urls,
      faq_files (
        slug
      )
    `)
    .order("last_updated", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[Supabase] ❌ Error fetching FAQs:", error.message);
    return [];
  }

  return faqs;
}

//
// 4. Store each FAQ in parallel, upserting into Pinecone as soon as its embedding is done
//
async function storeInPineconeImmediately(faqs) {
  console.log(`[Pinecone] 🚀 Parallel embedding for ${faqs.length} FAQs...`);

  // Map all FAQs to a promise that:
  //  - Generates the embedding
  //  - Builds the vector
  //  - Immediately upserts that single vector to Pinecone
  const embeddingPromises = faqs.map(async (faq) => {
    // Build text for embedding
    const textToEmbed = `
      Title: ${faq.title}
      Question: ${faq.question}
      Answer: ${faq.answer}
      Subheader: ${faq.subheader || ""}
      Related: ${faq.cross_link || ""}
    `.trim();

    // Generate embedding
    const embedding = await generateEmbedding(textToEmbed);
    if (!embedding) {
      console.log(`[Pinecone] ⚠️ Skipped ID ${faq.id} - no embedding.`);
      return null;
    }

    // Extract slug from faq_files
    const finalSlug = faq.faq_files?.slug || "";

    // Build vector for Pinecone
    const vector = {
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
        cross_link: faq.cross_link
          ? faq.cross_link.split(",").map(link => link.trim())
          : [],
        media_link: faq.media_link || "",
        image_urls: faq.image_urls
          ? faq.image_urls.split(",").map(url => url.trim())
          : [],
        slug: finalSlug
      }
    };

    // Immediately upsert this single vector to Pinecone
    await index.upsert([vector]);

    console.log(`[Pinecone] ✅ Upserted ID ${faq.id} as soon as embedding finished.`);
    return vector; // Return what we upserted, or null if we skip
  });

  // Wait for all parallel tasks
  const results = await Promise.all(embeddingPromises);

  // Count how many were non-null
  const successCount = results.filter(v => v !== null).length;
  console.log(
    `[Pinecone] ✅ Finished parallel store; ${successCount} items upserted immediately.`
  );
}

//
// 5. Migration loop
//
export async function migrateFAQs() {
  let storedCount = 0;
  let offset = 0;

  while (storedCount < BATCH_SIZE) {
    // Calculate how many we want to fetch this iteration
    const toFetch = Math.min(BATCH_SIZE - storedCount, CHUNK_SIZE);

    console.log(
      `[Supabase] 🗄 Fetching up to ${toFetch} raw FAQs (offset: ${offset})...`
    );
    const faqs = await fetchFAQs(toFetch, offset);
    if (faqs.length === 0) {
      console.log("[Migration] 🛑 No more new FAQs to process. Stopping.");
      break;
    }

    // Check which IDs already exist in Pinecone, skip them
    console.log(`[Migration] 🔍 Checking ${faqs.length} fetched FAQs in Pinecone...`);
    const existingIds = await checkExistingInPinecone(faqs.map(faq => faq.id));
    const newFaqs = faqs.filter(faq => !existingIds.has(faq.id.toString()));

    if (newFaqs.length === 0) {
      console.log("[Migration] 🔄 All these FAQs exist in Pinecone; next batch...");
      offset += faqs.length; // <-- increment offset by however many we actually fetched
      continue;
    }

    // We'll store up to BATCH_SIZE, but chunk by chunk
    const toStore = newFaqs.slice(0, BATCH_SIZE - storedCount);
    console.log(`[Pinecone] 🚀 Storing ${toStore.length} new FAQs in parallel...`);
    await storeInPineconeImmediately(toStore);

    storedCount += toStore.length;
    console.log(`[Migration] 🎉 Stored ${storedCount}/${BATCH_SIZE} FAQs so far.`);

    // Again, move offset by the number of rows we actually fetched
    offset += faqs.length;
  }

  console.log(`[Migration] ✅ Finished migration. Stored ${storedCount} new FAQs.`);
}

// 6. Run the migration immediately if you want this script self-executing
migrateFAQs()
  .then(() => {
    console.log("[Migration] ✅ Done! Terminating process...");
    process.exit(0); // Exit successfully
  })
  .catch(err => {
    console.error("[Migration] ❌ Unexpected error:", err);
    process.exit(1); // Exit with error code
  });
