//
// /pages/api/jobs.js
//
import { supabase } from "../../lib/supabaseClient";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // 1) read the user inputs
    const { total_pages, page_offset, concurrency } = req.body;

    // 2) validate
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

    // 3) insert a new row in "jobs"
    const { data: job, error } = await supabase
      .from("jobs")
      .insert([
        {
          total_pages,
          page_offset,
          concurrency,
          status: "pending" // new job is pending
        }
      ])
      .select("*")
      .single();

    if (error) {
      console.error("[createJob] Error inserting job:", error);
      return res.status(500).json({ error: "Failed to create job." });
    }

    // 4) return the newly-created job
    return res.status(201).json({ job });
  } catch (err) {
    console.error("[createJob] ❌ Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
