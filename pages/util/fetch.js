// pages/util/fetch.js
import React, { useState, useRef, useEffect } from 'react';

export default function FetchAndGeneratePage() {
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const logsEndRef = useRef(null);

  // Auto scroll to bottom when new logs arrive
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const addLog = (message, type = 'info') => {
    setLogs(prev => [...prev, {
      message: typeof message === 'object' ? JSON.stringify(message, null, 2) : message,
      timestamp: new Date().toISOString(),
      type
    }]);
  };

  const handleFetchAndGenerate = async () => {
    setLoading(true);
    setLogs([]);
    setStatus('Starting the fetch and generate process...');

    try {
      const response = await fetch('/api/util/fetch-and-generate', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to start the process');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6);
              const data = JSON.parse(jsonStr);

              if (data.type === 'log') {
                addLog(data.message, data.logType || 'info');
              } else if (data.type === 'error') {
                addLog(data.message, 'error');
                setStatus(`Error: ${data.message}`);
                setLoading(false);
                break;
              } else if (data.type === 'complete') {
                addLog('Process completed', 'success');
                setStatus(data.message || 'Process completed successfully');
                setLoading(false);
                break;
              }
            }
          } catch (err) {
            console.warn('Error parsing log line:', err);
          }
        }
      }

    } catch (error) {
      console.error('[FetchAndGenerate] Error:', error);
      addLog(`Error: ${error.message}`, 'error');
      setStatus(`Error: ${error.message}`);
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4 font-sans">
      <h1 className="text-2xl font-bold mb-4">Fetch and Generate</h1>
      <p className="mb-4">Click the button below to start the fetch and generate process.</p>

      {/* Controls */}
      <button
        onClick={handleFetchAndGenerate}
        disabled={loading}
        className={`px-4 py-2 text-white bg-blue-500 rounded
          ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600'}
        `}
      >
        {loading ? 'Processing...' : 'Start Fetch and Generate'}
      </button>

      {/* Status Display */}
      {status && (
        <div className={`mt-4 ${loading ? 'text-gray-500' : 'text-black'}`}>
          {status}
        </div>
      )}

      {/* Logs Display */}
      {logs.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xl font-semibold mb-2">Process Logs</h2>
          <div className="bg-gray-900 text-gray-100 p-4 rounded-lg h-96 overflow-y-auto font-mono text-sm">
            {logs.map((log, index) => (
              <div
                key={index}
                className={`mb-1 ${
                  log.type === 'error' ? 'text-red-400' :
                  log.type === 'warning' ? 'text-yellow-400' :
                  log.type === 'success' ? 'text-green-400' :
                  'text-gray-300'
                }`}
              >
                <span className="opacity-50">
                  [{new Date(log.timestamp).toLocaleTimeString()}]
                </span>{' '}
                {log.message}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}