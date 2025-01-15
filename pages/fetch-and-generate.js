import React, { useState } from 'react';

export default function FetchAndGeneratePage() {
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const handleFetchAndGenerate = async () => {
    setLoading(true);
    setStatus('Starting the fetch and generate process...');
    try {
      const response = await fetch('/api/fetch-and-generate', {
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
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Fetch and Generate</h1>
      <p>Click the button below to start the fetch and generate process.</p>
      <button
        onClick={handleFetchAndGenerate}
        disabled={loading}
        style={{
          padding: '10px 20px',
          fontSize: '16px',
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Processing...' : 'Start Fetch and Generate'}
      </button>
      {status && (
        <div style={{ marginTop: '20px', color: loading ? 'gray' : 'black' }}>
          {status}
        </div>
      )}
    </div>
  );
}
