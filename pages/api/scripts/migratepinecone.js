//
// migratepinecone.js
//
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
const BATCH_SIZE = limitArg ? parseInt(limitArg.split("=")[1], 10) : 20000; // Default 20k

// 3. CHUNK_SIZE to avoid fetching too many rows at once
const CHUNK_SIZE = 1000;

console.log(`[Migration] 🚀 Starting Pinecone sync for up to ${BATCH_SIZE} total raw_faqs.`);

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

// Helper: Check if Pinecone has an entry with this ID
async function pineconeHasEntry(id) {
  try {
    const fetchResult = await index.fetch([id]);
    // Add debug logging
    const fetchedCount = fetchResult?.vectors 
      ? Object.keys(fetchResult.vectors).length 
      : 0;

    console.log(`[Pinecone] fetchResult for ID=${id}: fetched ${fetchedCount} vector(s).`);
    // If fetchResult.vectors[id] is not present, it's missing
    return !!(fetchResult?.vectors && fetchResult.vectors[id]);
  } catch (err) {
    console.error(`[Pinecone] ❌ Error checking ID=${id}:`, err.message);
    return false; // treat error as "missing" if error
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
    return false;
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
  console.log(`[Migration] 🔎 We'll scan raw_faqs up to ${BATCH_SIZE} rows, upserting if missing in Pinecone.`);

  let processedCount = 0;
  let failCount = 0;
  const failedIds = [];
  let offset = 0;

  while (processedCount < BATCH_SIZE) {
    // Step A: fetch up to CHUNK_SIZE rows from raw_faqs
    const toFetch = Math.min(BATCH_SIZE - processedCount, CHUNK_SIZE);

    console.log(`[Supabase] 🗄 Fetching up to ${toFetch} rows from offset=${offset}...`);
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
      .order("id", { ascending: false })
      .range(offset, offset + toFetch - 1);

    if (error) {
      console.error("[Migration] ❌ Error fetching from Supabase:", error.message);
      break; // We'll stop if we can't fetch
    }

    if (!faqs || faqs.length === 0) {
      console.log("[Migration] 🛑 No more rows found in raw_faqs. Stopping.");
      break;
    }

    console.log(`[Migration] Received ${faqs.length} rows...`);
    offset += faqs.length;

    // Step B: For each row, check Pinecone presence => upsert if missing => mark success
    for (const faq of faqs) {
      // If we've processed the batch limit, break
      if (processedCount >= BATCH_SIZE) {
        break;
      }

      const idStr = faq.id.toString();
      // Debug: Check Pinecone
      const alreadyInPinecone = await pineconeHasEntry(idStr);
      if (alreadyInPinecone) {
        console.log(`[Migration] Skipping ID ${faq.id}, already in Pinecone.`);
      } else {
        // Upsert
        const success = await upsertSingleFAQ(faq);
        if (success) {
          // Mark pinecone_upsert_success = true
          const { error: updateError } = await supabase
            .from("raw_faqs")
            .update({ pinecone_upsert_success: true })
            .eq("id", faq.id);
          if (updateError) {
            console.error(`[Migration] ❌ Error marking ID=${faq.id} success:`, updateError.message);
          } else {
            console.log(`[Migration] ✅ Marked ID=${faq.id} pinecone_upsert_success=true.`);
          }
        } else {
          failCount++;
          failedIds.push(faq.id);
        }
      }

      processedCount++;
    }

    // If we fetched less than toFetch, likely no more remain
    if (faqs.length < toFetch) {
      console.log("[Migration] ❗ Fetched fewer than chunk size, probably done.");
      break;
    }
  }

  console.log(`[Migration] ✅ Done scanning. Processed ${processedCount} total raw_faqs entries.`);

  if (failCount > 0) {
    console.log(`[Migration] ❌ ${failCount} upserts failed.`, failedIds);
  } else {
    console.log("[Migration] 🎉 No upsert failures. Great success!");
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
