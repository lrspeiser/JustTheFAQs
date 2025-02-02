// pages/api/getPendingPages.js

export const config = {
  api: {
    responseLimit: false, // or '8mb' or whatever limit you want
  },
};


import { initClients } from "../../lib/fetchAndGenerate";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    console.log("[getPendingPages] Initializing Supabase client...");
    const { supabase } = initClients();

    if (!supabase) {
      console.error("[getPendingPages] ❌ Supabase not initialized.");
      return res.status(500).json({ message: "Supabase client not available" });
    }

    console.log("[getPendingPages] Fetching unprocessed pages from 'processing_queue'...");
    const targetLimit = parseInt(req.query.limit || "20000", 10);
    const batchSize = 1000; // Fetch in batches of 1000
    let allData = [];

    // Fetch data in batches
    for (let offset = 0; offset < targetLimit; offset += batchSize) {
      const { data, error } = await supabase
        .from("processing_queue")
        .select("id, title, status, created_at")
        .eq("status", "pending")
        .range(offset, Math.min(offset + batchSize - 1, targetLimit - 1))
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[getPendingPages] ❌ Error fetching queue:", error.message);
        return res
          .status(500)
          .json({ message: "Failed to fetch pending pages", error: error.message });
      }

      allData = [...allData, ...data];

      // If we got less than batchSize results, we've reached the end
      if (data.length < batchSize) break;

      // If we've reached our target limit, stop
      if (allData.length >= targetLimit) {
        allData = allData.slice(0, targetLimit);
        break;
      }
    }

    console.log(`[getPendingPages] Found ${allData.length} pages pending processing.`);
    return res.status(200).json({
      success: true,
      pendingPages: allData,
    });
  } catch (error) {
    console.error("[getPendingPages] ❌ Unexpected error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
}