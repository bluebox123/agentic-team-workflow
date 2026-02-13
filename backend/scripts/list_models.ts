
import dotenv from "dotenv";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Load .env from backend root
dotenv.config({ path: path.join(__dirname, "../.env") });

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error("No API Key found.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
    // Note: The SDK doesn't always expose listModels directly on genAI instance in all versions?
    // Let's check if we can just try a few known ones.
    // Actually, we can use the model to generate content and catch error.

    const candidates = [
        "gemini-1.5-flash",
        "gemini-pro"
    ];

    const versions = ["v1beta", "v1"];

    console.log("Testing models with different API versions...");

    for (const modelName of candidates) {
        for (const version of versions) {
            try {
                // @ts-ignore
                const model = genAI.getGenerativeModel({ model: modelName, apiVersion: version });
                await model.generateContent("Test");
                console.log(`✅ ${modelName} (${version}) is AVAILABLE`);
            } catch (error: any) {
                console.log(`❌ ${modelName} (${version}) failed:`);
                // console.log(error.message);
                if (error.response?.status) console.log(`Status: ${error.response.status} ${error.response.statusText}`);
                else console.log(error.message.split(':')[0]); // Brief error
            }
        }
    }
}

listModels();
