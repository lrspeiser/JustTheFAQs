import React, { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function FetchAndGeneratePage() {
  // --------------------------------------
  // Existing states & logging
  // --------------------------------------
  const [pendingPages, setPendingPages] = useState([]);
  const [messageLog, setMessageLog] = useState([]);
  const [loading, setLoading] = useState(false);

  const [processCount, setProcessCount] = useState("");
  const [processOffset, setProcessOffset] = useState("0");
  const [concurrency, setConcurrency] = useState("50");

  const [successCount, setSuccessCount] = useState(0);
  const [failureCount, setFailureCount] = useState(0);

  const [stopRequested, setStopRequested] = useState(false);

  // --------------------------------------
  // Realtime Subscription: Listen for job updates using Supabase v2's channel API
  // --------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel("jobs-channel")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs" },
        (payload) => {
          const job = payload.new;
          const message = `Job ID=${job.id} updated: status=${job.status}, error_message=${job.error_message || "None"}, processed_pages=${
            job.processed_pages && job.processed_pages.length
              ? job.processed_pages.join(", ")
              : "None"
          }`;
          console.log("Realtime job update:", message);
          setMessageLog((prev) => [...prev, message]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // --------------------------------------
  // Existing "Step 1: Get Pending Pages"
  // --------------------------------------
  const handleGetPendingPages = async () => {
    setLoading(true);
    setMessageLog((prev) => [...prev, "Fetching pending pages..."]);
    try {
      const response = await fetch("/api/getPendingPages");
      if (!response.ok) {
        throw new Error("Failed to fetch pending pages.");
      }
      const data = await response.json();
      console.log("[Frontend] Pending pages:", data.pendingPages);

      setPendingPages(data.pendingPages || []);
      setMessageLog((prev) => [
        ...prev,
        `Fetched ${data.pendingPages?.length || 0} pending pages.`,
      ]);
    } catch (error) {
      console.error("[Frontend] Error fetching pending pages:", error);
      setMessageLog((prev) => [...prev, `Error: ${error.message}`]);
    } finally {
      setLoading(false);
    }
  };

  // --------------------------------------
  // NEW: Create a Job on the Server
  // --------------------------------------
  const handleCreateJob = async () => {
    setLoading(true);
    setMessageLog((prev) => [...prev, "Creating job(s) on the server..."]);

    try {
      const countVal = parseInt(processCount, 10);
      const offsetVal = parseInt(processOffset, 10);
      const concurrencyVal = parseInt(concurrency, 10);

      // Basic validation
      if (
        !countVal ||
        countVal <= 0 ||
        offsetVal < 0 ||
        concurrencyVal <= 0
      ) {
        throw new Error(
          "Please enter valid numbers for process count, offset >= 0, and concurrency > 0."
        );
      }

      // POST to /api/jobs
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          total_pages: countVal,
          page_offset: offsetVal,
          concurrency: concurrencyVal,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to create job: HTTP ${res.status}`);
      }

      // Because /api/jobs now returns { jobs: [...] }, we handle an array of jobs
      const { jobs } = await res.json();

      // Defensive check: if no jobs returned, throw an error
      if (!jobs || !jobs.length) {
        throw new Error("No jobs returned from server");
      }

      // Show a message for each created job
      jobs.forEach((j) => {
        setMessageLog((prev) => [
          ...prev,
          `✅ Created job ID=${j.id} successfully (server will process in background).`,
        ]);
      });

      // Also log them in the console
      jobs.forEach((j) => {
        console.log("Job created:", j.id);
      });
    } catch (err) {
      console.error("Error creating job:", err);
      setMessageLog((prev) => [...prev, `Error: ${err.message}`]);
    } finally {
      setLoading(false);
    }
  };

  // --------------------------------------
  // NEW: Start Worker on the Server
  // --------------------------------------
  const handleStartWorker = async () => {
    setLoading(true);
    setMessageLog((prev) => [
      ...prev,
      "Starting worker process on the server...",
    ]);
    try {
      const res = await fetch("/api/start-worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        throw new Error(`Failed to start worker: HTTP ${res.status}`);
      }
      const data = await res.json();
      console.log("Worker started:", data.message);
      setMessageLog((prev) => [...prev, `✅ ${data.message}`]);
    } catch (err) {
      console.error("Error starting worker:", err);
      setMessageLog((prev) => [
        ...prev,
        `Error starting worker: ${err.message}`,
      ]);
    } finally {
      setLoading(false);
    }
  };

  // --------------------------------------
  // Existing "Step 2: Process pages with offset" (Browser concurrency)
  // --------------------------------------
  const handleProcessPages = async () => {
    // Validate the user inputs
    const countVal = parseInt(processCount, 10);
    const offsetVal = parseInt(processOffset, 10);
    const concurrencyVal = parseInt(concurrency, 10);

    if (!countVal || isNaN(countVal) || countVal <= 0) {
      setMessageLog((prev) => [
        ...prev,
        "Please enter a valid process count > 0.",
      ]);
      return;
    }
    if (offsetVal < 0 || isNaN(offsetVal)) {
      setMessageLog((prev) => [
        ...prev,
        "Please enter a valid offset >= 0.",
      ]);
      return;
    }
    if (!concurrencyVal || isNaN(concurrencyVal) || concurrencyVal <= 0) {
      setMessageLog((prev) => [
        ...prev,
        "Please enter a valid concurrency > 0.",
      ]);
      return;
    }

    if (pendingPages.length === 0) {
      setMessageLog((prev) => [
        ...prev,
        "No pending pages in the list. Please fetch them first.",
      ]);
      return;
    }

    // Reset counters
    setSuccessCount(0);
    setFailureCount(0);

    setMessageLog((prev) => [
      ...prev,
      `Starting throttled processing of ${countVal} pages, ` +
        `beginning at offset ${offsetVal}, concurrency=${concurrencyVal}.`,
    ]);
    setStopRequested(false);
    setLoading(true);

    // We slice the array client-side
    const pagesToProcess = pendingPages.slice(offsetVal, offsetVal + countVal);

    const BATCH_DELAY_MS = 200;
    let results = [];

    // Helper to process one page
    const processSinglePage = async (page, index) => {
      try {
        console.log(
          `[Process] #${index + 1} =>`,
          page.title,
          `(ID=${page.id})`
        );
        const res = await fetch("/api/util/fetch-and-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: page.id }),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(
            errData.message || `Failed to process page with ID=${page.id}`
          );
        }

        await res.json(); // might read a message
        // Remove from pending
        setPendingPages((prev) =>
          prev.filter((p) => p.id !== page.id)
        );
        setSuccessCount((prev) => prev + 1);

        setMessageLog((prev) => [
          ...prev,
          `Finished "${page.title}" (ID=${page.id}).`,
        ]);

        return { title: page.title, success: true };
      } catch (err) {
        console.error(`[Process] Error on "${page.title}":`, err);
        setFailureCount((prev) => prev + 1);
        setMessageLog((prev) => [
          ...prev,
          `Error processing "${page.title}": ${err.message}`,
        ]);
        return { title: page.title, success: false, error: err.message };
      }
    };

    // Process in concurrency-limited batches
    try {
      for (let i = 0; i < pagesToProcess.length; i += concurrencyVal) {
        if (stopRequested) {
          console.warn("[Process] Stop requested; not starting next batch.");
          setMessageLog((prev) => [
            ...prev,
            "Stopped before next batch.",
          ]);
          break;
        }

        const batch = pagesToProcess.slice(i, i + concurrencyVal);

        const batchResults = await Promise.all(
          batch.map((page, idx) => processSinglePage(page, i + idx))
        );
        results = [...results, ...batchResults];

        if (i + concurrencyVal < pagesToProcess.length) {
          setMessageLog((prev) => [
            ...prev,
            `Waiting ${BATCH_DELAY_MS / 1000}s before next batch...`,
          ]);
          await new Promise((resolve) =>
            setTimeout(resolve, BATCH_DELAY_MS)
          );
        }
      }

      const successes = results.filter((r) => r.success).length;
      const failures = results.filter((r) => !r.success).length;
      setMessageLog((prev) => [
        ...prev,
        `Finished processing. Successes: ${successes}, Failures: ${failures}`,
      ]);
    } catch (err) {
      console.error("[Process] Unexpected error:", err);
      setMessageLog((prev) => [
        ...prev,
        `Unexpected error: ${err.message}`,
      ]);
    } finally {
      setLoading(false);
    }
  };

  // --------------------------------------
  // "Stop" the client-driven concurrency
  // --------------------------------------
  const handleStop = () => {
    setStopRequested(true);
    setMessageLog((prev) => [
      ...prev,
      "Stop requested: finishing current batch but no more after that.",
    ]);
  };

  // --------------------------------------
  // JSX
  // --------------------------------------
  return (
    <div style={{ margin: "2rem" }}>
      <h1>Fetch and Generate</h1>

      {/* 1) Get Pending Pages */}
      <button onClick={handleGetPendingPages} disabled={loading}>
        {loading ? "Loading..." : "Step 1: Get a list of pending pages"}
      </button>

      {/* 2) Inputs: offset, count, concurrency */}
      <div style={{ marginTop: "1rem", marginBottom: "1rem" }}>
        <label>
          Offset:
          <input
            type="number"
            value={processOffset}
            onChange={(e) => setProcessOffset(e.target.value)}
            style={{ width: "60px", marginLeft: "0.5rem", marginRight: "1rem" }}
          />
        </label>
        <label>
          Process this many pages:
          <input
            type="number"
            value={processCount}
            onChange={(e) => setProcessCount(e.target.value)}
            style={{ width: "60px", marginLeft: "0.5rem", marginRight: "1rem" }}
          />
        </label>
        <label>
          Concurrency:
          <input
            type="number"
            value={concurrency}
            onChange={(e) => setConcurrency(e.target.value)}
            style={{ width: "60px", marginLeft: "0.5rem" }}
          />
        </label>
      </div>

      {/* NEW "Start Worker" Button (Server-Side Process Trigger) */}
      <button
        onClick={handleStartWorker}
        disabled={loading}
        style={{ marginRight: "1rem" }}
      >
        {loading ? "Working..." : "Start Worker (Server-Side)"}
      </button>

      {/* NEW "Create Job" Button (Server-Side Concurrency) */}
      <button
        onClick={handleCreateJob}
        disabled={loading}
        style={{ marginRight: "1rem" }}
      >
        {loading ? "Working..." : "Create Job (Server-Side)"}
      </button>

      {/* OLD "Process" Approach (Browser-Side Concurrency) */}
      <button
        onClick={handleProcessPages}
        disabled={loading || !pendingPages.length}
        style={{ marginRight: "1rem" }}
      >
        {loading ? "Processing..." : "Process (Browser-Side)"}
      </button>

      {/* Stop Button (Client-Side Only) */}
      <button onClick={handleStop} disabled={!loading}>
        Stop
      </button>

      {/* Real-time success/failure counters */}
      <div style={{ marginTop: "1rem", marginBottom: "1rem" }}>
        <strong>Successes:</strong> {successCount} &nbsp;|&nbsp;
        <strong>Failures:</strong> {failureCount}
      </div>

      {/* Message Log */}
      <div
        style={{
          maxHeight: "200px",
          overflowY: "auto",
          border: "1px solid #ccc",
          padding: "0.5rem",
        }}
      >
        {messageLog.map((line, idx) => (
          <div key={idx}>{line}</div>
        ))}
      </div>

      {/* Pending Pages List */}
      {pendingPages.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h3>Pending Pages: {pendingPages.length}</h3>
          <ul>
            {pendingPages.map((p, i) => (
              <li key={p.id || i}>
                <strong>{p.title}</strong> — {p.status}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
