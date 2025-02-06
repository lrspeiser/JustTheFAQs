//
// /lib/worker.js
//
import { supabase } from "./supabaseClient.js";
import { processOnePageFromDB } from "./processSinglePage.js"; 

const CHECK_INTERVAL_MS = 2000; // how often to poll for jobs (2 seconds)
const CONCURRENCY = 50;         // how many jobs to pick up at once in parallel

async function processJobs() {
  try {
    // 1) Find up to CONCURRENCY 'pending' jobs in your "jobs" table
    const { data: pendingJobs, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("status", "pending")
    // Order by cross_link_priority (true first) and then by created_at ascending
    .order("cross_link_priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(CONCURRENCY);


    if (error) {
      console.error("[worker] Error fetching pending jobs:", error.message);
      return;
    }
    if (!pendingJobs || !pendingJobs.length) {
      // No pending jobs, so just return (worker waits for next interval)
      console.log("[worker] No pending jobs found at this time.");
      return;
    }

    console.log(`[worker] Found ${pendingJobs.length} pending job(s). Starting parallel processing...`);

    // 2) For each job, mark it 'processing', then call processOnePageFromDB, etc.
    await Promise.all(
      pendingJobs.map(async (job) => {
        try {
          console.log(`[worker] Marking job ID=${job.id} => 'processing'...`);
          await supabase
            .from("jobs")
            .update({ status: "processing", started_at: new Date().toISOString() })
            .eq("id", job.id);

          // Here we assume each job references exactly one page to process
          // For example, job might have 'page_id' or 'title' or 'url' that we pass to processOnePageFromDB
          // Let's pretend job.page_id references a row in "processing_queue"
          const result = await processOnePageFromDB(job.page_id); 
          // "result" is an object like: { success: true } or { success: false, reason: "..." }

          if (result.success) {
            console.log(`[worker] Done processing job ID=${job.id}, marking completed...`);
            await supabase
              .from("jobs")
              .update({
                status: "completed",
                finished_at: new Date().toISOString(),
                error_message: null
              })
              .eq("id", job.id);
          } else {
            console.warn(`[worker] processOnePageFromDB returned false for job ID=${job.id}, marking failed.`);
            console.warn(`[worker] Reason => ${result.reason || "No reason provided"}`);
            await supabase
              .from("jobs")
              .update({
                status: "failed",
                finished_at: new Date().toISOString(),
                error_message: result.reason || "processOnePageFromDB returned false"
              })
              .eq("id", job.id);
          }

        } catch (jobErr) {
          console.error(`[worker] Error processing job ID=${job.id}:`, jobErr);

          // Mark job as failed if there's an error
          await supabase
            .from("jobs")
            .update({
              status: "failed",
              finished_at: new Date().toISOString(),
              error_message: jobErr.message
            })
            .eq("id", job.id);
        }
      })
    );

    console.log(`[worker] Completed parallel processing of ${pendingJobs.length} job(s).`);

  } catch (err) {
    console.error("[worker] Unexpected error in processJobs():", err.message);
  }
}

// A simple loop that calls processJobs() every 20s:
setInterval(() => {
  processJobs().catch((err) => {
    console.error("[worker] processJobs() top-level error:", err);
  });
}, CHECK_INTERVAL_MS);
