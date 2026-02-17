# Hosted demo (Vercel)

https://agentic-team-workflow.vercel.app/

# AI Workflow System

An intelligent multi-agent orchestration platform that transforms natural language prompts into executable workflows. It plans and executes a task DAG (Directed Acyclic Graph) using specialized agents to scrape, analyze, visualize, and produce reports.

---

## What this project does

The AI Workflow System is a distributed, multi-agent orchestration platform that:

- Intelligent planning: Breaks down complex user requests into executable task DAGs
- Multi-agent coordination: Specialized agents (scraper, analyzer, chart, designer, notifier, etc.) work together
- Artifact generation: Produces charts, analysis outputs, and PDF reports
- Delivery: Can email the final report to recipients
- Real-time monitoring: WebSocket updates on job and task status

---

## Quick start (hosted demo)

### Step 1: Open the app
Open: https://agentic-team-workflow.vercel.app/

### Step 2: Enter the demo JWT token
To access the testing environment, enter this JWT token when prompted:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1NTBlODQwMC1lMjliLTQxZDQtYTcxNi00NDY2NTU0NDAwMDAiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJvcmdJZCI6IjU1MGU4NDAwLWUyOWItNDFkNC1hNzE2LTQ0NjY1NTQ0MDAwMSJ9.XyR-6kncAxX1KkiYsdQKahNyRtHUCNZig4jZ6CQtElg
```

### Step 3: Run a sample prompt
Copy any of the **8 sample prompts** below (replace `<your gmail>` with your actual Gmail address).

---

## 8 sample prompts for testing

These prompts are designed to trigger **4-6 agents** working together, producing downloadable artifacts and email notifications.

### Prompt 1 — Website → Summary → Insights → PDF Report → Email
**Agents:** `scraper` + `summarizer` + `analyzer` + `designer` + `notifier`

```
Scrape this page: https://en.wikipedia.org/wiki/Taj_Mahal

Then:
1) Summarize the scraped text in ~180 words.
2) Analyze the same text and extract 8 key insights + 5 key facts.
3) Create a PDF report (title: "Taj Mahal Briefing") with sections:
   - Executive Summary (the summary)
   - Key Insights (bullet list)
   - Key Facts (table)
   - Source URL + scrape timestamp
4) Email the final PDF report to: <your gmail>
Use notifier channel=email, subject="Taj Mahal Briefing (PDF)".
```

### Prompt 2 — Validate + Transform Data → Chart → Report → Notify
**Agents:** `validator` + `transformer` + `analyzer` + `chart` + `designer` + `notifier`

```
Here is sales data (USD):
[
  {"month":"Jan","sales":12000},
  {"month":"Feb","sales":18000},
  {"month":"Mar","sales":15000},
  {"month":"Apr","sales":22000},
  {"month":"May","sales":21000},
  {"month":"Jun","sales":26000}
]

Workflow:
1) Validate the data against a schema: month=string, sales=number, required fields only.
2) Transform it to add: "mom_change" (month-over-month % change)
3) Analyze: identify best month, worst month, average sales, and trend statement.
4) Create a line chart of sales by month (title "Monthly Sales").
5) Generate a PDF report with: data quality, transformed table, analysis insights, embedded chart.
6) Email the PDF to <your gmail> with subject "Sales report + chart".
```

### Prompt 3 — Two Pages Comparison Report + Email
**Agents:** `scraper` + `summarizer` + `analyzer` + `transformer` + `designer` + `notifier`

```
Scrape and compare these two pages:
A) https://en.wikipedia.org/wiki/Artificial_intelligence
B) https://en.wikipedia.org/wiki/Machine_learning

For each page:
- Summarize in 120 words.

Then:
- Analyze differences: give a comparison matrix (scope, goals, typical methods, examples).
- Transform the comparison into a clean JSON object AND a human-readable table.

Finally:
- Create a PDF report titled "AI vs ML: Comparison" including both summaries, the matrix/table, and the JSON.
- Email the report to <your gmail> subject="AI vs ML comparison PDF".
```

### Prompt 4 — Data Cleanup Pipeline
**Agents:** `validator` + `transformer` + `validator` + `chart` + `designer` + `notifier`

```
Dataset (note: messy types):
[
  {"name":"A","score":"10"},
  {"name":"B","score":"15"},
  {"name":"C","score":null},
  {"name":"D","score":"not_available"},
  {"name":"E","score":"25"}
]

