// migratepinecone.js

import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// 1. Initialize Clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index("faq-embeddings"); // Adjust if your index name is different

// 2. CLI argument for batch size
const args = process.argv.slice(2);
const limitArg = args.find(arg => arg.startsWith("--limit="));
const BATCH_SIZE = limitArg ? parseInt(limitArg.split("=")[1], 10) : 20000; // Default to 20k

// 3. CHUNK_SIZE to avoid fetching too many rows at once
const CHUNK_SIZE = 1000;

console.log(`[Migration] 🚀 Starting Pinecone migration for up to ${BATCH_SIZE} entries (only those with pinecone_upsert_success=false).`);

////////////////////////////////////////////////////////////////////////////////
// Helper: Generate an embedding
async function generateEmbedding(text) {
  try {
    console.log(`[Embedding] Generating embedding for: "${text.substring(0, 50)}..."`);
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

// Helper: Upsert a single FAQ into Pinecone
async function upsertSingleFAQ(faq) {
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
    console.log(`[Pinecone] ⚠️ ID ${faq.id} - embedding generation failed.`);
    return false; // Return false => no upsert
  }

  // Build vector
  const finalSlug = faq.faq_files?.slug || "";
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

  // Upsert to Pinecone
  try {
    await index.upsert([vector]);
    console.log(`[Pinecone] ✅ Upserted ID ${faq.id}.`);
    return true;
  } catch (error) {
    console.error(`[Pinecone] ❌ Error upserting ID ${faq.id}:`, error.message);
    return false;
  }
}

////////////////////////////////////////////////////////////////////////////////
// The main migration function
export async function migrateFAQs() {
  console.log("[Migration] 🔎 Searching for raw_faqs where pinecone_upsert_success=false...");

  let storedCount = 0;
  let failCount = 0;
  const failedIds = [];

  while (storedCount < BATCH_SIZE) {
    // Step A: fetch up to CHUNK_SIZE rows that are still "false"
    const toFetch = Math.min(BATCH_SIZE - storedCount, CHUNK_SIZE);

    console.log(`[Supabase] 🗄 Fetching up to ${toFetch} rows with pinecone_upsert_success=false...`);
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
      .eq("pinecone_upsert_success", false)
      .order("id", { ascending: false })  // Just pick a sorting approach
      .limit(toFetch);

    if (error) {
      console.error("[Migration] ❌ Error fetching from Supabase:", error.message);
      break; // We'll stop if we can't fetch
    }

    if (!faqs || faqs.length === 0) {
      console.log("[Migration] 🛑 No more rows with pinecone_upsert_success=false. Stopping.");
      break;
    }

    console.log(`[Migration] Found ${faqs.length} rows needing upsert in Pinecone...`);

    // Step B: Upsert each one in parallel
    // or you could do them sequentially if you worry about rate limits
    const results = await Promise.all(
      faqs.map((faq) => upsertSingleFAQ(faq))
    );

    // Step C: Mark successes => pinecone_upsert_success=true, failures => keep false
    const successIds = [];
    const failIds = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i]) successIds.push(faqs[i].id);
      else failIds.push(faqs[i].id);
    }

    // If we have successes, update them in Supabase
    if (successIds.length > 0) {
      const { error: updateError } = await supabase
        .from("raw_faqs")
        .update({ pinecone_upsert_success: true })
        .in("id", successIds);

      if (updateError) {
        console.error("[Migration] ❌ Error marking success in Supabase:", updateError.message);
      } else {
        console.log(`[Migration] ✅ Marked ${successIds.length} rows as pinecone_upsert_success=true.`);
      }

      storedCount += successIds.length;
    }

    // If we have failures, we just keep them as false. We log them out
    if (failIds.length > 0) {
      failCount += failIds.length;
      failedIds.push(...failIds);
      console.log(`[Migration] 🚫 The following ${failIds.length} IDs failed to upsert:`, failIds);
    }

    // If we've stored the maximum BATCH_SIZE, break
    if (storedCount >= BATCH_SIZE) {
      console.log(`[Migration] Reached BATCH_SIZE limit of ${BATCH_SIZE}, stopping.`);
      break;
    }

    // If we fetched less than CHUNK_SIZE, likely no more remain
    if (faqs.length < CHUNK_SIZE) {
      console.log("[Migration] ❗ Fetched fewer than chunk size, probably done.");
      break;
    }
  }

  console.log(`[Migration] ✅ Finished migration. Upserted ${storedCount} rows successfully.`);

  if (failCount > 0) {
    console.log(`[Migration] ❌ Failed upserting ${failCount} rows. Keeping them as false.`);
    console.log("Failed IDs:", failedIds);
  } else {
    console.log("[Migration] 🎉 No failures. Great success!");
  }
}

// Self-invoked if run directly
migrateFAQs()
  .then(() => {
    console.log("[Migration] ✅ Done! Terminating process...");
    process.exit(0);
  })
  .catch(err => {
    console.error("[Migration] ❌ Unexpected error:", err);
    process.exit(1);
  });
