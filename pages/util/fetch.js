import React, { useState } from "react";

export default function FetchAndGeneratePage() {
  const [pendingPages, setPendingPages] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [processCount, setProcessCount] = useState(""); // number of pages to process

  // Keep track of partial successes/failures
  const [successCount, setSuccessCount] = useState(0);
  const [failureCount, setFailureCount] = useState(0);

  // State to track whether the user requested a stop
  const [stopRequested, setStopRequested] = useState(false);

  // Step 1: Get a list of pages that need to be processed
  const handleGetPendingPages = async () => {
    setLoading(true);
    setMessage("Fetching pending pages...");
    try {
      const response = await fetch("/api/getPendingPages");
      if (!response.ok) {
        throw new Error("Failed to fetch pending pages.");
      }
      const data = await response.json();
      console.log("Pending pages:", data.pendingPages);
      setPendingPages(data.pendingPages || []);
      setMessage(`Fetched ${data.pendingPages?.length || 0} pending pages.`);
    } catch (error) {
      console.error("[Frontend] Error fetching pending pages:", error);
      // Instead of overwriting, we append the error to the existing message:
      setMessage((prevMsg) => `${prevMsg}\nError: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Process X pages from the pending list
  const handleProcessPages = async () => {
    if (!processCount || isNaN(processCount)) {
      setMessage("Please enter a valid number of pages to process.");
      return;
    }

    const countToProcess = parseInt(processCount, 10);
    if (countToProcess <= 0) {
      setMessage("Please enter a number > 0.");
      return;
    }

    if (pendingPages.length === 0) {
      setMessage("No pending pages in the list. Please fetch them first.");
      return;
    }

    // Reset counters
    setSuccessCount(0);
    setFailureCount(0);
    // Reset any previous stop request
    setStopRequested(false);

    setLoading(true);
    setMessage(`Starting throttled processing of ${countToProcess} pages...`);

    const pagesToProcess = pendingPages.slice(0, countToProcess);

    // Throttle settings
    const CONCURRENCY = 40;
    const BATCH_DELAY_MS = 200;

    let results = [];

    const processSinglePage = async (page, index) => {
      try {
        console.log(`[handleProcessPages] Throttled: Processing #${index + 1}: ${page.title}`);
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
        console.log(`[handleProcessPages] Response for page "${page.title}":`, data);

        // PARTIAL UPDATE: remove the page from `pendingPages`
        setPendingPages((prev) => prev.filter((p) => p.id !== page.id));

        // Increment success count
        setSuccessCount((prev) => prev + 1);

        // Show partial progress
        setSuccessCount((prevSuccessCount) => {
          const newSuccessCount = prevSuccessCount;
          const leftInQueue = pendingPages.length - 1;
          // Append partial success info to message
          setMessage((prevMsg) =>
            `${prevMsg}\nFinished "${page.title}". Successes: ${newSuccessCount}, Failures: ${failureCount} (Left: ${leftInQueue})`
          );
          return newSuccessCount;
        });

        return { title: page.title, success: true };
      } catch (err) {
        console.error(`[handleProcessPages] Error on page "${page.title}":`, err);
        setFailureCount((prev) => prev + 1);

        // *** Append error message instead of overwriting ***
        setMessage((prevMsg) =>
          `${prevMsg}\nError processing "${page.title}": ${err.message} (Successes: ${successCount}, Failures: ${failureCount + 1})`
        );

        return { title: page.title, success: false, error: err.message };
      }
    };

    try {
      // Batch loop
      for (let i = 0; i < pagesToProcess.length; i += CONCURRENCY) {
        // If stop requested, break before next batch
        if (stopRequested) {
          console.warn("[handleProcessPages] Stop requested; not starting next batch.");
          setMessage((prevMsg) => `${prevMsg}\nStopped before starting the next batch.`);
          break;
        }

        const batch = pagesToProcess.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map((page, indexInBatch) => processSinglePage(page, i + indexInBatch))
        );
        results = [...results, ...batchResults];

        // If not the last batch, pause
        if (i + CONCURRENCY < pagesToProcess.length) {
          console.log(`[handleProcessPages] Waiting ${BATCH_DELAY_MS}ms before next batch...`);
          setMessage((prevMsg) => `${prevMsg}\nWaiting ${BATCH_DELAY_MS / 1000}s before next batch...`);
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      // Summarize final result
      const successes = results.filter((r) => r.success).length;
      const failures = results.filter((r) => !r.success).length;
      setMessage((prevMsg) => `${prevMsg}\nFinished throttled processing. Successes: ${successes}, Failures: ${failures}`);
    } catch (err) {
      console.error("[handleProcessPages] Unexpected error in throttled processing:", err);
      // *** Append the unexpected error to the existing message ***
      setMessage((prevMsg) => `${prevMsg}\nUnexpected error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Stop button sets stopRequested = true
  const handleStop = () => {
    setStopRequested(true);
    // Append to existing message
    setMessage((prevMsg) => `${prevMsg}\nStop requested: finishing current batch but no more after that.`);
  };

  return (
    <div style={{ margin: "2rem" }}>
      <h1>Fetch and Generate</h1>

      {/* Step 1 */}
      <button onClick={handleGetPendingPages} disabled={loading}>
        {loading ? "Loading..." : "Step 1: Get a list of pages that need processing"}
      </button>

      {/* Step 2 */}
      <div style={{ marginTop: "1rem", marginBottom: "1rem" }}>
        <label>
          Step 2: Process{" "}
          <input
            type="number"
            value={processCount}
            onChange={(e) => setProcessCount(e.target.value)}
            style={{ width: "60px" }}
          />
          {" "}pages from the list
        </label>
        <button onClick={handleProcessPages} disabled={loading || !pendingPages.length}>
          {loading ? "Processing..." : "Process"}
        </button>

        <button onClick={handleStop} disabled={!loading} style={{ marginLeft: "1rem" }}>
          Stop
        </button>
      </div>

      {/* Status message (with multi-line support) */}
      {message && (
        <pre style={{ whiteSpace: 'pre-wrap', border: '1px solid #ccc', padding: '0.5rem' }}>
          {message}
        </pre>
      )}

      {/* Render pending pages + partial counters */}
      {pendingPages.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h3>Pending Pages (In Queue): {pendingPages.length}</h3>
          <ul>
            {pendingPages.map((page, idx) => (
              <li key={page.id || idx}>
                <strong>{page.title}</strong> — Status: {page.status}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: "1rem" }}>
        <strong>Successes:</strong> {successCount} <br />
        <strong>Failures:</strong> {failureCount}
      </div>
    </div>
  );
}
