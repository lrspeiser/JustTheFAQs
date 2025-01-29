//
// checkids.js
//
import { createClient } from "@supabase/supabase-js";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";

dotenv.config();

// 1) Initialize
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index("faq-embeddings"); // Must match your actual index name & environment

/**
 * Helper: search Pinecone by a given metadata field (e.g. "title" or "human_readable_name")
 * We'll do a dummy vector query with a filter => { [fieldName]: { $eq: fieldValue } }
 */
async function searchPineconeByMetadata(fieldName, fieldValue) {
  console.log(`[Pinecone] Searching for ${fieldName}="${fieldValue}" in metadata...`);

  // Pinecone dimension assumed 1536. Adjust if needed.
  const zeroVector = new Array(1536).fill(0);
  const topK = 100; // up to 100 matches for debugging

  // We'll build a filter object like: { [fieldName]: { $eq: fieldValue } }
  const filterObj = {
    [fieldName]: {
      $eq: fieldValue
    }
  };

  const response = await index.query({
    vector: zeroVector,
    topK,
    includeMetadata: true,
    filter: filterObj
  });

  if (!response.matches || response.matches.length === 0) {
    console.log(`[Pinecone] No matches found with ${fieldName}="${fieldValue}".`);
    return [];
  }

  console.log(`[Pinecone] Found ${response.matches.length} match(es) for ${fieldName}="${fieldValue}":`);
  return response.matches;
}

(async () => {
  try {
    console.log("[Supabase] Searching for any raw_faqs row with pinecone_upsert_success=true...");

    // 2) Grab a single row with pinecone_upsert_success=true, plus 'title', 'human_readable_name'
    const { data: faqRow, error } = await supabase
      .from("raw_faqs")
      .select("id, title, human_readable_name, pinecone_upsert_success")
      .eq("pinecone_upsert_success", true)
      .limit(1)
      .single();

    if (error) {
      throw new Error(`[Supabase] Error: ${error.message}`);
    }
    if (!faqRow) {
      console.log("[Supabase] No row found with pinecone_upsert_success=true. Exiting.");
      return;
    }

    console.log(
      `[Supabase] Found row: ID=${faqRow.id}, title="${faqRow.title}", human_readable_name="${faqRow.human_readable_name}", pinecone_upsert_success=${faqRow.pinecone_upsert_success}`
    );

    // 3) Check Pinecone for that ID
    const idStr = faqRow.id.toString();
    console.log(`[Pinecone] Checking if ID=${idStr} exists in Pinecone...`);

    const fetchResult = await index.fetch([idStr]);
    const foundByID = fetchResult?.vectors && fetchResult.vectors[idStr];

    if (foundByID) {
      console.log(`[Pinecone] ✅ ID=${idStr} found in Pinecone. Full metadata:`, foundByID.metadata);
    } else {
      console.log(`[Pinecone] ❌ ID=${idStr} not found in Pinecone. Let's try searching by "title" and "human_readable_name"...`);

      // 4) If not found by ID, fallback: search by title in metadata
      if (faqRow.title) {
        const matchesByTitle = await searchPineconeByMetadata("title", faqRow.title);
        if (matchesByTitle.length > 0) {
          matchesByTitle.forEach((match, i) => {
            console.log(
              `  [title-match #${i + 1}] ID="${match.id}" Score=${match.score}, metadata=`,
              match.metadata
            );
          });
        }

        // 5) Then search by "human_readable_name", in case we stored it differently
        console.log(`[Pinecone] Searching by "human_readable_name"="${faqRow.title}" just in case...`);
        const matchesByHRN = await searchPineconeByMetadata("human_readable_name", faqRow.title);
        if (matchesByHRN.length > 0) {
          matchesByHRN.forEach((match, i) => {
            console.log(
              `  [HRN-match #${i + 1}] ID="${match.id}" Score=${match.score}, metadata=`,
              match.metadata
            );
          });
        }
      }

      // 6) Also search by the 'human_readable_name' from DB, in case that was stored in 'title'
      if (faqRow.human_readable_name) {
        console.log(`[Pinecone] Searching by "title"="${faqRow.human_readable_name}" in case that was swapped...`);
        const matchesByTitle2 = await searchPineconeByMetadata("title", faqRow.human_readable_name);
        if (matchesByTitle2.length > 0) {
          matchesByTitle2.forEach((match, i) => {
            console.log(
              `  [title-match #${i + 1}] ID="${match.id}" Score=${match.score}, metadata=`,
              match.metadata
            );
          });
        }

        console.log(`[Pinecone] Searching by "human_readable_name"="${faqRow.human_readable_name}"...`);
        const matchesByHRN2 = await searchPineconeByMetadata("human_readable_name", faqRow.human_readable_name);
        if (matchesByHRN2.length > 0) {
          matchesByHRN2.forEach((match, i) => {
            console.log(
              `  [HRN-match #${i + 1}] ID="${match.id}" Score=${match.score}, metadata=`,
              match.metadata
            );
          });
        }
      }

      console.log("[Pinecone] Done searching fallback fields for matching entries.");
    }
  } catch (err) {
    console.error("[Main] ❌ Error:", err.message);
  }
})();
