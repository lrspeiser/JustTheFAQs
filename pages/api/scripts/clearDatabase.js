import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

// Initialize Supabase client
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const clearDatabase = async () => {
  try {
    console.log("[DB] Connecting to Supabase...");

    // Delete from `faq_embeddings` (dependent on `raw_faqs`)
    console.log("[DB] Clearing `faq_embeddings` table...");
    const { error: embeddingsError } = await supabase.from("faq_embeddings").delete().neq("id", 0);
    if (embeddingsError) throw new Error(`[DB] Failed to clear \`faq_embeddings\`: ${embeddingsError.message}`);
    console.log("[DB] Cleared `faq_embeddings` table.");

    // Delete from `raw_faqs`
    console.log("[DB] Clearing `raw_faqs` table...");
    const { error: faqsError } = await supabase.from("raw_faqs").delete().neq("id", 0);
    if (faqsError) throw new Error(`[DB] Failed to clear \`raw_faqs\`: ${faqsError.message}`);
    console.log("[DB] Cleared `raw_faqs` table.");

    // Delete from `faq_files`
    console.log("[DB] Clearing `faq_files` table...");
    const { error: filesError } = await supabase.from("faq_files").delete().neq("id", 0);
    if (filesError) throw new Error(`[DB] Failed to clear \`faq_files\`: ${filesError.message}`);
    console.log("[DB] Cleared `faq_files` table.");

    console.log("[DB] ✅ All tables cleared successfully.");

  } catch (error) {
    console.error("[DB] ❌ Error during database clearing:", error.message);
  }
};

// Run the script
clearDatabase();
