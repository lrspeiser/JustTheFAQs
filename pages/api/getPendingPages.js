// pages/api/getPendingPages.js

import { initClients } from "../../lib/fetchAndGenerate";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    console.log("[getPendingPages] Initializing Supabase client...");
    // Re-use your existing function that sets up supabase + openai
    const { supabase } = initClients();

    if (!supabase) {
      console.error("[getPendingPages] ❌ Supabase not initialized.");
      return res.status(500).json({ message: "Supabase client not available" });
    }

    console.log("[getPendingPages] Fetching unprocessed pages from 'processing_queue'...");

    // For example, let's say we only want pages with status='pending'
    // If you also want to include 'failed', just adjust the query.
    const { data, error } = await supabase
      .from("processing_queue")
      .select("*")
      .eq("status", "pending")
      .limit(5000) 
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[getPendingPages] ❌ Error fetching queue:", error.message);
      return res.status(500).json({ message: "Failed to fetch pending pages", error: error.message });
    }

    // data now contains the list of pages that haven't been processed
    console.log(`[getPendingPages] Found ${data.length} pages pending processing.`);
    return res.status(200).json({
      success: true,
      pendingPages: data,
    });

  } catch (error) {
    console.error("[getPendingPages] ❌ Unexpected error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
}
