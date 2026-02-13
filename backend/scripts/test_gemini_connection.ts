
import dotenv from "dotenv";
import path from "path";

// Load .env from backend root
dotenv.config({ path: path.join(__dirname, "../.env") });

import { generateContent } from "../src/brain/client";

async function testConnection() {
    console.log("Testing Gemini API Connection...");
    console.log("API Key present:", !!process.env.GEMINI_API_KEY);

    try {
        const response = await generateContent("Say 'Hello World' if you can hear me.");
        console.log("Response received:");
        console.log(response);
        console.log("SUCCESS: Connection verified.");
    } catch (error: any) {
        console.error("FAILURE: Connection failed.");
        console.error("Error message:", error.message);
        // console.error("Full error:", error);
    }
}

testConnection();