Pipeline:
1) Validate against schema (name string, score number nullable) and report errors.
2) Transform: coerce numeric strings to numbers, replace null/"not_available" with 0.
3) Re-validate the cleaned data.
4) Create a bar chart for cleaned scores (title "Cleaned Scores").
5) Create a PDF report: validation errors, cleaned dataset, validation results, embedded chart.
6) Email PDF to <your gmail> subject "Data cleanup report".
```

### Prompt 5 — Research Digest with Chart
**Agents:** `scraper` + `summarizer` + `analyzer` + `transformer` + `chart` + `designer` + `notifier`

```
Scrape: https://en.wikipedia.org/wiki/Climate_change

Then:
1) Summarize in 200 words.
2) Analyze and extract 10 key claims and categorize each as: "cause", "impact", "mitigation", "evidence".
3) Transform the categorized claims into counts per category.
4) Create a pie chart of category distribution (title "Claim Categories").
5) Produce a PDF report: summary, categorized claims list, counts table, pie chart.
6) Email the final PDF to <your gmail> subject "Climate Change Digest PDF".
```

### Prompt 6 — Simple One-Pager + PDF Attachment
**Agents:** `scraper` + `summarizer` + `designer` + `notifier` (+ `analyzer`)

```
Scrape https://en.wikipedia.org/wiki/India

1) Summarize in 150 words.
2) Create a PDF report titled "India One-Pager" containing: summary, 8 bullet facts, source URL.
3) After the PDF is generated, send an email to <your gmail> with:
   - subject "India One-Pager PDF"
   - message "Attached is the generated PDF report."
Make sure notifier sends the PDF as an attachment.
```

### Prompt 7 — JSON Spec Validation and Reporting
**Agents:** `validator` + `transformer` + `analyzer` + `designer` + `notifier`

```
You are given this JSON:
{
  "project":"AI Workflow",
  "tasks":[
    {"id":"scrape","agentType":"scraper"},
    {"id":"analyze","agentType":"analyzer"},
    {"id":"report","agentType":"designer"}
  ]
}

1) Validate it against schema: project=string, tasks=array of {id, agentType} with ≥3 items.
2) Transform to add "taskCount" field and agentType frequencies.
3) Analyze: identify missing recommended agents (e.g., notifier) and propose improvements.
4) Generate a PDF report with: validation outcome, transformed JSON, recommendations.
5) Email the PDF to <your gmail> subject "Workflow JSON validation report".
```

### Prompt 8 — End-to-End KPI Report
**Agents:** `analyzer` + `transformer` + `chart` + `designer` + `notifier` (+ `validator`)

```
Use this KPI dataset:
[
  {"day":"Mon","signups":30,"active":120},
  {"day":"Tue","signups":45,"active":135},
  {"day":"Wed","signups":40,"active":128},
  {"day":"Thu","signups":60,"active":150},
  {"day":"Fri","signups":55,"active":155},
  {"day":"Sat","signups":25,"active":110},
  {"day":"Sun","signups":20,"active":100}
]

1) Analyze: compute totals, averages, best/worst day for signups, correlation note.
2) Transform: add "conversionProxy" = signups/active for each day.
3) Create combo visualization (line for active, bar for signups).
4) Create PDF report "Weekly KPI Report" with insights, table, and chart(s).
5) Email PDF to <your gmail> subject "Weekly KPI Report (PDF)".
```

---

## Architecture

### High-Level Flow

```
User Prompt → Brain/Planner (LLM) → Workflow DAG → Orchestrator → RabbitMQ → Python Worker → Artifacts
                                                              ↓
                                                        PostgreSQL (State)
                                                              ↓
                                                        MinIO/S3 (Storage)
                                                              ↓
                                                        Gmail/SendGrid (Email)
