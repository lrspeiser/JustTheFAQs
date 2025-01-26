// checkPineconeRecords.js

import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

// 1. Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// 2. Initialize Pinecone
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index('faq-embeddings'); // or your actual Pinecone index name

// 3. Configuration
// How many rows from raw_faqs to pull each iteration:
const QUERY_CHUNK = 1000;

// The max number of IDs to fetch from Pinecone at once
const PINECONE_BATCH = 1000;

async function main() {
  try {
    console.log('[CheckScript] Checking Pinecone records in repeated chunks...');

    // Keep looping until no rows remain with pinecone_upsert_success = false
    while (true) {
      // Step 1: Grab up to 1000 rows with pinecone_upsert_success = false
      const { data: rows, error } = await supabase
        .from('raw_faqs')
        .select('id')
        .eq('pinecone_upsert_success', false)
        .limit(QUERY_CHUNK);

      if (error) {
        throw new Error(`[Supabase Error] ${error.message}`);
      }
      if (!rows || rows.length === 0) {
        console.log('[CheckScript] ✅ No more rows to update. All done!');
        break;
      }

      console.log(`[CheckScript] Found ${rows.length} rows to check in Pinecone...`);
      // Convert IDs to strings for Pinecone
      const allIds = rows.map(r => r.id.toString());

      // Step 2: Possibly the list is bigger than PINECONE_BATCH
      // We chunk them to keep pinecone fetch calls small
      let idx = 0;
      while (idx < allIds.length) {
        const slice = allIds.slice(idx, idx + PINECONE_BATCH);
        idx += PINECONE_BATCH;

        console.log(`[CheckScript] Fetching Pinecone for ${slice.length} IDs...`);
        let fetchResult;
        try {
          fetchResult = await index.fetch(slice);
        } catch (error) {
          console.error('[CheckScript] ❌ Pinecone fetch error:', error.message);
          // If you want to bail on error, do: break; Otherwise, we continue
          continue;
        }

        if (!fetchResult.records) {
          console.log('[CheckScript] No records object returned from Pinecone. Next chunk...');
          continue;
        }

        // existingIdsStr is an array of ID strings that Pinecone found
        const existingIdsStr = Object.keys(fetchResult.records);
        if (existingIdsStr.length === 0) {
          console.log('[CheckScript] 0 Pinecone matches in this chunk.');
          continue;
        }

        // Convert them back to integers
        const existingIds = existingIdsStr.map(str => parseInt(str, 10));

        console.log(`[CheckScript] Found ${existingIds.length} existing Pinecone records in this chunk.`);

        // Step 3: Mark them success in Supabase
        const { error: updateError } = await supabase
          .from('raw_faqs')
          .update({ pinecone_upsert_success: true })
          .in('id', existingIds);

        if (updateError) {
          console.error('[CheckScript] ❌ Error updating success in Supabase:', updateError.message);
        } else {
          console.log(`[CheckScript] ✅ Marked ${existingIds.length} rows as pinecone_upsert_success = true.`);
        }
      }

      // After this batch, we do a new query in the next iteration
      // to see if any rows remain with pinecone_upsert_success = false.
    }

    console.log('[CheckScript] ✅ Done checking Pinecone across all rows!');
  } catch (err) {
    console.error('[CheckScript] Fatal error:', err);
    process.exit(1);
  }
}

// Run the script
main().then(() => process.exit(0));
