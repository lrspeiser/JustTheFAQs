import React, { useState } from "react";

export default function FetchAndGeneratePage() {
  const [pendingPages, setPendingPages] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [processCount, setProcessCount] = useState(""); // number of pages to process

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
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Process X pages from the pending list, calling existing /api/util/fetch-and-generate
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

    setLoading(true);
    setMessage(`Starting parallel processing of ${countToProcess} pages...`);

    // We'll slice the array in case the user asked for 10 but we only have e.g. 7
    const pagesToProcess = pendingPages.slice(0, countToProcess);

    try {
      // Build an array of async tasks (each is a POST to /api/util/fetch-and-generate)
      const tasks = pagesToProcess.map(async (page, i) => {
        try {
          console.log(`[handleProcessPages] Parallel: Processing #${i + 1}: ${page.title}`);
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

          // PARTIAL UPDATE: remove the page from `pendingPages` or mark it as done
          setPendingPages(prev => prev.filter(p => p.id !== page.id));

          // PARTIAL UPDATE: show partial progress
          setMessage(
            `Finished page "${page.title}". Pages left: ${pendingPages.length - 1}`
          );

          return { title: page.title, success: true };
        } catch (err) {
          console.error(`[handleProcessPages] Error on page "${page.title}":`, err);

          // PARTIAL UPDATE: show partial error
          setMessage(`Error processing "${page.title}": ${err.message}`);

          return { title: page.title, success: false, error: err.message };
        }
      });

      // Wait for all parallel tasks to complete
      const results = await Promise.all(tasks);

      // Summarize final successes/failures
      const successes = results.filter(r => r.success).length;
      const failures = results.filter(r => !r.success).length;
      setMessage(`Finished parallel processing. Successes: ${successes}, Failures: ${failures}`);
    } catch (err) {
      console.error("[handleProcessPages] Unexpected error in parallel processing:", err);
      setMessage(`Unexpected error: ${err.message}`);
    } finally {
      setLoading(false);
    }
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
      </div>

      {/* Status message */}
      {message && <p>{message}</p>}

      {/* Render pending pages */}
      {pendingPages.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h3>Pending Pages:</h3>
          <ul>
            {pendingPages.map((page, idx) => (
              <li key={page.id || idx}>
                <strong>{page.title}</strong> — Status: {page.status}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
