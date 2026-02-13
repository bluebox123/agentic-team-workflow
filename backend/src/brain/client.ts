import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
const pplxKey = process.env.PPLX_API_KEY;
const pplxModel = process.env.PPLX_MODEL || "sonar-pro";
const sambaNovaKey = process.env.SAMBANOVA_API_KEY;
const sambaNovaBaseUrl = process.env.SAMBANOVA_BASE_URL || "https://api.sambanova.ai/v1";
const sambaNovaModel = process.env.SAMBANOVA_MODEL || "deepseek-r1-distill-llama-70b";

if (!pplxKey && !apiKey) {
    console.warn("Neither PPLX_API_KEY nor GEMINI_API_KEY is set in environment variables.");
}

const genAI = new GoogleGenerativeAI(apiKey || "");

export async function generateContent(prompt: string): Promise<string> {
    // 1. Try Perplexity first (Primary)
    if (pplxKey) {
        // console.log("Using Perplexity API...");
        try {
            const fetch = (await import('node-fetch')).default;
            const response = await fetch("https://api.perplexity.ai/chat/completions", {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${pplxKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: pplxModel,
                    messages: [
                        { role: 'system', content: 'Be precise and concise. Return only JSON.' },
                        { role: 'user', content: prompt }
                    ]
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Perplexity error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data: any = await response.json();
            return data.choices[0].message.content;
        } catch (error: any) {
            console.error("Perplexity error:", error.message);
            // Fallthrough to next provider
        }
    }

    // 2. Try Gemini (Fallback 1)
    if (apiKey) {
        const geminiModels = ["gemini-2.5-flash-lite", "gemini-1.5-flash"];

        for (const modelName of geminiModels) {
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    const model = genAI.getGenerativeModel({ model: modelName });
                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    return response.text();
                } catch (error: any) {
                    // console.error(`Gemini error (attempt ${attempt}, model ${modelName}):`, error.message);

                    if (error.message.includes('429') || error.message.includes('quota')) {
                        break;
                    }
                    if (!error.message.includes('overloaded') && !error.message.includes('503')) {
                        break;
                    }
                    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
    }

    // 3. Fallback to SambaNova DeepSeek (Fallback 2)
    if (sambaNovaKey) {
        // console.log("Using SambaNova DeepSeek as fallback...");
        try {
            const fetch = (await import('node-fetch')).default;
            const response = await fetch(`${sambaNovaBaseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${sambaNovaKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: sambaNovaModel,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    max_tokens: 2000
                })
            });

            if (!response.ok) {
                throw new Error(`SambaNova error: ${response.status} ${response.statusText}`);
            }

            const data: any = await response.json();
            return data.choices[0].message.content;
        } catch (error: any) {
            console.error("SambaNova error:", error.message);
        }
    }

    throw new Error(`All AI providers failed`);
}
