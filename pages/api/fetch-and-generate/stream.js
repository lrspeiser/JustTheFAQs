import React, { useState, useRef, useEffect } from 'react';

export default function LogDisplay() {
  const [logs, setLogs] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const logEndRef = useRef(null);
  const eventSourceRef = useRef(null);

  const scrollToBottom = () => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  // Cleanup function for EventSource
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const startGeneration = async () => {
    setIsGenerating(true);
    setLogs([]); // Clear previous logs

    try {
      // First make the initial POST request
      const response = await fetch('/api/fetch-and-generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ target: 2 }),
      });

      if (!response.ok) {
        throw new Error('Failed to start generation process');
      }

      // Close any existing EventSource
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      // Then set up event source
      const es = new EventSource('/api/fetch-and-generate/stream');
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.complete) {
            setIsGenerating(false);
            es.close();
            setLogs(prev => [...prev, "Process completed successfully"]);
          } else if (data.error) {
            setIsGenerating(false);
            es.close();
            setLogs(prev => [...prev, `Error: ${data.error}`]);
          } else if (data.message) {
            setLogs(prev => [...prev, data.message]);
          }
        } catch (e) {
          console.error('Error parsing message:', e);
        }
      };

      es.onerror = (error) => {
        console.error('EventSource error:', error);
        setLogs(prev => [...prev, "Connection error occurred. Please try again."]);
        setIsGenerating(false);
        es.close();
      };

      // Add event listener for when connection opens
      es.onopen = () => {
        setLogs(prev => [...prev, "Connection established. Starting generation..."]);
      };

    } catch (error) {
      setIsGenerating(false);
      setLogs(prev => [...prev, `Error: ${error.message}`]);
    }
  };

  return (
    <div className="log-display">
      <button 
        onClick={startGeneration} 
        disabled={isGenerating}
        className="generate-button"
      >
        {isGenerating ? 'Generating...' : 'Generate FAQs'}
      </button>

      <div className="logs-container">
        {logs.map((log, index) => (
          <div key={index} className="log-line">
            {log}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}