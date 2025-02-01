// pages/api/scripts/addurl.js

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[fixWikiUrls] ❌ Missing Supabase environment variables.");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  console.log("[fixWikiUrls] Starting script with rate-limit handling...");

  const { data: rows, error } = await supabase
    .from('processing_queue')
    .select('*')
    .is('wiki_url', null)
    .limit(5000);

  if (error) {
    console.error("[fixWikiUrls] Error fetching queue rows:", error);
    process.exit(1);
  }
  if (!rows?.length) {
    console.log("[fixWikiUrls] No rows found needing wiki_url.");
    return;
  }
  console.log(`[fixWikiUrls] Found ${rows.length} rows.`);

  for (const row of rows) {
    const id = row.id;
    const originalTitle = row.title;
    if (!originalTitle) {
      console.warn(`[Row ${id}] No title to search. Skipping.`);
      continue;
    }

    console.log(`\n[fixWikiUrls] Row ID=${id} => Searching Wikipedia for: "${originalTitle}"`);
    let bestPageTitle = null;

    // We'll do up to 2 attempts, in case we get 429
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        bestPageTitle = await searchWikipediaForTitle(originalTitle);
        break; // success => break out of the retry loop
      } catch (err) {
        console.error(`[Row ${id}] Attempt ${attempt} => ${err.message}`);
        if (attempt === 2) {
          console.error(`[Row ${id}] ❌ Giving up after 2 attempts.`);
        } else {
          // 429 or something else => short delay before retry
          console.log(`[Row ${id}] Waiting 2s before retry...`);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    if (!bestPageTitle) {
      console.warn(`[Row ${id}] Could not find a good match. Skipping update.`);
      // small delay after each iteration
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    const pageSlug = bestPageTitle.replace(/\s/g, '_');
    const wikiUrl = `https://en.wikipedia.org/wiki/${pageSlug}`;

    // Update DB
    const { error: updateErr } = await supabase
      .from('processing_queue')
      .update({ wiki_url: wikiUrl })
      .eq('id', id);

    if (updateErr) {
      console.error(`[Row ${id}] Error updating wiki_url: ${updateErr.message}`);
    } else {
      console.log(`[Row ${id}] ✅ wiki_url => ${wikiUrl}`);
    }

    // small delay after each iteration
    await new Promise(r => setTimeout(r, 500));
  }

  console.log("[fixWikiUrls] All done!");
  process.exit(0);
}

// Simple function that calls the MediaWiki search
async function searchWikipediaForTitle(searchTerm) {
  const apiUrl = new URL('https://en.wikipedia.org/w/api.php');
  apiUrl.searchParams.set('action', 'query');
  apiUrl.searchParams.set('list', 'search');
  apiUrl.searchParams.set('srsearch', searchTerm);
  apiUrl.searchParams.set('utf8', '1');
  apiUrl.searchParams.set('format', 'json');

  // Provide a custom user agent for good measure
  const resp = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'MyWikiFixScript/1.0 (myemail@domain.com)'
    }
  });

  if (resp.status === 429) {
    throw new Error(`429 Too Many Requests => ${searchTerm}`);
  }
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} - ${resp.statusText} => ${searchTerm}`);
  }

  const json = await resp.json();
  const results = json?.query?.search;
  if (!results?.length) return null;

  // Return top result
  return results[0].title;
}

main().catch(err => {
  console.error("[fixWikiUrls] ❌ Unexpected error:", err);
  process.exit(1);
});
