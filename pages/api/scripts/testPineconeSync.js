// testPineconeSync.js

import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

// 1. Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// 2. Initialize Pinecone
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index('faq-embeddings'); // or your actual index name

// We'll only test the first 10 from raw_faqs
const TEST_LIMIT = 10;

async function main() {
  try {
    console.log('[TestScript] Checking first 10 entries from raw_faqs...');

    // Step A: Fetch up to 10 rows
    const { data: rows, error } = await supabase
      .from('raw_faqs')
      .select('id, pinecone_upsert_success')
      .limit(TEST_LIMIT);

    if (error) {
      throw new Error(`[Supabase Error] ${error.message}`);
    }
    if (!rows || rows.length === 0) {
      console.log('[TestScript] No rows found in raw_faqs.');
      return;
    }

    // Step B: For each row, fetch from Pinecone
    for (const row of rows) {
      const idStr = row.id.toString();

      let fetchResult;
      try {
        fetchResult = await index.fetch([idStr]);
      } catch (err) {
        console.error(`[TestScript] ❌ Pinecone fetch error for ID=${row.id}:`, err.message);
        continue;
      }

      // Pinecone returns an object like { records: { "123": {...} } }
      // If "123" is absent, it's not found in Pinecone
      const foundIds = Object.keys(fetchResult.records);

      if (foundIds.includes(idStr)) {
        // We found an entry in Pinecone
        console.log(
          `ID=${row.id} | Supabase=${row.pinecone_upsert_success} | Pinecone=FOUND`
        );
      } else {
        // Not found in Pinecone
        console.log(
          `ID=${row.id} | Supabase=${row.pinecone_upsert_success} | Pinecone=NOT FOUND`
        );
      }
    }

    console.log('[TestScript] ✅ Done checking 10 entries.');
  } catch (err) {
    console.error('[TestScript] Fatal error:', err);
    process.exit(1);
  }
}

// Run the script
main().then(() => process.exit(0));
