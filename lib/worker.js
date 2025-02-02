// lib/worker.js
import { supabase } from "./supabaseClient.js";
import { processOnePageFromDB } from "./processSinglePage.js"; 

const CHECK_INTERVAL_MS = 20000; // how often to poll for jobs (20 seconds)
const BATCH_DELAY_MS = 200;     // time to wait between concurrency batches

async function processJobs() {
  try {
    // 1) Find a 'pending' job in your "jobs" table
    const { data: job, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[worker] Error fetching job:", error.message);
      return;
    }
    if (!job) {
      // No pending jobs, so just return (worker waits for next interval)
      return;
    }

    console.log(`[worker] Found job id=${job.id} => Marking it 'processing'...`);

    // 2) Mark this job as 'processing'
    await supabase
      .from("jobs")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", job.id);

    // 3) Grab your pendingPages from "processing_queue" (or wherever). 
    //    Then slice them for offset + total_pages from the job row.
    const { data: pendingPages, error: pagesError } = await supabase
      .from("processing_queue")
      .select("*")
      .eq("status", "pending");
    if (pagesError) {
      throw new Error(`[worker] Error fetching pendingPages: ${pagesError.message}`);
    }

    const { total_pages, page_offset, concurrency } = job;
    const pagesToProcess = pendingPages.slice(page_offset, page_offset + total_pages);

    console.log(
      `[worker] Starting concurrency-limited processing of ${pagesToProcess.length} pages, ` +
      `offset=${page_offset}, concurrency=${concurrency}.`
    );

    // 4) concurrency-limited loop
    let processedCount = 0;
    for (let i = 0; i < pagesToProcess.length; i += concurrency) {
      const batch = pagesToProcess.slice(i, i + concurrency);

      // Wait for them in parallel
      await Promise.all(
        batch.map(async (page) => {
          try {
            await processOnePageFromDB(page.id);
            processedCount++;
          } catch (e) {
            console.error("[worker] Error processing page:", e);
          }
        })
      );

      // optional delay
      if (i + concurrency < pagesToProcess.length) {
        console.log(`[worker] Processed batch, waiting ${BATCH_DELAY_MS}ms before next batch...`);
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    console.log(`[worker] Done processing job id=${job.id}; processedCount=${processedCount}`);

    // 5) Mark job as completed
    await supabase
      .from("jobs")
      .update({
        status: "completed",
        finished_at: new Date().toISOString(),
        error_message: null
      })
      .eq("id", job.id);

  } catch (err) {
    console.error("[worker] Unexpected error in processJobs():", err.message);
    // If something breaks mid-job, you can mark that job as failed
  }
}

// A simple loop that calls processJobs() every 5 seconds:
setInterval(() => {
  processJobs().catch((err) => {
    console.error("[worker] processJobs() top-level error:", err);
  });
}, CHECK_INTERVAL_MS);
