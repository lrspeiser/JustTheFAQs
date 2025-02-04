// Import environment variables, Supabase, fetch and Pinecone libraries
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import { Pinecone } from "@pinecone-database/pinecone";

// 1. Initialize Supabase client using your environment variables
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// 2. Initialize Pinecone client and target the "faq-embeddings" index
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index("faq-embeddings");

/**
 * Simple concurrency limiter.
 * @param {number} concurrency - Maximum number of tasks to run concurrently.
 * @returns {Function} - A function to wrap your async tasks.
 */
function createLimiter(concurrency) {
  let running = 0;
  const queue = [];

  const next = () => {
    if (queue.length && running < concurrency) {
      const { fn, resolve, reject } = queue.shift();
      running++;
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          running--;
          next();
        });
    }
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

// Create a limiter with a concurrency of 10 tasks at a time.
const limit = createLimiter(10);

async function main() {
  console.log("[fixWikiUrls] Starting script...");

  // 3. Fetch rows from the processing_queue table where:
  //    - status is 'completed'
  //    - slug contains a dash (indicating it needs to be updated)
  const { data: rows, error } = await supabase
    .from('processing_queue')
    .select('id, title, slug, status, created_at')
    .in('status', ['completed', 'failed', 'pending'])  // include all desired statuses
    .like('slug', '%-%')
    .order('id', { ascending: false })  // Newest to oldest
    .limit(200000);

  if (error) {
    console.error("[fixWikiUrls] Error fetching queue rows:", error);
    process.exit(1);
  }
  if (!rows?.length) {
    console.log("[fixWikiUrls] No rows found needing updates.");
    return;
  }
  console.log(`[fixWikiUrls] Found ${rows.length} rows.`);

  // 4. Process each row concurrently with a limit to avoid overwhelming resources.
  //    Each row is processed by the processRow function.
  const tasks = rows.map(row => limit(() => processRow(row)));
  await Promise.all(tasks);

  console.log("[fixWikiUrls] ✅ All done!");
  process.exit(0);
}

/**
 * Process a single row:
 * - Search Wikipedia for the title.
 * - Update the slug and wiki_url in Supabase (both processing_queue and faq_files).
 * - Update the Pinecone metadata for this slug.
 *
 * @param {Object} row - A row object from the processing_queue table.
 */
