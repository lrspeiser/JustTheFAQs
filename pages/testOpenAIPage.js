//
// pages/testOpenAIPage.js
//
// This is a simple Next.js page that calls the API route above (/api/testOpenAI)
// and displays the result. Deploy it on Vercel, then open
//   https://<your-vercel-deployment>/testOpenAIPage
// to see the UI.
// Remember to set OPENAI_API_KEY in your Vercel project's Environment Variables.
//

import React, { useState } from "react";

function TestOpenAIPage() {
  // We'll store the result in component state
  const [apiResponse, setApiResponse] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleTestOpenAI() {
    console.log("[TestOpenAIPage] Clicking the 'Test OpenAI' button...");
    setIsLoading(true);
    setApiResponse(null);

    try {
      console.log("[TestOpenAIPage] Sending request to /api/testOpenAI...");
      const res = await fetch("/api/testOpenAI");
      const data = await res.json();
      console.log("[TestOpenAIPage] Received data:", data);

      if (!res.ok) {
        // If we got an error from the server, show that in the UI
        setApiResponse({ error: data.error || "Unknown error from server" });
      } else {
        // Otherwise show the success response
        setApiResponse(data);
      }
    } catch (error) {
      console.error("[TestOpenAIPage] ❌ Error calling API:", error);
      setApiResponse({ error: error.message });
    }

    setIsLoading(false);
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h1>Test OpenAI Page</h1>
      <p>Click the button below to test a single OpenAI API request (via /api/testOpenAI).</p>

      <button onClick={handleTestOpenAI} disabled={isLoading}>
        {isLoading ? "Requesting..." : "Test OpenAI"}
      </button>

      {apiResponse && (
        <div style={{ marginTop: 20 }}>
          <h2>Response</h2>
          <pre style={{ background: "#f0f0f0", padding: 10 }}>
            {JSON.stringify(apiResponse, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default TestOpenAIPage;
