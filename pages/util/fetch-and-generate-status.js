// pages/api/util/fetch-and-generate-status.js
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  // Helper function to send SSE
  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Initial status
    const { count: totalCount } = await supabase
      .from('processing_queue')
      .select('*', { count: 'exact' })
      .eq('status', 'pending');

    let lastCount = totalCount;
    let noChangeCount = 0;

    // Monitor progress
    const interval = setInterval(async () => {
      try {
        const { data: queueData, error: queueError } = await supabase
          .from('processing_queue')
          .select('status, error_message')
          .order('created_at', { ascending: true });

        if (queueError) throw queueError;

        const pending = queueData.filter(item => item.status === 'pending').length;
        const completed = queueData.filter(item => item.status === 'completed').length;
        const failed = queueData.filter(item => item.status === 'failed').length;
        const processing = queueData.filter(item => item.status === 'processing').length;

        // Check for progress
        if (pending === lastCount) {
          noChangeCount++;
          if (noChangeCount > 60) { // No change for 5 minutes
            sendEvent({
              type: 'error',
              error: 'Process appears to be stalled. No progress for 5 minutes.'
            });
            clearInterval(interval);
            return res.end();
          }
        } else {
          noChangeCount = 0;
          lastCount = pending;
        }

        // Send progress update
        sendEvent({
          type: 'progress',
          progress: {
            total: queueData.length,
            completed,
            pending,
            failed,
            processing
          }
        });

        // Check for completion
        if (pending === 0 && processing === 0) {
          sendEvent({
            type: 'complete',
            message: `Process completed. ${completed} pages processed, ${failed} failed.`
          });
          clearInterval(interval);
          return res.end();
        }

        // Check for errors
        const recentErrors = queueData
          .filter(item => item.status === 'failed' && item.error_message)
          .slice(-5);

        recentErrors.forEach(error => {
          sendEvent({
            type: 'log',
            logType: 'error',
            message: `Failed to process page: ${error.error_message}`
          });
        });

      } catch (error) {
        console.error('Status monitoring error:', error);
        sendEvent({
          type: 'error',
          error: `Status monitoring failed: ${error.message}`
        });
        clearInterval(interval);
        return res.end();
      }
    }, 5000); // Check every 5 seconds

    // Cleanup on client disconnect
    res.on('close', () => {
      clearInterval(interval);
    });

  } catch (error) {
    console.error('Status initialization error:', error);
    sendEvent({
      type: 'error',
      error: `Failed to initialize status monitoring: ${error.message}`
    });
    return res.end();
  }
}