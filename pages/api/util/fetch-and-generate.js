import { main } from "../scripts/fetchAndGenerate";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("[fetch-and-generate] ❌ Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey); // ✅ Correctly initialize Supabase

export default async function handler(req, res) {
  console.log("[fetch-and-generate] Received request:", req.method);

  if (req.method === "POST") {
    try {
      console.log("[fetch-and-generate] ✅ Running main process...");
      await main(); // Call your main function

      res.status(200).json({ message: "FAQ generation process started successfully." });
    } catch (error) {
      console.error("[fetch-and-generate] ❌ Error:", error);
      res.status(500).json({ message: "Error processing the request", error: error.message });
    }
  } else {
    res.status(405).json({ message: "Method Not Allowed" });
  }
}