import React, { useState } from "react";

export default function FetchAndGeneratePage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const handleFetchAndGenerate = async () => {
    setLoading(true);
    setStatus("");

    try {
      const response = await fetch("/api/util/fetch-and-generate", {
        method: "POST",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to start process");
      }
      const data = await response.json();
      setStatus(data.message);
    } catch (error) {
      console.error("[Frontend] Error:", error);
      setStatus(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Fetch and Generate</h1>
      <button onClick={handleFetchAndGenerate} disabled={loading}>
        {loading ? "Processing..." : "Start Fetch and Generate"}
      </button>
      {status && <p>{status}</p>}
    </div>
  );
}
