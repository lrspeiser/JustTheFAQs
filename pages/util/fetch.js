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

    let countToProcess = parseInt(processCount, 10);
    if (countToProcess <= 0) {
      setMessage("Please enter a number > 0.");
      return;
    }

    if (pendingPages.length === 0) {
      setMessage("No pending pages in the list. Please fetch them first.");
      return;
    }

    setLoading(true);
    setMessage(`Starting process of ${countToProcess} pages...`);

    // We'll go in order—call /api/util/fetch-and-generate for each page
    for (let i = 0; i < countToProcess; i++) {
      if (i >= pendingPages.length) {
        setMessage(`Processed all ${i} pages (ran out of pages).`);
        break;
      }
      const page = pendingPages[i];

      try {
        console.log(`[handleProcessPages] Processing page #${i + 1}:`, page.title);

        // IMPORTANT: Send the *ID*, not just the title
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
        setMessage(`Processed page "${page.title}" (${i + 1}/${countToProcess}).`);
      } catch (err) {
        console.error(`[handleProcessPages] Error on page "${page.title}":`, err);
        setMessage(`Error processing page "${page.title}": ${err.message}`);
        // Decide if you want to continue with the next page or stop
      }
    }

    setLoading(false);
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
