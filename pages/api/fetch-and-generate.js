import { exec } from "child_process";
import path from "path";

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    console.log("[FetchAndGenerate API] Received request...");

    // Ensure `fetchAndGenerate.js` exists
    const scriptPath = path.join(process.cwd(), "scripts/fetchAndGenerate.js");

    // ✅ Extract target from request or default to 2
    const target = parseInt(req.body?.target, 10) || 2;

    if (isNaN(target) || target <= 0) {
      throw new Error(`[FetchAndGenerate API] Invalid target value: ${req.body?.target}`);
    }

    console.log(`[FetchAndGenerate API] 🚀 Starting script with target: ${target}`);

    // ✅ Run script asynchronously in a detached process
    exec(`node ${scriptPath} ${target} &`, (error, stdout, stderr) => {
      if (error) {
        console.error("[FetchAndGenerate API] ❌ Script execution failed:", error);
        return;
      }
      console.log("[FetchAndGenerate API] ✅ Script execution started:", stdout || stderr);
    });

    // ✅ Immediately return success while script runs in background
    return res.status(200).json({
      success: true,
      message: `Generation process started for ${target} pages.`,
    });

  } catch (error) {
    console.error("[FetchAndGenerate API] ❌ Error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
}