```

### Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Frontend** | React + Vite + TypeScript | Brain Panel UI, Workflow visualizer, Real-time monitoring |
| **Backend** | Express.js + TypeScript | Brain/Planner, Orchestrator, Template Resolver |
| **Python Worker** | Python (Railway) | Agent implementations, Artifact generation |
| **Database** | PostgreSQL (Supabase) | Jobs, Tasks, Artifacts |
| **Queue** | RabbitMQ (CloudAMQP) | Task distribution |
| **Storage** | MinIO/S3 (Supabase) | Charts, PDFs, JSON artifacts |
| **Email** | Gmail SMTP + SendGrid | Notifications with PDF attachments |

---

## Available Agents

| Agent | Input | Output | Description |
|-------|-------|--------|-------------|
| `scraper` | `url`, `selector?` | `text`, `html`, `metadata` | Extracts web page content |
| `summarizer` | `text` | `summary` | Condenses long text |
| `analyzer` | `text`, `data` | `insights`, `stats` | Generates analytical insights |
| `transformer` | `data`, `operation` | `result` | Transforms data formats |
| `validator` | `data`, `schema` | `valid`, `errors` | Validates data against schema |
| `chart` | `data`, `type`, `title` | `chart_url`, `description` | Creates data visualizations |
| `designer` | `sections[]`, `artifacts[]` | `report_url` (PDF) | Generates PDF reports |
| `notifier` | `message`, `channel`, `recipients` | `status`, `sent` | Sends email notifications |

---

## How to Use

### Using the Live Demo

1. **Navigate to the app**: https://agentic-team-workflow.vercel.app/

2. **Enter the JWT token** (copy-paste exactly):
   ```
   eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1NTBlODQwMC1lMjliLTQxZDQtYTcxNi00NDY2NTU0NDAwMDAiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJvcmdJZCI6IjU1MGU4NDAwLWUyOWItNDFkNC1hNzE2LTQ0NjY1NTQ0MDAwMSJ9.XyR-6kncAxX1KkiYsdQKahNyRtHUCNZig4jZ6CQtElg
   ```

3. **Submit a prompt**:
   - Go to the **Brain Panel**
   - Paste one of the 8 sample prompts above
   - Replace `<your gmail>` with your actual Gmail address
   - Click **Execute**

4. **Monitor progress**:
   - Watch the **Workflow DAG** visualization
   - See real-time task status updates via WebSocket
   - Each agent completes and passes data to the next

5. **Download results**:
   - PDF reports appear in the artifacts panel
   - Check your email for the final report attachment

---

## Email Notification Setup

The `notifier` agent sends emails via **Gmail SMTP** (with SendGrid fallback for cloud hosting):

### Required Environment Variables (Worker)
```env
GMAIL_USER=your.email@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx  # Gmail App Password (not your login password)
SENDGRID_API_KEY=SG.xxxx  # Optional: for HTTP fallback
EMAIL_PROVIDER=auto  # Options: auto, smtp, http
```

**Note:** For Gmail, use an [App Password](https://myaccount.google.com/apppasswords), not your regular password.

---

## Local Development (Optional)

### Prerequisites
- Node.js 18+
- Python 3.9+
- PostgreSQL
- RabbitMQ

### Backend Setup
```bash
cd ai-workflow/backend
npm install
npm run dev
```

### Python Worker Setup
```bash
cd ai-workflow/workers/python_worker
pip install -r requirements.txt
python worker.py
```

### Frontend Setup
```bash
cd ai-workflow/frontend
npm install
npm run dev
```

---

## Features

- **Natural language to workflow**: Describe what you want
- **Multi-agent orchestration**: Agents pass data between tasks
- **Template system**: `{{tasks.X.outputs.Y}}` for dynamic data passing
- **Artifact generation**: Charts, PDFs, structured JSON
- **Email delivery**: Reports delivered to your inbox (if configured)
- **Real-time updates**: Live progress tracking via WebSocket
- **Fault tolerance**: Retry logic and dead letter queues
- **Visual workflow**: DAG visualization in the UI

---

## Template Syntax

Agents pass data using template placeholders:

```
{{tasks.scrape.outputs.text}}
{{tasks.analyze.outputs.insights}}
{{tasks.chart.outputs.chart_url}}
{{tasks.designer.outputs.report_url}}
```

The orchestrator automatically resolves these before enqueuing dependent tasks.

---

## Security Notes

- JWT token provided is for **demo/testing purposes only**
- Gmail App Passwords are required (not regular passwords)
- API keys should never be committed to Git
- Railway/Supabase environment variables keep secrets secure

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Email not received | Check Gmail App Password is correct; verify not in spam |
| Tasks stuck in QUEUED | Check RabbitMQ connection and Python Worker logs |
| PDF not generating | Verify MinIO/S3 credentials and bucket permissions |
| Template not resolving | Ensure referenced tasks completed with SUCCESS status |

---

## License

MIT License - Feel free to use, modify, and distribute.

---

## Acknowledgments

- Built with **Gemini**, **Perplexity**, and **SambaNova** AI APIs
- Hosted on **Vercel** (frontend) + **Railway** (backend/worker)
- Database & storage: **Supabase**
- Message queue: **CloudAMQP**

---

Try it now: https://agentic-team-workflow.vercel.app/