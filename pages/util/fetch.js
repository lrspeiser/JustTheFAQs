import React, { useState } from "react";

export default function FetchAndGeneratePage() {
  const [pendingPages, setPendingPages] = useState([]);
  const [messageLog, setMessageLog] = useState([]); // We'll store logs as an array of strings
  const [loading, setLoading] = useState(false);
  const [processCount, setProcessCount] = useState("");

  // Keep track of success/failure counters
  const [successCount, setSuccessCount] = useState(0);
  const [failureCount, setFailureCount] = useState(0);

  const [stopRequested, setStopRequested] = useState(false);

  // Step 1
  const handleGetPendingPages = async () => {
    setLoading(true);
    setMessageLog(["Fetching pending pages..."]);
    try {
      const response = await fetch("/api/getPendingPages");
      if (!response.ok) {
        throw new Error("Failed to fetch pending pages.");
      }
      const data = await response.json();
      console.log("Pending pages:", data.pendingPages);
      setPendingPages(data.pendingPages || []);
      setMessageLog((prev) => [...prev, `Fetched ${data.pendingPages?.length || 0} pending pages.`]);
    } catch (error) {
      console.error("[Frontend] Error fetching pending pages:", error);
      setMessageLog((prev) => [...prev, `Error: ${error.message}`]);
    } finally {
      setLoading(false);
    }
  };

  // Step 2
  const handleProcessPages = async () => {
    if (!processCount || isNaN(processCount)) {
      setMessageLog((prev) => [...prev, "Please enter a valid number of pages to process."]);
      return;
    }

    const countToProcess = parseInt(processCount, 10);
    if (countToProcess <= 0) {
      setMessageLog((prev) => [...prev, "Please enter a number > 0."]);
      return;
    }

    if (pendingPages.length === 0) {
      setMessageLog((prev) => [...prev, "No pending pages in the list. Please fetch them first."]);
      return;
    }

    // Reset counters
    setSuccessCount(0);
    setFailureCount(0);

    // Clear old logs or keep them? Let’s keep them
    setMessageLog((prev) => [...prev, `Starting throttled processing of ${countToProcess} pages...`]);
    setStopRequested(false);
    setLoading(true);

    // Slice the array
    const pagesToProcess = pendingPages.slice(0, countToProcess);

    // Concurrency config
    const CONCURRENCY = 40;
    const BATCH_DELAY_MS = 200;

    let results = [];

    const processSinglePage = async (page, index) => {
      try {
        console.log(`[Process] #${index + 1}: ${page.title}`);
        const res = await fetch("/api/util/fetch-and-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: page.id }),
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.message || "Failed to process page");
        }
        const data = await res.json();

        // Remove from pending
        setPendingPages((prev) => prev.filter((p) => p.id !== page.id));

        // Increment success
        setSuccessCount((prev) => prev + 1);

        // Add a simple success message
        setMessageLog((prev) => [...prev, `Finished "${page.title}".`]);

        return { title: page.title, success: true };
      } catch (err) {
        console.error(`[Process] Error on "${page.title}":`, err);
        setFailureCount((prev) => prev + 1);

        // Log a short error line
        setMessageLog((prev) => [...prev, `Error processing "${page.title}": ${err.message}`]);

        return { title: page.title, success: false, error: err.message };
      }
    };

    try {
      for (let i = 0; i < pagesToProcess.length; i += CONCURRENCY) {
        if (stopRequested) {
          console.warn("[Process] Stop requested; not starting next batch.");
          setMessageLog((prev) => [...prev, "Stopped before next batch."]);
          break;
        }

        const batch = pagesToProcess.slice(i, i + CONCURRENCY);

        // Parallel
        const batchResults = await Promise.all(
          batch.map((page, idx) => processSinglePage(page, i + idx))
        );
        results = [...results, ...batchResults];

        if (i + CONCURRENCY < pagesToProcess.length) {
          setMessageLog((prev) => [...prev, `Waiting ${BATCH_DELAY_MS / 1000}s before next batch...`]);
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      const successes = results.filter((r) => r.success).length;
      const failures = results.filter((r) => !r.success).length;
      setMessageLog((prev) => [...prev, `Finished processing. Successes: ${successes}, Failures: ${failures}`]);
    } catch (err) {
      console.error("[Process] Unexpected error:", err);
      setMessageLog((prev) => [...prev, `Unexpected error: ${err.message}`]);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = () => {
    setStopRequested(true);
    setMessageLog((prev) => [...prev, "Stop requested: finishing current batch but no more after that."]);
  };

  return (
    <div style={{ margin: "2rem" }}>
      <h1>Fetch and Generate</h1>

      <button onClick={handleGetPendingPages} disabled={loading}>
        {loading ? "Loading..." : "Step 1: Get a list of pending pages"}
      </button>

      <div style={{ marginTop: "1rem", marginBottom: "1rem" }}>
        <label>
          Step 2: Process{" "}
          <input
            type="number"
            value={processCount}
            onChange={(e) => setProcessCount(e.target.value)}
            style={{ width: "60px" }}
          />
          {" "}pages
        </label>
        <button onClick={handleProcessPages} disabled={loading || !pendingPages.length}>
          {loading ? "Processing..." : "Process"}
        </button>
        <button onClick={handleStop} disabled={!loading} style={{ marginLeft: "1rem" }}>
          Stop
        </button>
      </div>

      {/* Real-time counters at the top or bottom (your preference) */}
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
          padding: "0.5rem"
        }}
      >
        {messageLog.map((line, idx) => (
          <div key={idx}>{line}</div>
        ))}
      </div>

      {/* Pending pages below */}
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
