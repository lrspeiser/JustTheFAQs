//
// fixBlankSlugsInPinecone.js
//
import dotenv from "dotenv";
dotenv.config();

import { Pinecone } from "@pinecone-database/pinecone";
import { createClient } from "@supabase/supabase-js";

/**
 * Initialize Supabase and Pinecone
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index("faq-embeddings"); // Adjust if needed

/**
 * Query Pinecone for items where slug = "".
 * We use a dummy vector + filter. This fetches up to 100k matches
 * if you have a large index. Adjust topK if you might exceed that.
 */
async function findBlankSlugInPinecone() {
  console.log("[Pinecone] Searching for items with slug=''...");

  // Dummy vector of correct dimension for your index
  const zeroVector = new Array(1536).fill(0);

  const response = await index.query({
    vector: zeroVector,
    topK: 9999,         // large enough to catch all
    includeMetadata: true,
    filter: {
      slug: {
        $eq: ""
      }
    }
  });

  if (!response.matches || response.matches.length === 0) {
    console.log("[Pinecone] No matches found with slug=''.");
    return [];
  }

  console.log(`[Pinecone] Found ${response.matches.length} matches with slug=""`);
  return response.matches;
}

/**
 * Fetch the correct slug from Supabase for the given raw_faqs.id
 */
async function fetchCorrectSlugFromDB(id) {
  // Query the raw_faqs table, joined to faq_files to get the real slug
  const { data, error } = await supabase
    .from("raw_faqs")
    .select("faq_files ( slug )")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error(`[Supabase] Error fetching ID=${id}:`, error.message);
    return null;
  }
  if (!data || !data.faq_files) {
    return null;
  }

  // If the DB slug is also empty, there's nothing to fix
  const dbSlug = data.faq_files.slug || "";
  return dbSlug.length ? dbSlug : null;
}

/**
 * Use Pinecone partial update to fix the slug field, leaving the vector intact
 */
async function updateSlugOnlyInPinecone(id, newSlug) {
  try {
    await index.update({
      id: id.toString(),
      setMetadata: { slug: newSlug }
    });
    console.log(`[Pinecone] ✅ ID=${id}, updated slug to "${newSlug}"`);
  } catch (err) {
    console.error(`[Pinecone] Error updating ID=${id}:`, err.message);
  }
}

/**
 * Main function: find all blank-slug items, fix each by setting the DB slug
 */
async function fixBlankSlugsInPinecone() {
  try {
    // 1) Query Pinecone for blank-slug items
    const matches = await findBlankSlugInPinecone();
    if (!matches.length) {
      console.log("[Main] No blank slugs found. Done.");
      return;
    }

    // 2) For each match, fetch DB slug, do partial metadata update
    let updatedCount = 0;
    for (const match of matches) {
      const id = match.id;
      const realSlug = await fetchCorrectSlugFromDB(id);

      if (realSlug) {
        await updateSlugOnlyInPinecone(id, realSlug);
        updatedCount++;
      } else {
        // DB has no slug or row not found, skip
      }
    }

    console.log(`[Main] Completed. Updated slug for ${updatedCount} item(s).`);
  } catch (err) {
    console.error("[Main] ❌ Unexpected error:", err.message);
  }
}

// Run
fixBlankSlugsInPinecone();
