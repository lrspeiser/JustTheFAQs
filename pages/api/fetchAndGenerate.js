import { exec } from "child_process";

export default function handler(req, res) {
  if (req.method === "POST") {
    console.log("[API] Received POST request to trigger fetchAndGenerate.");
    exec("node scripts/fetchAndGenerate.js", (error, stdout, stderr) => {
      if (error) {
        console.error("[API] Script execution error:", error.message);
        res.status(500).json({ message: "Failed to run the script.", error: error.message });
        return;
      }
      console.log("[API] Script standard output:", stdout);
      console.error("[API] Script standard error:", stderr);
      res.status(200).json({ message: "Script executed successfully." });
    });
  } else {
    console.warn("[API] Unsupported request method:", req.method);
    res.status(405).json({ message: "Method not allowed." });
  }
}
