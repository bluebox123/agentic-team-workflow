import { AgentCapability } from "./types";

export const AGENT_REGISTRY: AgentCapability[] = [
    {
        id: "scraper",
        name: "Web Scraper",
        description: "Extracts content from a given URL.",
        category: "input",
        inputs: [
            { name: "url", type: "string", description: "The URL to scrape", required: true },
        ],
        outputs: [
            { name: "text", type: "string", description: "Extracted text content" },
            { name: "html", type: "string", description: "Raw HTML content" },
        ],
    },
    {
        id: "summarizer",
        name: "Text Summarizer",
        description: "Summarizes long text into a concise version.",
        category: "process",
        inputs: [
            { name: "text", type: "string", description: "Text to summarize", required: true },
            { name: "max_sentences", type: "number", description: "Max sentences in summary", required: false },
        ],
        outputs: [
            { name: "summary", type: "string", description: "The summarized text" },
            { name: "original_length", type: "number", description: "Length of original text" },
        ],
    },
    {
        id: "analyzer",
        name: "Data Analyzer",
        description: "Performs statistical analysis on numeric data.",
        category: "process",
        inputs: [
            { name: "data", type: "array", description: "Array of numbers to analyze", required: false },
            { name: "text", type: "string", description: "Text to analyze when numeric data is not available", required: false },
            { name: "analysis_type", type: "string", description: "'summary' or 'trend'", required: false },
        ],
        outputs: [
            { name: "stats", type: "json", description: "Statistical results (mean, median, etc.)" },
            { name: "insights", type: "string", description: "AI-generated insights" },
        ],
    },
    {
        id: "transformer",
        name: "Data Transformer",
        description: "Transforms data format (e.g., CSV to JSON, or simple mapping).",
        category: "process",
        inputs: [
            { name: "data", type: "any", description: "Input data", required: true },
            { name: "transform", type: "string", description: "Transformation type (uppercase, unique, ai:<instruction>)", required: true },
        ],
        outputs: [
            { name: "result", type: "any", description: "Transformed data" },
        ],
    },
    {
        id: "validator",
        name: "Data Validator",
        description: "Validates data against rules.",
        category: "process",
        inputs: [
            { name: "data", type: "json", description: "Data to validate", required: true },
            { name: "rules", type: "json", description: "Validation rules", required: true },
        ],
        outputs: [
            { name: "valid", type: "boolean", description: "Validation result" },
            { name: "errors", type: "array", description: "List of validation errors" },
        ],
    },
    {
        id: "chart",
        name: "Chart Generator",
        description: "Generates a chart image from data or text.",
        category: "output",
        inputs: [
            { name: "title", type: "string", description: "Chart title", required: false },
            { name: "type", type: "string", description: "Chart type (line, bar, scatter, area, pie, histogram)", required: false },
            { name: "text", type: "string", description: "Natural language instruction/context to infer a chart spec", required: false },
            { name: "x", type: "array", description: "X-axis data", required: false },
            { name: "y", type: "array", description: "Y-axis data", required: false },
            { name: "labels", type: "array", description: "Category labels for pie/bar charts", required: false },
            { name: "values", type: "array", description: "Category values for pie/histogram charts", required: false },
            { name: "bins", type: "number", description: "Histogram bins", required: false },
            { name: "x_label", type: "string", description: "X-axis label", required: false },
            { name: "y_label", type: "string", description: "Y-axis label", required: false },
            { name: "role", type: "string", description: "Role for report generation", required: true },
        ],
        outputs: [
            { name: "image_url", type: "string", description: "URL of generated chart image" },
            { name: "description", type: "string", description: "Brief 1-2 sentence explanation of what the chart shows" },
        ],
    },
    {
        id: "designer",
        name: "Report Designer",
        description: "Compiles a PDF report from text and artifacts.",
        category: "output",
        inputs: [
            { name: "title", type: "string", description: "Report title", required: true },
            { name: "sections", type: "array", description: "List of sections with headings and content/artifacts", required: true },
        ],
        outputs: [
            { name: "pdf_url", type: "string", description: "URL of generated PDF" },
        ],
    },
    {
        id: "executor",
        name: "General Executor",
        description: "Executes general AI tasks or database queries.",
        category: "process",
        inputs: [
            { name: "instruction", type: "string", description: "Instruction for the AI", required: true },
            { name: "context", type: "string", description: "Additional context", required: false },
        ],
        outputs: [
            { name: "result", type: "string", description: "Execution result" },
        ],
    },
    {
        id: "reviewer",
        name: "Quality Reviewer",
        description: "Reviews the output of a previous task.",
        category: "process",
        inputs: [
            { name: "target_task_id", type: "string", description: "Task ID to review", required: true },
            { name: "score_threshold", type: "number", description: "Minimum score to pass", required: false },
        ],
        outputs: [
            { name: "decision", type: "string", description: "APPROVE or REJECT" },
            { name: "score", type: "number", description: "Quality score" },
            { name: "feedback", type: "string", description: "Review feedback" },
        ],
    },
    {
        id: "notifier",
        name: "Notifier",
        description: "Sends notifications via email, Slack, or SMS.",
        category: "output",
        inputs: [
            { name: "message", type: "string", description: "Message to send", required: true },
            { name: "channel", type: "string", description: "Channel: 'email', 'slack', 'sms'", required: true },
            { name: "recipient", type: "string", description: "Recipient address/number", required: true },
        ],
        outputs: [
            { name: "status", type: "string", description: "Delivery status" },
        ],
    },
];
