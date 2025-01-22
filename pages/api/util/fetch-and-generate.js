import { main } from "../scripts/fetchAndGenerate";

export default async function handler(req, res) {
  console.log("[fetch-and-generate] Received request:", req.method);

  if (req.method === "POST") {
    try {
      console.log("[fetch-and-generate] Starting main processing...");
      await main();  // Run the process

      console.log("[fetch-and-generate] Process successfully started.");
      res.status(200).json({ message: "Process started successfully." });
    } catch (error) {
      console.error("[fetch-and-generate] Error:", error);
      res.status(500).json({ message: "Error starting the process", error: error.message });
    }
  } else {
    console.log("[fetch-and-generate] Invalid request method:", req.method);
    res.status(405).json({ message: "Method Not Allowed" });
  }
}
