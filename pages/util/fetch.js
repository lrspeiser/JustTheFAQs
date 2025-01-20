// pages/util/fetch.js
import React, { useState } from 'react';

export default function FetchAndGeneratePage() {
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const handleFetchAndGenerate = async () => {
    setLoading(true);
    setStatus('Starting the fetch and generate process...');

    try {
      const response = await fetch('/api/util/fetch-and-generate', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to start the fetch and generate process.');
      }

      const data = await response.json();
      setStatus(data.message || 'Fetch and generate process completed.');
    } catch (error) {
      console.error('[FetchAndGenerate] Error:', error.message);
      setStatus(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4 font-sans">
      <h1 className="text-2xl font-bold mb-4">Fetch and Generate</h1>
      <p className="mb-4">Click the button below to start the fetch and generate process.</p>

      <button
        onClick={handleFetchAndGenerate}
        disabled={loading}
        className={`px-4 py-2 text-white bg-blue-500 rounded
          ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600'}
        `}
      >
        {loading ? 'Processing...' : 'Start Fetch and Generate'}
      </button>

      {status && (
        <div className={`mt-4 ${loading ? 'text-gray-500' : 'text-black'}`}>
          {status}
        </div>
      )}
    </div>
  );
}