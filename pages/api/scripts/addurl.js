import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import { Pinecone } from "@pinecone-database/pinecone";

// 1. Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// 2. Initialize Pinecone
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index("faq-embeddings");

async function main() {
  console.log("[fixWikiUrls] Starting script...");

  // 3. Fetch up to 5 rows (for testing). Adjust as needed
  const { data: rows, error } = await supabase
    .from('processing_queue')
    .select('*')
    .like('slug', '%-%')   // only rows with a dash
    .limit(5000);

  if (error) {
    console.error("[fixWikiUrls] Error fetching queue rows:", error);
    process.exit(1);
  }
  if (!rows?.length) {
    console.log("[fixWikiUrls] No rows found needing updates.");
    return;
  }
  console.log(`[fixWikiUrls] Found ${rows.length} rows.`);

  // 4. Process each row
  for (const row of rows) {
    const id = row.id;
    const originalTitle = row.title;
    const oldSlug = row.slug || null;

    if (!originalTitle) {
      console.warn(`[Row ${id}] No title to search. Skipping.`);
      continue;
    }

    console.log(`\n[fixWikiUrls] Row ID=${id} => Searching Wikipedia for: "${originalTitle}"`);

    let newSlug = null;
    // Retry up to 2 times (API rate-limit safe)
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        newSlug = await searchWikipediaForTitle(originalTitle);
        break;
      } catch (err) {
        console.error(`[Row ${id}] Attempt ${attempt} => ${err.message}`);
        if (attempt === 2) {
          console.error(`[Row ${id}] ❌ Giving up after 2 attempts.`);
        } else {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    if (!newSlug) {
      console.warn(`[Row ${id}] Could not find a good Wikipedia match. Skipping update.`);
      continue;
    }

    // Convert to Wikipedia-style slug
    newSlug = newSlug.replace(/\s/g, '_');
    const wikiUrl = `https://en.wikipedia.org/wiki/${newSlug}`;

    // 5. Update DB
    // 5a) Check if the old slug exists in processing_queue
    const { data: existingProcessing } = await supabase
      .from('processing_queue')
      .select('id, slug')
      .eq('slug', oldSlug)
      .maybeSingle();

    // 5b) Check if the old slug exists in faq_files
    const { data: existingFaqFile } = await supabase
      .from('faq_files')
      .select('id, slug')
      .eq('slug', oldSlug)
      .maybeSingle();

    // Update processing_queue
    if (existingProcessing) {
      console.log(`[Processing Queue] Updating slug from "${oldSlug}" → "${newSlug}"`);
      const { error: updateProcessingErr } = await supabase
        .from('processing_queue')
        .update({ wiki_url: wikiUrl, slug: newSlug })
        .eq('id', existingProcessing.id);

      if (updateProcessingErr) {
        console.error(`[Processing Queue] ❌ Failed to update slug: ${updateProcessingErr.message}`);
      }
    }

    // Update faq_files
    if (existingFaqFile) {
      console.log(`[FAQ Files] Updating slug from "${oldSlug}" → "${newSlug}"`);
      const { error: updateFaqErr } = await supabase
        .from('faq_files')
        .update({ slug: newSlug })
        .eq('id', existingFaqFile.id);

      if (updateFaqErr) {
        console.error(`[FAQ Files] ❌ Failed to update slug: ${updateFaqErr.message}`);
      }
    }

    // 6. Update Pinecone (match by old slug, not ID!)
    await updateSlugOnlyInPinecone(oldSlug, newSlug);

    // Delay for 500ms
    await new Promise(r => setTimeout(r, 500));
  }

  console.log("[fixWikiUrls] ✅ All done!");
  process.exit(0);
}

// 📖 **Search Wikipedia for the best-matching page title**
async function searchWikipediaForTitle(searchTerm) {
  const apiUrl = new URL('https://en.wikipedia.org/w/api.php');
  apiUrl.searchParams.set('action', 'query');
  apiUrl.searchParams.set('list', 'search');
  apiUrl.searchParams.set('srsearch', searchTerm);
  apiUrl.searchParams.set('utf8', '1');
  apiUrl.searchParams.set('format', 'json');

  const resp = await fetch(apiUrl, { headers: { 'User-Agent': 'WikiFixScript/1.0' } });

  if (resp.status === 429) throw new Error(`429 Too Many Requests => ${searchTerm}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} - ${resp.statusText} => ${searchTerm}`);

  const json = await resp.json();
  const results = json?.query?.search;
  return results?.length ? results[0].title : null;
}

// 🌍 **Update Pinecone metadata, matching by old slug**
async function updateSlugOnlyInPinecone(oldSlug, newSlug) {
  try {
    console.log(`[Pinecone] 🔍 Searching for any metadata with slug="${oldSlug}"...`);

    // 1. Query Pinecone with a metadata filter
    const dummyVector = new Array(1536).fill(0);
    const response = await index.query({
      vector: dummyVector,
      topK: 1000,                // or enough to cover all matches
      includeMetadata: true,
      filter: {
        slug: { $eq: oldSlug }
      }
    });

    if (!response.matches || response.matches.length === 0) {
      console.warn(`[Pinecone] ❌ No existing metadata found with slug="${oldSlug}". Skipping update.`);
      return;
    }

    // 2. For each match, preserve existing metadata, but replace slug
    for (const match of response.matches) {
      const existingMetadata = match.metadata || {};
      existingMetadata.slug = newSlug;

      console.log(`[Pinecone] 🔄 Updating slug for ID=${match.id} to "${newSlug}"`);
      await index.update({
        id: match.id,
        metadata: existingMetadata
      });

      console.log(`[Pinecone] ✅ Successfully updated slug for ID=${match.id}`);
    }
  } catch (err) {
    console.error(`[Pinecone] ❌ Error updating slug from "${oldSlug}" to "${newSlug}":`, err.message);
  }
}

// Run main
main().catch(err => {
  console.error("[fixWikiUrls] ❌ Unexpected error:", err);
  process.exit(1);
});
