// fixbrokenslugs.js

import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// 1. Initialize Clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const indexName = "faq-embeddings";
const index = pc.index(indexName);

// 2. Handle CLI argument for batch size, or default to 1000
const args = process.argv.slice(2);
const limitArg = args.find(arg => arg.startsWith("--limit="));
const BATCH_SIZE = limitArg ? parseInt(limitArg.split("=")[1], 10) : 1000;

console.log(`[Migration] 🚀 Starting re-upsert with batch size: ${BATCH_SIZE}`);

// ---------------------------------------
// 3. HELPER: Generate an embedding with OpenAI
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

// ---------------------------------------
// 4. HELPER: Fetch FAQs from Supabase in batches (with slug)
async function fetchFAQs(limit, offset = 0) {
  console.log(`[Supabase] 🗄 Fetching up to ${limit} raw FAQs (offset: ${offset})...`);

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

// ---------------------------------------
// 5. HELPER: Re-upsert all fetched FAQs to Pinecone (no skipping)
async function upsertFaqsToPinecone(faqs) {
  console.log(`[Pinecone] 🚀 Re-upserting ${faqs.length} FAQs...`);
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
    if (!embedding) continue; // Skip if embedding fails

    const finalSlug = faq.faq_files?.slug || "";

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
        cross_link: faq.cross_link
          ? faq.cross_link.split(",").map(link => link.trim())
          : [],
        media_link: faq.media_link || "",
        image_urls: faq.image_urls
          ? faq.image_urls.split(",").map(url => url.trim())
          : [],
        slug: finalSlug
      }
    });
  }

  if (vectors.length > 0) {
    await index.upsert(vectors);
    console.log(`[Pinecone] ✅ Re-upserted ${vectors.length} items.`);
  } else {
    console.log("[Pinecone] ⚠️ No vectors to re-upsert this round.");
  }
}

// ---------------------------------------
// 6. MAIN: forcibly re-upsert all rows in raw_faqs
async function fixBrokenSlugs() {
  let storedCount = 0;
  let offset = 0;

  while (true) {
    // 1) Fetch batch
    const faqs = await fetchFAQs(BATCH_SIZE, offset);
    if (faqs.length === 0) {
      console.log("[Migration] 🛑 No more FAQs to process. Stopping.");
      break;
    }

    // 2) Upsert them all into Pinecone (NOT skipping existing)
    console.log(`[Migration] 🔍 Re-upserting batch of ${faqs.length}...`);
    await upsertFaqsToPinecone(faqs);

    storedCount += faqs.length;
    console.log(`[Migration] 🎉 Re-upserted ${storedCount} total so far.`);

    // 3) Move offset forward for the next batch
    offset += BATCH_SIZE;
  }

  console.log(`[Migration] ✅ Finished forced re-upsert. Re-upserted ${storedCount} total FAQs.`);
}

// 7. Run the script
fixBrokenSlugs().catch((err) => {
  console.error("[Migration] ❌ Unexpected error:", err.message);
});
