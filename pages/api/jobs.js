// pages/api/jobs.js
import { supabase } from "../../lib/supabaseClient.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { total_pages, page_offset } = req.body;

    if (
      !Number.isInteger(total_pages) ||
      !Number.isInteger(page_offset) ||
      total_pages <= 0 ||
      page_offset < 0
    ) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    // ----------------------------------------
    // 1) Fetch up to 'total_pages' rows from the queue for real titles
    // ----------------------------------------
    const { data: queueRows, error: queueError } = await supabase
      .from("processing_queue")
      .select("id, title")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(total_pages);

    if (queueError) {
      console.error("[createJob] ❌ Error fetching queue rows:", queueError);
      // We won't bail entirely; the fallback is placeholders
    }

    // We create exactly ONE job per page:
    // e.g. if total_pages=500 => 500 jobs
    // Each job references 1 page offset
    // That means no concurrency at the job level; concurrency is handled in your worker code.

    let insertedJobs = [];
    for (let i = 0; i < total_pages; i++) {

      // If we have a queueRows[i], use that.
      // Otherwise fallback to the old placeholder approach.
      const fallbackRow = {
        id: page_offset + i,
        title: `Placeholder Title ${page_offset + i}`
      };
      const row = (queueRows && queueRows[i]) || fallbackRow;

      // Insert each job row
      const { data, error } = await supabase
        .from("jobs")
        .insert([
          {
            page_id: row.id,
            page_title: row.title,  // <-- The actual name from 'processing_queue'
            status: "pending",
            total_pages: 1,
            concurrency: 1,
            page_offset: page_offset + i  // keep the 'page_offset' non-null
          }
        ])
        .select("*")
        .single();

      if (error) {
        console.error("[createJob] ❌ Error inserting job batch:", error);
        continue;
      }
      insertedJobs.push(data);
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