async function processRow(row) {
  const id = row.id;
  const originalTitle = row.title;
  const oldSlug = row.slug || null;

  if (!originalTitle) {
    console.warn(`[Row ${id}] No title provided. Skipping row.`);
    return;
  }

  console.log(`\n[fixWikiUrls] Row ID=${id} => Searching Wikipedia for: "${originalTitle}"`);

  let newSlug = null;

  // Try up to 2 times to search Wikipedia for the title.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      newSlug = await searchWikipediaForTitle(originalTitle);
      if (newSlug) break;
    } catch (err) {
      console.error(`[Row ${id}] Attempt ${attempt} => ${err.message}`);
      if (attempt === 2) {
        console.error(`[Row ${id}] ❌ Giving up after 2 attempts.`);
      } else {
        // Wait 2 seconds before trying again
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  if (!newSlug) {
    console.warn(`[Row ${id}] Could not find a valid Wikipedia match. Skipping update.`);
    return;
  }

  // Convert the new title to a Wikipedia-style slug (spaces to underscores)
  newSlug = newSlug.replace(/\s/g, '_');
  const wikiUrl = `https://en.wikipedia.org/wiki/${newSlug}`;

  // 5a. Update processing_queue if the row with oldSlug exists
  const { data: existingProcessing } = await supabase
    .from('processing_queue')
    .select('id, slug, status')
    .eq('slug', oldSlug)
    .maybeSingle();

  if (existingProcessing) {
    console.log(`[Processing Queue] Updating slug from "${oldSlug}" to "${newSlug}" for Row ID=${existingProcessing.id}`);
    const { error: updateProcessingErr } = await supabase
      .from('processing_queue')
      .update({ wiki_url: wikiUrl, slug: newSlug })
      .eq('id', existingProcessing.id);
    if (updateProcessingErr) {
      console.error(`[Processing Queue] ❌ Failed to update slug for Row ID=${existingProcessing.id}: ${updateProcessingErr.message}`);
    }
  }

  // 5b. Update faq_files if the row with oldSlug exists there as well
  const { data: existingFaqFile } = await supabase
    .from('faq_files')
    .select('id, slug')
    .eq('slug', oldSlug)
    .maybeSingle();

  if (existingFaqFile) {
    console.log(`[FAQ Files] Updating slug from "${oldSlug}" to "${newSlug}" for Row ID=${existingFaqFile.id}`);
    const { error: updateFaqErr } = await supabase
      .from('faq_files')
      .update({ slug: newSlug })
      .eq('id', existingFaqFile.id);
    if (updateFaqErr) {
      console.error(`[FAQ Files] ❌ Failed to update slug for Row ID=${existingFaqFile.id}: ${updateFaqErr.message}`);
    }
  }

  // 6. Update Pinecone metadata only if the row's status is 'completed'
  if (row.status === 'completed') {
    await updateSlugOnlyInPinecone(oldSlug, newSlug);
  } else {
    console.log(`[Row ${id}] Status is "${row.status}". Skipping Pinecone update as it's not completed.`);
  }
}


/**
 * Searches Wikipedia for the best matching title.
 *
 * @param {string} searchTerm - The title to search for.
 * @returns {Promise<string|null>} - The first matching title, or null if none found.
 */
async function searchWikipediaForTitle(searchTerm) {
  const apiUrl = new URL('https://en.wikipedia.org/w/api.php');
  apiUrl.searchParams.set('action', 'query');
  apiUrl.searchParams.set('list', 'search');
  apiUrl.searchParams.set('srsearch', searchTerm);
  apiUrl.searchParams.set('utf8', '1');
  apiUrl.searchParams.set('format', 'json');

  const resp = await fetch(apiUrl, { headers: { 'User-Agent': 'WikiFixScript/1.0' } });

  if (resp.status === 429) throw new Error(`429 Too Many Requests for search term: ${searchTerm}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} - ${resp.statusText} for search term: ${searchTerm}`);

  const json = await resp.json();
  const results = json?.query?.search;
  return results?.length ? results[0].title : null;
}

/**
 * Updates Pinecone metadata for all vectors matching the old slug.
 *
 * @param {string} oldSlug - The original slug to look for.
 * @param {string} newSlug - The new slug to update to.
 */
async function updateSlugOnlyInPinecone(oldSlug, newSlug) {
  try {
    console.log(`[Pinecone] Searching for metadata with slug="${oldSlug}"...`);

    // Use a dummy vector since we are filtering by metadata, not vector similarity.
    const dummyVector = new Array(1536).fill(0);
    const response = await index.query({
      vector: dummyVector,
      topK: 1000,                // Adjust as needed to cover all potential matches
      includeMetadata: true,
      filter: {
        slug: { $eq: oldSlug }
      }
    });

    if (!response.matches || response.matches.length === 0) {
      console.warn(`[Pinecone] No metadata found with slug="${oldSlug}". Skipping update.`);
      return;
    }

    // Prepare an array of update promises to process matches concurrently.
    const updatePromises = response.matches.map(match => {
      const existingMetadata = match.metadata || {};
      existingMetadata.slug = newSlug;

      console.log(`[Pinecone] Updating slug for ID=${match.id} to "${newSlug}"`);
      return index.update({
        id: match.id,
        metadata: existingMetadata
      })
      .then(() => {
        console.log(`[Pinecone] Successfully updated slug for ID=${match.id}`);
      })
      .catch(err => {
        console.error(`[Pinecone] Error updating slug for ID=${match.id}: ${err.message}`);
      });
    });

    // Wait for all Pinecone updates to complete.
    await Promise.all(updatePromises);
  } catch (err) {
    console.error(`[Pinecone] Error updating slug from "${oldSlug}" to "${newSlug}": ${err.message}`);
  }
}

// Start the main function and catch any unexpected errors.
main().catch(err => {
  console.error("[fixWikiUrls] Unexpected error:", err);
  process.exit(1);
});
