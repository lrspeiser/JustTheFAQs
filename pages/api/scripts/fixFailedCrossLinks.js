import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { setTimeout } from 'timers/promises';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function processBatch() {
  const { data, error } = await supabase.rpc('fix_failed_cross_links_batch');
  if (error) {
    console.error('Error calling fix_failed_cross_links_batch:', error);
    return false;
  }
  console.log('Batch processed:', data[0]);
  return (data[0].updated_count > 0 || data[0].deleted_count > 0);
}

async function main() {
  let batchNumber = 1;
  while (true) {
    console.log(`Starting batch ${batchNumber}...`);
    const hasMore = await processBatch();
    if (!hasMore) {
      console.log('No more failed entries to process. Exiting.');
      break;
    }
    console.log(`Batch ${batchNumber} completed. Waiting 5 seconds before next batch...`);
    batchNumber++;
    await setTimeout(5000);
  }
  console.log('Finished processing all failed entries.');
}

main().catch((err) => console.error('Error in main:', err));
