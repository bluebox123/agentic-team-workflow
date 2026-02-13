
import { substitute } from "../src/templateUtils";

console.log("Testing Template Substitution Logic...");

const context = {
    tasks: {
        "scraper": {
            outputs: {
                text: "Scraped Content",
                count: 100
            }
        },
        "deeply": {
            outputs: {
                nested: {
                    value: "Found me"
                }
            }
        }
    },
    parent: {
        outputs: {
            result: "Parent Result"
        }
    }
};

const payload = {
    "direct": "{{tasks.scraper.outputs.text}}",
    "number": "{{tasks.scraper.outputs.count}}",
    "parent": "{{parent.outputs.result}}",
    "nested": "{{tasks.deeply.outputs.nested.value}}",
    "missing": "{{tasks.unknown.outputs.field}}",
    "static": "static value",
    "array": ["{{tasks.scraper.outputs.text}}", "static"]
};

const result = substitute(payload, context);

console.log("Result:", JSON.stringify(result, null, 2));

if (result.direct !== "Scraped Content") throw new Error("Direct substitution failed");
if (result.number !== "100") throw new Error("Number substitution failed");
if (result.parent !== "Parent Result") throw new Error("Parent substitution failed");
if (result.nested !== "Found me") throw new Error("Nested substitution failed");
if (result.missing !== "{{tasks.unknown.outputs.field}}") throw new Error("Missing substitution failed (should keep placeholder)");
if (result.array[0] !== "Scraped Content") throw new Error("Array substitution failed");

console.log("Substitution Verification SUCCESS!");
