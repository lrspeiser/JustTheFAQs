// pages/api/jobs.js

import { supabase } from "../../lib/supabaseClient";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { total_pages, page_offset, concurrency } = req.body;

    // Basic validation
    if (
      !Number.isInteger(total_pages) ||
      !Number.isInteger(page_offset) ||
      !Number.isInteger(concurrency) ||
      total_pages <= 0 ||
      page_offset < 0 ||
      concurrency <= 0
    ) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    // Let's define a "batchSize" to split the total_pages
    // (Often we'd just reuse 'concurrency' as the batch size, but let's be explicit.)
    const batchSize = concurrency; // or some other logic

    // Calculate how many batches we need
    const batchCount = Math.ceil(total_pages / batchSize);

    // We'll create multiple rows in the `jobs` table
    // Each job will process up to batchSize pages, offset accordingly.
    let insertedJobs = [];

    let currentOffset = page_offset;
    let pagesRemaining = total_pages;

    for (let i = 0; i < batchCount; i++) {
      // For the last batch, if pagesRemaining < batchSize, we adjust
      const thisBatchSize = Math.min(batchSize, pagesRemaining);

      // Insert a new row in `jobs` for this batch
      const { data, error } = await supabase
        .from("jobs")
        .insert([
          {
            total_pages: thisBatchSize,
            page_offset: currentOffset,
            concurrency,
            status: "pending"
          }
        ])
        .select("*")
        .single();

      if (error) {
        console.error("[createJob] ❌ Error inserting job batch:", error);
        // We'll continue but note this in the response
        continue;
      }

      insertedJobs.push(data);

      // Update offsets for the next batch
      currentOffset += thisBatchSize;
      pagesRemaining -= thisBatchSize;
    }

    return res.status(201).json({
      message: `Created ${insertedJobs.length} job(s).`,
      jobs: insertedJobs
    });
  } catch (err) {
    console.error("[createJob] ❌ Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
