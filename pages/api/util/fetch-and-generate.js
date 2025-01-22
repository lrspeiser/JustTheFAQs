import { main } from "../scripts/fetchAndGenerate";

export default async function handler(req, res) {
  console.log("[fetch-and-generate] Received request:", req.method);

  if (req.method === "POST") {
    try {
      console.log("[fetch-and-generate] Queuing task...");

      // Save request in Supabase for later processing
      const { data, error } = await supabase
        .from("processing_queue")
        .insert([{ status: "pending", created_at: new Date().toISOString() }]);

      if (error) {
        throw new Error("Failed to queue the request: " + error.message);
      }

      console.log("[fetch-and-generate] Task queued successfully.");
      res.status(202).json({ message: "Process queued successfully." });

      // Run processing asynchronously (won't block response)
      main();
    } catch (error) {
      console.error("[fetch-and-generate] Error:", error);
      res.status(500).json({ message: "Error queuing the process", error: error.message });
    }
  } else {
    res.status(405).json({ message: "Method Not Allowed" });
  }
}
