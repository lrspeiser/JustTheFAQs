import React, { useState } from "react";

  export default function FetchAndGeneratePage() {
    // List of pending pages
    const [pendingPages, setPendingPages] = useState([]);

    // For logging messages in the UI
    const [messageLog, setMessageLog] = useState([]);

    // Loading state for UI
    const [loading, setLoading] = useState(false);

    // How many pages to process at a time
    const [processCount, setProcessCount] = useState("");

    // Default the offset to "0"
    const [processOffset, setProcessOffset] = useState("0");

    // Default concurrency to "50"
    const [concurrency, setConcurrency] = useState("50");

    // Counters for success/failure
    const [successCount, setSuccessCount] = useState(0);
    const [failureCount, setFailureCount] = useState(0);

    // Flag to request stopping
    const [stopRequested, setStopRequested] = useState(false);

  // ------------------
  // Step 1: Fetch pending pages
  // ------------------
  const handleGetPendingPages = async () => {
    setLoading(true);
    setMessageLog(["Fetching pending pages..."]);
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

  // ------------------
  // Step 2: Process pages with offset
  // ------------------
    const handleProcessPages = async () => {
      // Validate the user inputs: count, offset, concurrency
      const countVal = parseInt(processCount, 10);
      const offsetVal = parseInt(processOffset, 10);
      const concurrencyVal = parseInt(concurrency, 10);

      // Check for invalid or missing values
      if (!countVal || isNaN(countVal) || countVal <= 0) {
        setMessageLog((prev) => [...prev, "Please enter a valid process count > 0."]);
        return;
      }
      if (offsetVal < 0 || isNaN(offsetVal)) {
        setMessageLog((prev) => [...prev, "Please enter a valid offset >= 0."]);
        return;
      }
      if (!concurrencyVal || isNaN(concurrencyVal) || concurrencyVal <= 0) {
        setMessageLog((prev) => [...prev, "Please enter a valid concurrency > 0."]);
        return;
      }

      // Check if we actually have pages to process
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

      // Log the start
      setMessageLog((prev) => [
        ...prev,
        `Starting throttled processing of ${countVal} pages, ` +
          `beginning at offset ${offsetVal}, concurrency=${concurrencyVal}.`,
      ]);
      setStopRequested(false);
      setLoading(true);

      // Slice the array to just those pages we want to process
      const pagesToProcess = pendingPages.slice(offsetVal, offsetVal + countVal);

      // We'll wait between concurrency batches
      const BATCH_DELAY_MS = 200;
      let results = [];

      // Helper function to process a single page
      const processSinglePage = async (page, index) => {
        try {
          console.log(`[Process] #${index + 1} concurrency-chunk =>`, page.title, `(ID=${page.id})`);
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

          await res.json(); // not strictly needed, but we might read the message

          // If success, remove from pending
          setPendingPages((prev) => prev.filter((p) => p.id !== page.id));
          setSuccessCount((prev) => prev + 1);

          // Log the success
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
          // If user requested stop, break out
          if (stopRequested) {
            console.warn("[Process] Stop requested; not starting next batch.");
            setMessageLog((prev) => [...prev, "Stopped before next batch."]);
            break;
          }

          // Build this batch
          const batch = pagesToProcess.slice(i, i + concurrencyVal);

          // Process them in parallel
          const batchResults = await Promise.all(
            batch.map((page, idx) => processSinglePage(page, i + idx))
          );

          // Merge results
          results = [...results, ...batchResults];

          // If there is another batch coming, wait a bit
          if (i + concurrencyVal < pagesToProcess.length) {
            setMessageLog((prev) => [
              ...prev,
              `Waiting ${BATCH_DELAY_MS / 1000}s before next batch...`,
            ]);
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }

        // Summarize
        const successes = results.filter((r) => r.success).length;
        const failures = results.filter((r) => !r.success).length;
        setMessageLog((prev) => [
          ...prev,
          `Finished processing. Successes: ${successes}, Failures: ${failures}`,
        ]);
      } catch (err) {
        console.error("[Process] Unexpected error:", err);
        setMessageLog((prev) => [...prev, `Unexpected error: ${err.message}`]);
      } finally {
        setLoading(false);
      }
    };

  // ------------------
  // Handle the "Stop" button
  // ------------------
  const handleStop = () => {
    setStopRequested(true);
    setMessageLog((prev) => [
      ...prev,
      "Stop requested: finishing current batch but no more after that.",
    ]);
  };

  // ------------------
  // JSX for rendering
  // ------------------
  return (
      <div style={{ margin: "2rem" }}>
        <h1>Fetch and Generate</h1>

        {/* STEP 1: Get Pending Pages */}
        <button onClick={handleGetPendingPages} disabled={loading}>
          {loading ? "Loading..." : "Step 1: Get a list of pending pages"}
        </button>

        {/* STEP 2: Provide Offset, Count, Concurrency, then Process */}
        <div style={{ marginTop: "1rem", marginBottom: "1rem" }}>
          {/* Offset */}
          <label>
            Offset:
            <input
              type="number"
              value={processOffset}
              onChange={(e) => setProcessOffset(e.target.value)}
              style={{ width: "60px", marginLeft: "0.5rem", marginRight: "1rem" }}
            />
          </label>

          {/* Count */}
          <label>
            Process this many pages:
            <input
              type="number"
              value={processCount}
              onChange={(e) => setProcessCount(e.target.value)}
              style={{ width: "60px", marginLeft: "0.5rem", marginRight: "1rem" }}
            />
          </label>

          {/* Concurrency */}
          <label>
            Concurrency:
            <input
              type="number"
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
              style={{ width: "60px", marginLeft: "0.5rem" }}
            />
          </label>

          <button
            onClick={handleProcessPages}
            disabled={loading || !pendingPages.length}
            style={{ marginLeft: "1rem" }}
          >
            {loading ? "Processing..." : "Process"}
          </button>

          <button onClick={handleStop} disabled={!loading} style={{ marginLeft: "1rem" }}>
            Stop
          </button>
        </div>

        {/* Real-time success/failure counters */}
        <div style={{ marginBottom: "1rem" }}>
          <strong>Successes:</strong> {successCount} &nbsp;|&nbsp;
          <strong>Failures:</strong> {failureCount}
        </div>

        {/* Message Log - a scrollable box */}
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

        {/* Show the list of pending pages */}
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
