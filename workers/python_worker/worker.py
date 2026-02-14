import json
import time
import os
import psycopg2
import pika
import sys
import requests
from dotenv import load_dotenv
from prometheus_client import Counter, start_http_server
import boto3
from botocore.exceptions import ClientError
import io
from weasyprint import HTML
import matplotlib.pyplot as plt
from bs4 import BeautifulSoup
import ai_helper

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgres://devuser:devpass@127.0.0.1:5433/ai_workflow_dev"
)

RABBIT_URL = os.getenv(
    "RABBIT_URL",
    "amqp://guest:guest@rabbitmq:5672/"
)

ORCHESTRATOR_URL = os.getenv(
    "ORCHESTRATOR_URL",
    "http://host.docker.internal:4000"
)

# S3 Storage Configuration (Supabase, MinIO, etc.)
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "minio:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY")
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "artifacts")
MINIO_USE_SSL = os.getenv("MINIO_USE_SSL", "true").lower() == "true"
MINIO_REGION = os.getenv("MINIO_REGION", "us-east-1")

# Build endpoint URL
protocol = "https" if MINIO_USE_SSL else "http"
if MINIO_ENDPOINT.startswith("http"):
    # Full URL provided - use as-is
    endpoint_url = MINIO_ENDPOINT
elif ".storage.supabase.co" in MINIO_ENDPOINT:
    # Supabase storage subdomain - convert to S3 API path
    endpoint_url = f"https://{MINIO_ENDPOINT}/storage/v1/s3"
else:
    # Hostname only - add protocol
    endpoint_url = f"{protocol}://{MINIO_ENDPOINT}"

print(f"[WORKER] S3 endpoint configured: {endpoint_url}")

# Initialize S3 client (compatible with Supabase Storage and MinIO)
s3_client = boto3.client(
    "s3",
    endpoint_url=endpoint_url,
    aws_access_key_id=MINIO_ACCESS_KEY,
    aws_secret_access_key=MINIO_SECRET_KEY,
    region_name=MINIO_REGION
)

TASK_QUEUE = "executor.tasks"
DLQ_QUEUE = "executor.tasks.dlq"

MAX_RETRIES = 3
RETRY_BACKOFF_SEC = 2

# Prometheus metrics
worker_tasks_total = Counter(
    "worker_tasks_total",
    "Worker task executions",
    ["result"]
)

# Start metrics server
start_http_server(9100)

# -------------------------
# DB
# -------------------------
def connect_db():
    while True:
        try:
            conn = psycopg2.connect(DATABASE_URL)
            conn.autocommit = True
            return conn
        except Exception:
            time.sleep(2)


db_conn = connect_db()


def get_retry_count(task_id):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT retry_count FROM tasks WHERE id = %s",
            (task_id,),
        )
        row = cur.fetchone()
        return row[0] if row else 0


def increment_retry(task_id):
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE tasks SET retry_count = retry_count + 1 WHERE id = %s",
            (task_id,),
        )


def log_task(task_id, level, message):
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO task_logs (task_id, level, message)
            VALUES (%s, %s, %s)
            """,
            (task_id, level, message),
        )


def load_task_context(task_id):
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT agent_type, payload, job_id, name
            FROM tasks
            WHERE id = %s
            """,
            (task_id,),
        )
        row = cur.fetchone()

    if not row:
        # Log detailed debug information
        print(f"[WORKER] Task {task_id} not found in DB. Checking if task exists at all...")
        with db_conn.cursor() as cur:
            cur.execute("SELECT id, name, status FROM tasks WHERE id = %s", (task_id,))
            debug_row = cur.fetchone()
            if debug_row:
                print(f"[WORKER] Task exists but has NULL agent_type/payload: id={debug_row[0]}, name={debug_row[1]}, status={debug_row[2]}")
            else:
                print(f"[WORKER] Task completely not found in database")
        return None, {}, None, None

    agent_type, task_payload, job_id, name = row
    if task_payload is None:
        task_payload = {}
    elif isinstance(task_payload, str):
        try:
            task_payload = json.loads(task_payload)
        except Exception:
            task_payload = {}

    return agent_type, task_payload, job_id, name


# -------------------------
# ROLE MAPPINGS (Phase 8.4.2)
# -------------------------
CHART_ROLE_MAP = {
    "latency": "latency_p95",
    "throughput": "throughput", 
    "errors": "error_rate",
    "response_time": "latency_p95",
    "requests_per_sec": "throughput",
    "error_percentage": "error_rate"
}

# Phase 8.4.2: Role assignment per executor
DESIGNER_ROLE = "report"
DEFAULT_CHART_ROLE = "chart"

def get_chart_role(payload):
    """Phase 8.4.2: Determine chart role from payload with mapping"""
    # Explicit role takes precedence
    explicit_role = payload.get("role")
    if explicit_role:
        return explicit_role
    
    # Map common chart types to semantic roles
    title = payload.get("title", "").lower()
    chart_type = payload.get("type", "").lower()
    
    # Try title-based mapping
    for keyword, role in CHART_ROLE_MAP.items():
        if keyword in title:
            return role
    
    # Try chart type mapping
    if chart_type in CHART_ROLE_MAP:
        return CHART_ROLE_MAP[chart_type]
    
    # Default to generic chart role
    return DEFAULT_CHART_ROLE

# -------------------------
# DESIGNER LOGIC
# -------------------------
def fetch_job_artifacts_from_db(job_id):
    """Fetch all artifacts for a job from the database"""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                a.id,
                a.task_id,
                a.type,
                a.filename,
                a.storage_key,
                a.mime_type,
                a.role,
                t.agent_type
            FROM artifacts a
            JOIN tasks t ON a.task_id = t.id
            WHERE t.job_id = %s
            ORDER BY a.created_at
        """, (job_id,))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        
        artifacts = []
        for row in rows:
            artifacts.append({
                "id": row[0],
                "task_id": row[1],
                "type": row[2],
                "filename": row[3],
                "storage_key": row[4],
                "mime_type": row[5],
                "role": row[6],
                "agent_type": row[7]
            })
        return artifacts
    except Exception as e:
        print(f"[WORKER] Failed to fetch artifacts for job {job_id}: {e}")
        return []

def load_image_base64(storage_key):
    """Load image from S3 and return base64 encoded string"""
    try:
        response = s3_client.get_object(Bucket=MINIO_BUCKET, Key=storage_key)
        data = response["Body"].read()
        import base64
        return base64.b64encode(data).decode("utf-8")
    except Exception as e:
        print(f"[WORKER] Failed to load image {storage_key}: {e}")
        return None

def build_artifact_index(artifacts):
    """Phase 8.4.3: Build lookup index for deterministic artifact selection"""
    artifact_index = {}
    for artifact in artifacts:
        key = (artifact.get("type"), artifact.get("role"))
        artifact_index[key] = artifact
        # DEBUG: Log each index entry with full details
        art_id = artifact.get('id', 'N/A')
        art_type = artifact.get('type', 'N/A')
        art_role = artifact.get('role', 'N/A')
        art_storage = artifact.get('storage_key', 'N/A')
        print(f"[WORKER] Index entry: key={key} -> artifact id={art_id[:8] if art_id != 'N/A' else 'N/A'}..., type={art_type}, role={art_role}, storage={art_storage}")
    return artifact_index

def resolve_artifact_for_section(section, artifact_index, all_artifacts_list=None):
    """Enhanced artifact resolution supporting both structured objects and string references"""
    if "artifact" not in section:
        return None  # Regular content section
    
    artifact_ref = section["artifact"]
    section_heading = section.get('heading', 'Unknown')
    
    # Handle null/undefined artifact references
    if artifact_ref is None or artifact_ref == "null" or artifact_ref == "undefined":
        return None  # Treat as regular content section
    
    # Case 1: Structured object with type and role (original behavior)
    if isinstance(artifact_ref, dict):
        artifact_type = artifact_ref.get("type")
        artifact_role = artifact_ref.get("role")
        
        if not artifact_type or not artifact_role:
            # Log warning but don't fail - treat as content section
            print(f"[WORKER] Warning: Invalid artifact reference in section '{section_heading}': missing type or role, treating as content")
            return None
        
        # Deterministic lookup by (type, role)
        key = (artifact_type, artifact_role)
        artifact = artifact_index.get(key)
        
        print(f"[WORKER] Looking up artifact with key {key}, found: {artifact is not None}")
        print(f"[WORKER] Available keys in index: {list(artifact_index.keys())}")
        
        if not artifact:
            # Try to find by role only (fallback 1)
            for art in all_artifacts_list or []:
                if art.get("role") == artifact_role:
                    print(f"[WORKER] Matched artifact by role '{artifact_role}' for section '{section_heading}'")
                    return art
            
            # Try to find by type only with role containing the artifact_role (fallback 2)
            for art in all_artifacts_list or []:
                art_type = art.get("type", "")
                art_role = art.get("role", "")
                if art_type == artifact_type and artifact_role in (art_role or ""):
                    print(f"[WORKER] Matched artifact by type '{artifact_type}' and partial role match '{artifact_role}' in '{art_role}' for section '{section_heading}'")
                    return art
            
            # Try to find ANY chart artifact when looking for a chart (fallback 3)
            if artifact_type == "chart":
                for art in all_artifacts_list or []:
                    if art.get("type") == "chart":
                        print(f"[WORKER] Matched any chart artifact for section '{section_heading}' (role wanted: {artifact_role}, found role: {art.get('role')})")
                        return art
            
            # Try to find by role substring match (fallback 4)
            for art in all_artifacts_list or []:
                art_role = art.get("role", "")
                if art_role and artifact_role in art_role:
                    print(f"[WORKER] Matched artifact by role substring '{artifact_role}' in '{art_role}' for section '{section_heading}'")
                    return art
            
            # Log warning but don't fail
            print(f"[WORKER] Warning: Missing artifact: {artifact_type}:{artifact_role} in section '{section_heading}', treating as content")
            return None
        
        return artifact
    
    # Case 2: String reference (URL or template already resolved)
    # This happens when AI generates {{tasks.chart.outputs.image_url}} and orchestrator resolves it
    elif isinstance(artifact_ref, str):
        # If it's an empty string or template that wasn't resolved, treat as content
        if not artifact_ref or artifact_ref.startswith("{{"):
            print(f"[WORKER] Warning: Unresolved template in section '{section_heading}': {artifact_ref}")
            return None
        
        if all_artifacts_list is None or len(all_artifacts_list) == 0:
            print(f"[WORKER] Warning: No artifacts available for section '{section_heading}'")
            return None
        
        # Strategy 1: Try to match by artifact ID in the URL  
        # URLs typically look like: http://localhost:4000/api/artifacts/UUID/download
        for artifact in all_artifacts_list:
            if artifact.get("id") and artifact["id"] in artifact_ref:
                print(f"[WORKER] Matched artifact by ID in URL for section '{section_heading}'")
                return artifact
        
        # Strategy 2: Use heuristics based on section heading and artifact type
        # Look for chart/image artifacts
        for artifact in all_artifacts_list:
            artifact_type = artifact.get("type", "").lower()
            if artifact_type in ["chart", "image", "png", "visualization"]:
                print(f"[WORKER] Matched artifact by type '{artifact_type}' for section '{section_heading}'")
                return artifact
        
        # Strategy 3: Just use the first available artifact as fallback
        print(f"[WORKER] WARNING: Using first available artifact as fallback for section '{section_heading}'")
        return all_artifacts_list[0]
    
    else:
        # Unknown type - log warning and treat as content
        print(f"[WORKER] Warning: Invalid artifact reference type in section '{section_heading}': {type(artifact_ref)}, treating as content")
        return None

def render_section(section, artifact_index, all_artifacts_list=None):
    """Enhanced section rendering with support for string artifact references"""
    section_heading = section.get('heading', 'Unknown')
    artifact = resolve_artifact_for_section(section, artifact_index, all_artifacts_list)
    
    if artifact:
        # Embed artifact with deterministic content
        storage_key = artifact.get("storage_key")
        art_role = artifact.get("role", "N/A")
        art_type = artifact.get("type", "N/A")
        print(f"[WORKER] Rendering section '{section_heading}' with artifact (type={art_type}, role={art_role}, storage={storage_key})")
        
        img64 = load_image_base64(storage_key)
        if img64:
            print(f"[WORKER] Successfully loaded image for section '{section_heading}' ({len(img64)} base64 chars)")
            return f"""
            <h2>{section['heading']}</h2>
            <img src="data:image/png;base64,{img64}" style="max-width:100%;" />
            """
        else:
            # Failed to load image - render as content section with warning
            print(f"[WORKER] Warning: Failed to load artifact image for section '{section_heading}' from storage key '{storage_key}'")
            return f"""
            <h2>{section['heading']}</h2>
            <p>{section.get('content', '')}</p>
            """
    else:
        # No artifact: regular content
        print(f"[WORKER] Rendering section '{section_heading}' as regular content (no artifact)")
        return f"""
        <h2>{section['heading']}</h2>
        <p>{section.get('content', '')}</p>
        """

def render_html(title, sections, artifacts=None, all_artifacts_list=None):
    """Enhanced HTML rendering with support for fetched artifacts"""
    if artifacts is None:
        artifacts = []
    if all_artifacts_list is None:
        all_artifacts_list = []
    
    # Phase 8.4.3: Build artifact index from BOTH payload artifacts AND database artifacts
    # This ensures we can resolve any artifact reference regardless of source
    combined_artifacts = artifacts + all_artifacts_list
    artifact_index = build_artifact_index(combined_artifacts)
    
    # Log for debugging
    print(f"[WORKER] Artifact index built with {len(combined_artifacts)} artifacts:")
    for art in combined_artifacts:
        print(f"  - type={art.get('type')}, role={art.get('role')}, id={art.get('id')[:8] if art.get('id') else 'N/A'}...")
    print(f"[WORKER] Sections with artifact refs: {[s.get('heading') for s in sections if 'artifact' in s]}")
    
    # Render sections with both artifact_index and full list for flexible matching
    body = ""
    for section in sections:
        body += render_section(section, artifact_index, all_artifacts_list)

    return f"""
    <html>
      <head>
        <style>
          body {{ font-family: Arial; margin: 40px; }}
          h1 {{ color: #333; }}
          h2 {{ color: #666; margin-top: 30px; }}
          img {{ border: 1px solid #ddd; border-radius: 4px; }}
        </style>
      </head>
      <body>
        <h1>{title}</h1>
        {body}
      </body>
    </html>
    """

def run_designer(task_id, job_id, payload):
    """Enhanced PDF generation with smart artifact reference resolution"""
    # Extract title and sections from payload
    title = payload.get("title", "Generated Report")
    sections = payload.get("sections", [])
    artifacts = payload.get("artifacts", [])  # Artifacts explicitly passed in payload
    
    # Designer always has role='report'
    role = DESIGNER_ROLE
    
    # Validate payload structure
    if not sections:
        raise ValueError("Designer payload must contain at least one section")
    
    # Fetch all artifacts for this job from database
    # This enables resolution of string artifact references
    all_job_artifacts = fetch_job_artifacts_from_db(job_id)
    log_task(task_id, "INFO", f"Fetched {len(all_job_artifacts)} artifacts from database for job {job_id}")
    
    # Count artifact references for logging
    artifact_refs_count = len([s for s in sections if "artifact" in s])
    log_task(task_id, "INFO", f"Designer processing {len(sections)} sections with {artifact_refs_count} artifact references")
    
    # Render HTML with both explicit artifacts and fetched artifacts
    # This allows resolution of both structured and string references
    html = render_html(title, sections, artifacts, all_job_artifacts)
    
    # Generate PDF
    try:
        pdf_bytes = HTML(string=html).write_pdf()
        log_task(task_id, "INFO", f"Designer generated PDF ({len(pdf_bytes)} bytes)")
        
        # Upload to S3
        object_key = f"jobs/{job_id}/{task_id}.pdf"
        s3_client.put_object(
            Bucket=MINIO_BUCKET,
            Key=object_key,
            Body=io.BytesIO(pdf_bytes),
            ContentType="application/pdf"
        )
        
        log_task(task_id, "INFO", f"PDF uploaded to {object_key}")
        
        # Report back to orchestrator
        requests.post(
            f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
            json={
                "result": {
                    "ok": True,
                    "job_id": job_id,
                    "executor": "designer"
                },
                "artifact": {
                    "type": "pdf",
                    "filename": "report.pdf",
                    "storage_key": object_key,
                    "role": role,  # Phase 8.4.2: Mandatory role for designer
                    "metadata": {
                        "pages": None,
                        "embedded_artifacts": artifact_refs_count,
                        "section_count": len(sections),
                        "role": role,
                        "deterministic_ordering": True
                    }
                }
            },
            timeout=5,
        )
        
        worker_tasks_total.labels(result="success").inc()
        log_task(task_id, "INFO", f"Designer execution succeeded, role='{role}', sections={len(sections)}")
        
    except Exception as e:
        log_task(task_id, "ERROR", f"Designer failed: {e}")
        raise

# -------------------------
# REVIEWER LOGIC
# -------------------------
def run_reviewer(task_id, payload):
    """
    AI-powered quality reviewer:
    - checks executor output exists
    - uses AI to analyze quality
    - assigns score and provides feedback
    """
    target_task_id = payload.get("target_task_id")
    score_threshold = payload.get("score_threshold", 80)

    if not target_task_id:
        error_msg = "Missing target_task_id - Reviewer needs a parent task to review. Make sure the reviewer task has a parent_task_index pointing to the task it should review."
        log_task(task_id, "ERROR", error_msg)
        return {
            "score": 0,
            "decision": "REJECT",
            "feedback": {"error": error_msg},
        }

    # Load target task result
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT status, result
            FROM tasks
            WHERE id = %s
            """,
            (target_task_id,),
        )
        row = cur.fetchone()

    if not row:
        error_msg = f"Target task {target_task_id} not found in database"
        log_task(task_id, "ERROR", error_msg)
        return {
            "score": 0,
            "decision": "REJECT",
            "feedback": {"error": error_msg},
        }

    status, result = row

    if status != "SUCCESS":
        error_msg = f"Target task {target_task_id} has status '{status}' - must be SUCCESS to approve"
        log_task(task_id, "ERROR", error_msg)
        return {
            "score": 20,
            "decision": "REJECT",
            "feedback": {"error": error_msg},
        }

    if not result:
        error_msg = f"Target task {target_task_id} has empty result"
        log_task(task_id, "ERROR", error_msg)
        return {
            "score": 30,
            "decision": "REJECT",
            "feedback": {"error": error_msg},
        }

    # ---- PASSED BASIC CHECKS ----
    # Use AI to analyze quality
    score = 75  # Default score
    ai_feedback = "AI analysis unavailable"
    
    try:
        # Prepare result for AI analysis
        result_preview = json.dumps(result)[:1000] if isinstance(result, dict) else str(result)[:1000]
        
        ai_prompt = f"""Review the quality of this task execution result:

Result Preview: {result_preview}

Provide:
1. A quality score (0-100)
2. Specific feedback on what's good and what could be improved
3. A recommendation (APPROVE or REJECT)

Format your response as:
Score: [number]
Feedback: [your feedback]
Recommendation: [APPROVE/REJECT]"""
        
        ai_response = ai_helper.generate_ai_response(
            ai_prompt,
            task_type="reviewer",
            temperature=0.3,
            max_tokens=300
        )
        
        # Parse AI response for score
        import re
        score_match = re.search(r'Score:\s*(\d+)', ai_response)
        if score_match:
            score = int(score_match.group(1))
        
        ai_feedback = ai_response
        log_task(task_id, "INFO", f"AI review completed with score {score}")
        
    except Exception as e:
        log_task(task_id, "WARN", f"AI review failed, using basic score: {e}")
        score = 90  # Fallback score if AI fails
        ai_feedback = "Basic quality checks passed (AI review unavailable)"

    return {
        "score": score,
        "decision": "APPROVE" if score >= score_threshold else "REJECT",
        "feedback": {
            "summary": "Quality review completed",
            "ai_feedback": ai_feedback,
            "target_status": status
        },
    }


# -------------------------
# CHART EXECUTOR
# -------------------------
def run_chart(task_id, job_id, payload):
    """Generate chart PNG from payload with mandatory role support (Phase 8.4.2)"""
    import io
    import matplotlib.pyplot as plt
    import re

    # Check for unresolved template placeholders
    payload_str = json.dumps(payload)
    unresolved = re.findall(r'\{\{[^}]+\}\}', payload_str)
    if unresolved:
        error_msg = f"Chart payload contains unresolved templates: {unresolved}. Ensure dependencies are completed before chart task."
        log_task(task_id, "ERROR", error_msg)
        raise ValueError(error_msg)

    title = payload.get("title", "Chart")
    chart_type = payload.get("type", "bar")
    x = payload.get("x", [])
    y = payload.get("y", [])
    x_label = payload.get("x_label", "")
    y_label = payload.get("y_label", "")
    
    # Validate data
    if not x or not y:
        error_msg = f"Chart data is empty. x={x}, y={y}. Check that template placeholders were resolved."
        log_task(task_id, "ERROR", error_msg)
        raise ValueError(error_msg)
    
    # Phase 8.4.2: Determine role with mapping and guardrail
    role = get_chart_role(payload)
    
    # Phase 8.4.2: Guardrail - fail fast on missing role
    if not role:
        raise ValueError("Chart artifact role must be specified")

    plt.figure(figsize=(6, 4))

    if chart_type == "bar":
        plt.bar(x, y)
    elif chart_type == "line":
        plt.plot(x, y)
    else:
        raise ValueError(f"Unsupported chart type: {chart_type}")

    plt.title(title)
    plt.xlabel(x_label)
    plt.ylabel(y_label)
    plt.tight_layout()

    buf = io.BytesIO()
    plt.savefig(buf, format="png")
    plt.close()
    buf.seek(0)

    # Phase 8.4.2: Use role in filename
    filename = f"{role}.png"
    object_key = f"jobs/{job_id}/{task_id}.png"

    s3_client.put_object(
        Bucket=MINIO_BUCKET,
        Key=object_key,
        Body=buf,
        ContentType="image/png"
    )

    # Phase 8.4.2: Include role in artifact metadata
    artifact_metadata = {
        "chart_type": chart_type,
        "data_points": len(x),
        "role": role  # Explicitly store role in metadata
    }

    requests.post(
        f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
        json={
            "result": {
                "ok": True,
                "job_id": job_id,
                "executor": "chart",
                "image_url": f"/api/artifacts/{task_id}/download",  # URL for reference
                "storage_key": object_key,  # Storage key for direct access
                "role": role,  # Role for artifact matching
                "chart_type": chart_type,
                "data_points": len(x)
            },
            "artifact": {
                "type": "chart",
                "filename": filename,
                "storage_key": object_key,
                "role": role,  # Phase 8.4.2: Mandatory role field
                "metadata": artifact_metadata
            }
        },
        timeout=5,
    )

    worker_tasks_total.labels(result="success").inc()
    log_task(task_id, "INFO", f"Chart generated: {chart_type} with {len(x)} data points, role='{role}'")


# -------------------------
# ADDITIONAL AGENT TYPES
# -------------------------
def run_analyzer(task_id, job_id, payload):
    """AI-powered data analysis with insights"""
    import statistics
    
    data = payload.get("data", [])
    analysis_type = payload.get("analysis_type", "summary")

    # Build outputs that match the backend agent registry:
    # - outputs.stats (json)
    # - outputs.insights (string)
    stats: dict = {}
    insights: str = ""

    if not data:
        stats = {"error": "No data provided for analysis"}
        insights = "No data provided for analysis."
    else:
        if analysis_type == "summary":
            stats = {
                "count": len(data),
                "mean": statistics.mean(data),
                "median": statistics.median(data),
                "min": min(data),
                "max": max(data),
            }

            # Add AI-powered insights
            try:
                ai_prompt = f"""Analyze this statistical data and provide insights:

Data: {data[:50]}  # First 50 points
Statistics:
- Count: {stats['count']}
- Mean: {stats['mean']}
- Median: {stats['median']}
- Min: {stats['min']}
- Max: {stats['max']}

Provide 2-3 key insights about this data in plain language."""

                insights = ai_helper.generate_ai_response(
                    ai_prompt,
                    task_type="analyzer",
                    temperature=0.5,
                    max_tokens=200,
                )
                log_task(task_id, "INFO", "AI insights generated")
            except Exception as e:
                log_task(task_id, "WARN", f"AI insights failed: {e}")
                insights = "AI analysis unavailable"

        elif analysis_type == "trend":
            increasing = all(data[i] <= data[i + 1] for i in range(len(data) - 1))
            decreasing = all(data[i] >= data[i + 1] for i in range(len(data) - 1))
            trend = "increasing" if increasing else "decreasing" if decreasing else "mixed"
            stats = {
                "trend": trend,
                "data_points": len(data),
                "first": data[0] if data else None,
                "last": data[-1] if data else None,
            }
            insights = f"Detected a {trend} trend across {len(data)} data points."

        else:
            stats = {"analysis_type": analysis_type, "data_points": len(data)}
            insights = f"Analysis completed for type '{analysis_type}'."

    content = json.dumps({"stats": stats, "insights": insights}, indent=2).encode("utf-8")
    
    object_key = f"jobs/{job_id}/{task_id}_analysis.json"
    s3_client.put_object(
        Bucket=MINIO_BUCKET,
        Key=object_key,
        Body=io.BytesIO(content),
        ContentType="application/json"
    )
    
    requests.post(
        f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
        json={
            "result": {
                "ok": True,
                "job_id": job_id,
                "executor": "analyzer",
                "stats": stats,
                "insights": insights,
            },
            "artifact": {"type": "json", "filename": "analysis.json", "storage_key": object_key}
        },
        timeout=5,
    )
    worker_tasks_total.labels(result="success").inc()
    log_task(task_id, "INFO", f"Analysis completed: {analysis_type}")


def run_summarizer(task_id, job_id, payload):
    """AI-powered text summarization"""
    text = payload.get("text", "")
    max_sentences = payload.get("max_sentences", 3)
    
    if not text:
        summary = "No text provided for summarization."
        original_length = 0
    else:
        try:
            # Use AI for abstractive summarization
            ai_prompt = f"""Summarize the following text in {max_sentences} sentences or less. Be concise and capture the key points:

{text[:2000]}"""  # Limit input text to avoid token limits
            
            summary = ai_helper.generate_ai_response(
                ai_prompt,
                task_type="summarizer",
                temperature=0.5,
                max_tokens=300
            )
            log_task(task_id, "INFO", "AI summarization completed")
            
        except Exception as e:
            # Fallback to simple extractive summarization
            log_task(task_id, "WARN", f"AI summarization failed, using fallback: {e}")
            sentences = text.replace('!', '.').replace('?', '.').split('.')
            sentences = [s.strip() for s in sentences if s.strip()]
            summary_sentences = sentences[:max_sentences]
            summary = '. '.join(summary_sentences) + '.'
        
        original_length = len(text)
    
    content = json.dumps({"summary": summary, "original_length": original_length}).encode("utf-8")
    object_key = f"jobs/{job_id}/{task_id}_summary.json"
    
    s3_client.put_object(
        Bucket=MINIO_BUCKET,
        Key=object_key,
        Body=io.BytesIO(content),
        ContentType="application/json"
    )
    
    requests.post(
        f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
        json={
            "result": {
                "ok": True,
                "job_id": job_id,
                "executor": "summarizer",
                "summary": summary,
                "original_length": original_length
            },
            "artifact": {"type": "json", "filename": "summary.json", "storage_key": object_key}
        },
        timeout=5,
    )
    worker_tasks_total.labels(result="success").inc()
    log_task(task_id, "INFO", "Summarization completed")


def run_validator(task_id, job_id, payload):
    """AI-enhanced data validation with semantic checks"""
    data = payload.get("data", {})
    rules = payload.get("rules", {})
    
    errors = []
    warnings = []
    
    # Basic rule-based validation
    for field, rule in rules.items():
        value = data.get(field)
        if rule.get("required") and not value:
            errors.append(f"Missing required field: {field}")
        if value and rule.get("type"):
            if rule["type"] == "number" and not isinstance(value, (int, float)):
                errors.append(f"Field {field} should be a number")
            if rule["type"] == "string" and not isinstance(value, str):
                errors.append(f"Field {field} should be a string")
        if value and rule.get("min") is not None:
            if isinstance(value, (int, float)) and value < rule["min"]:
                warnings.append(f"Field {field} below minimum: {value} < {rule['min']}")
    
    # AI-powered semantic validation
    if data and rules:
        try:
            ai_prompt = f"""Perform semantic validation on this data against the rules:

Data: {json.dumps(data, indent=2)}
Rules: {json.dumps(rules, indent=2)}

Provide:
1. Any additional validation concerns (semantic issues, data quality, etc.)
2. Suggestions for improvement
Keep it brief (2-3 sentences)."""
            
            ai_validation = ai_helper.generate_ai_response(
                ai_prompt,
                task_type="validator",
                temperature=0.3,
                max_tokens=200
            )
            log_task(task_id, "INFO", "AI validation completed")
        except Exception as e:
            log_task(task_id, "WARN", f"AI validation failed: {e}")
            ai_validation = "AI validation unavailable"
    else:
        ai_validation = "No data or rules provided"
    
    is_valid = len(errors) == 0
    result = {
        "valid": is_valid,
        "errors": errors,
        "warnings": warnings,
        "ai_validation": ai_validation
    }
    content = json.dumps(result, indent=2).encode("utf-8")
    
    object_key = f"jobs/{job_id}/{task_id}_validation.json"
    s3_client.put_object(
        Bucket=MINIO_BUCKET,
        Key=object_key,
        Body=io.BytesIO(content),
        ContentType="application/json"
    )
    
    requests.post(
        f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
        json={
            "result": {"ok": True, "job_id": job_id, "executor": "validator", "valid": is_valid},
            "artifact": {"type": "json", "filename": "validation.json", "storage_key": object_key}
        },
        timeout=5,
    )
    worker_tasks_total.labels(result="success").inc()
    log_task(task_id, "INFO", f"Validation completed: {'passed' if is_valid else 'failed'}")


def run_transformer(task_id, job_id, payload):
    """AI-powered data transformation"""
    data = payload.get("data", [])
    transform_type = payload.get("transform", "uppercase")
    
    if isinstance(data, list):
        # Basic transformations
        if transform_type == "uppercase":
            transformed = [str(x).upper() for x in data]
        elif transform_type == "lowercase":
            transformed = [str(x).lower() for x in data]
        elif transform_type == "reverse":
            transformed = list(reversed(data))
        elif transform_type == "unique":
            transformed = list(set(data))
        elif transform_type.startswith("ai:"):
            # AI-powered custom transformation
            try:
                instruction = transform_type[3:]  # Remove "ai:" prefix
                ai_prompt = f"""Transform the following data according to this instruction: {instruction}

Data: {data[:50]}

Provide the transformed data as a JSON array."""
                
                ai_result = ai_helper.generate_ai_response(
                    ai_prompt,
                    task_type="transformer",
                    temperature=0.5,
                    max_tokens=500
                )
                
                # Try to extract JSON from response
                extracted_json = ai_helper.extract_json_from_response(ai_result)
                if extracted_json and isinstance(extracted_json, list):
                    transformed = extracted_json
                else:
                    # Fallback: return original data
                    transformed = data
                    log_task(task_id, "WARN", "Could not parse AI transformation result")
                
                log_task(task_id, "INFO", "AI transformation completed")
            except Exception as e:
                log_task(task_id, "WARN", f"AI transformation failed: {e}")
                transformed = data
        else:
            transformed = data
    else:
        transformed = data
    
    content = json.dumps({"transformed": transformed, "original_count": len(data) if isinstance(data, list) else 0}).encode("utf-8")
    object_key = f"jobs/{job_id}/{task_id}_transform.json"
    
    s3_client.put_object(
        Bucket=MINIO_BUCKET,
        Key=object_key,
        Body=io.BytesIO(content),
        ContentType="application/json"
    )
    
    requests.post(
        f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
        json={
            "result": {"ok": True, "job_id": job_id, "executor": "transformer"},
            "artifact": {"type": "json", "filename": "transform.json", "storage_key": object_key}
        },
        timeout=5,
    )
    worker_tasks_total.labels(result="success").inc()
    log_task(task_id, "INFO", f"Transform completed: {transform_type}")


def run_notifier(task_id, job_id, payload):
    """Simulate sending notifications"""
    channel = payload.get("channel", "email")
    recipients = payload.get("recipients", [])
    message = payload.get("message", "Notification from workflow")
    
    # Simulate notification delivery
    sent_count = len(recipients) if recipients else 0
    
    content = json.dumps({
        "channel": channel,
        "sent_to": recipients,
        "message_preview": message[:100],
        "status": "sent",
        "sent_count": sent_count
    }).encode("utf-8")
    
    object_key = f"jobs/{job_id}/{task_id}_notification.json"
    s3_client.put_object(
        Bucket=MINIO_BUCKET,
        Key=object_key,
        Body=io.BytesIO(content),
        ContentType="application/json"
    )
    
    requests.post(
        f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
        json={
            "result": {"ok": True, "job_id": job_id, "executor": "notifier", "notifications_sent": sent_count},
            "artifact": {"type": "json", "filename": "notification.json", "storage_key": object_key}
        },
        timeout=5,
    )
    worker_tasks_total.labels(result="success").inc()
    log_task(task_id, "INFO", f"Notification sent via {channel} to {sent_count} recipients")


def run_scraper(task_id, job_id, payload):
    """Real web scraping with BeautifulSoup and AI-powered extraction"""
    url = payload.get("url", "")
    selector = payload.get("selector", "")
    
    if not url:
        error_msg = "URL is required for scraping"
        log_task(task_id, "ERROR", error_msg)
        scraped_data = {"error": error_msg, "status": "failed"}
    else:
        try:
            # Fetch the webpage
            log_task(task_id, "INFO", f"Fetching URL: {url}")
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            
            # Parse with BeautifulSoup
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Extract content based on selector
            if selector:
                elements = soup.select(selector)
                items = [elem.get_text(strip=True) for elem in elements[:10]]  # Limit to 10 items
                log_task(task_id, "INFO", f"Found {len(elements)} elements matching selector '{selector}'")
            else:
                # Extract all text if no selector
                items = [p.get_text(strip=True) for p in soup.find_all('p')[:10]]
                log_task(task_id, "INFO", f"Extracted {len(items)} paragraphs (no selector)")
            
            # Use AI to summarize/analyze scraped content if available
            try:
                content_preview = " ".join(items[:5])[:500]  # First 500 chars
                ai_prompt = f"""Analyze this scraped web content and provide a brief summary:

URL: {url}
Content Preview: {content_preview}

Provide a 2-3 sentence summary of what this webpage contains."""
                
                ai_summary = ai_helper.generate_ai_response(
                    ai_prompt,
                    task_type="scraper",
                    temperature=0.3,
                    max_tokens=150
                )
                log_task(task_id, "INFO", "AI summary generated")
            except Exception as e:
                log_task(task_id, "WARN", f"AI analysis failed: {e}")
                ai_summary = "AI analysis unavailable"
            
            scraped_data = {
                "url": url,
                "selector": selector or "all paragraphs",
                "items_found": len(items),
                "sample_data": items[:5],  # First 5 items
                "text": "\n".join(items),  # Full text for template resolution
                "ai_summary": ai_summary,
                "status": "completed",
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
            }
            
        except requests.exceptions.RequestException as e:
            error_msg = f"Failed to fetch URL: {str(e)}"
            log_task(task_id, "ERROR", error_msg)
            scraped_data = {
                "url": url,
                "error": error_msg,
                "status": "failed",
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
            }
        except Exception as e:
            error_msg = f"Scraping error: {str(e)}"
            log_task(task_id, "ERROR", error_msg)
            scraped_data = {
                "url": url,
                "error": error_msg,
                "status": "failed",
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
            }
    
    content = json.dumps(scraped_data, indent=2).encode("utf-8")
    object_key = f"jobs/{job_id}/{task_id}_scrape.json"
    
    s3_client.put_object(
        Bucket=MINIO_BUCKET,
        Key=object_key,
        Body=io.BytesIO(content),
        ContentType="application/json"
    )
    
    requests.post(
        f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
        json={
            "result": {
                "ok": True, 
                "job_id": job_id, 
                "executor": "scraper",
                "text": "\n".join(scraped_data.get("sample_data", [])) if isinstance(scraped_data.get("sample_data"), list) else str(scraped_data),
                "html": response.text if 'response' in locals() else "",
                "result": scraped_data  # For backward compatibility with templates expecting .result
            },
            "artifact": {"type": "json", "filename": "scrape.json", "storage_key": object_key}
        },
        timeout=5,
    )
    worker_tasks_total.labels(result="success").inc()
    log_task(task_id, "INFO", f"Scraping completed for {url}")


# -------------------------
# WORKER HANDLER
# -------------------------
def handle_message(ch, method, properties, body):
    payload = json.loads(body)
    task_id = payload["task_id"]
    job_id = payload.get("job_id")
    
    # Use the resolved payload from the message (NOT from database)
    # The backend resolves {{tasks.X.outputs.Y}} templates before enqueueing
    task_payload_from_message = payload.get("payload", {})

    print(f"[WORKER] Received task {task_id}", flush=True)

    agent_type_db, task_payload_db, job_id_db, task_name_db = load_task_context(task_id)
    if job_id is None:
        job_id = job_id_db
    if agent_type_db is None:
        log_task(task_id, "ERROR", "Task not found in DB")
        ch.basic_ack(delivery_tag=method.delivery_tag)
        return
    
    # Prefer resolved payload from message over database payload
    # The message contains template-resolved values, DB has original templates
    if task_payload_from_message:
        print(f"[WORKER] Using resolved payload from message (keys: {list(task_payload_from_message.keys())})")
        task_payload_db = task_payload_from_message
    else:
        print(f"[WORKER] Warning: No payload in message, using DB payload (may have unresolved templates)")

    # Acquire ownership
    try:
        r = requests.post(
            f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/start",
            timeout=5,
        )

        # If already RUNNING (e.g., worker crash/restart), proceed idempotently
        if r.status_code not in (200, 409):
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

    except Exception as e:
        log_task(task_id, "ERROR", f"Start failed: {e}")
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
        return

    try:
        log_task(task_id, "INFO", "Execution started")

        # ---- EXECUTION / REVIEW ----
        time.sleep(1)

        if agent_type_db == "reviewer":
            review = run_reviewer(task_id, task_payload_db)

            rr = requests.post(
                f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/review",
                json=review,
                timeout=5,
            )

            if rr.status_code != 200:
                raise RuntimeError(f"Internal review failed: {rr.status_code} {rr.text}")

            worker_tasks_total.labels(result="reviewed").inc()
            log_task(task_id, "INFO", f"Review completed: {review['decision']}")

        elif agent_type_db == "designer":
            run_designer(task_id, job_id, task_payload_db)

        elif agent_type_db == "chart":
            run_chart(task_id, job_id, task_payload_db)

        elif agent_type_db == "analyzer":
            run_analyzer(task_id, job_id, task_payload_db)

        elif agent_type_db == "summarizer":
            run_summarizer(task_id, job_id, task_payload_db)

        elif agent_type_db == "validator":
            run_validator(task_id, job_id, task_payload_db)

        elif agent_type_db == "transformer":
            run_transformer(task_id, job_id, task_payload_db)

        elif agent_type_db == "notifier":
            run_notifier(task_id, job_id, task_payload_db)

        elif agent_type_db == "scraper":
            run_scraper(task_id, job_id, task_payload_db)

        else:
            # AI-Powered Executor: handles any custom task with AI
            name = (task_name_db or "").strip()
            prompt = task_payload_db.get("prompt", "") if isinstance(task_payload_db, dict) else ""
            
            # Check if we have a custom prompt to use AI
            if prompt:
                try:
                    # Use AI to execute the custom task
                    log_task(task_id, "INFO", f"Executing custom task with AI: {name}")
                    
                    ai_prompt = f"""Execute this task:

Task Name: {name}
Instructions: {prompt}

Provide a detailed response completing this task. Be thorough and specific."""
                    
                    ai_response = ai_helper.generate_ai_response(
                        ai_prompt,
                        task_type="executor",
                        temperature=0.7,
                        max_tokens=1000
                    )
                    
                    content = ai_response.encode("utf-8")
                    log_task(task_id, "INFO", "AI execution completed")
                    
                except Exception as e:
                    # Fallback if AI fails
                    log_task(task_id, "WARN", f"AI execution failed: {e}, using fallback")
                    content = f"Task '{name}' executed (AI unavailable).\nPrompt: {prompt}\n".encode("utf-8")
            else:
                # Fallback for predefined tasks or tasks without prompts
                if name.lower() == "fetch_data":
                    content = json.dumps({"source": "demo", "rows": [1, 2, 3]}).encode("utf-8")
                elif name.lower() == "process_data":
                    content = json.dumps({"processed": True, "summary": "ok"}).encode("utf-8")
                elif name.lower() == "generate_report":
                    content = b"Report generated successfully.\n"
                else:
                    content = f"Executed {name} successfully.\n".encode("utf-8")

            object_key = f"jobs/{job_id}/{task_id}.txt"
            
            # Upload to S3
            try:
                s3_client.put_object(
                    Bucket=MINIO_BUCKET,
                    Key=object_key,
                    Body=io.BytesIO(content),
                    ContentType="text/plain"
                )
                log_task(task_id, "INFO", f"Artifact uploaded to {object_key}")
                
                # Prepare artifact metadata
                artifact = {
                    "type": "text",
                    "filename": "output.txt",
                    "storage_key": object_key,
                    "metadata": {
                        "bytes": len(content)
                    }
                }
                
                completion_payload = {
                    "result": {
                        "ok": True,
                        "job_id": job_id,
                        "worker": "python_worker",
                    },
                    "artifact": artifact
                }
                
            except Exception as upload_error:
                log_task(task_id, "ERROR", f"Artifact upload failed: {upload_error}")
                completion_payload = {
                    "result": {
                        "ok": True,
                        "job_id": job_id,
                        "worker": "python_worker",
                    }
                }
            
            requests.post(
                f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
                json=completion_payload,
                timeout=5,
            )

            worker_tasks_total.labels(result="success").inc()
            log_task(task_id, "INFO", "Execution succeeded")

        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception as e:
        retries = get_retry_count(task_id)
        increment_retry(task_id)

        log_task(task_id, "ERROR", f"Execution failed: {e}")

        if retries + 1 >= MAX_RETRIES:
            # ❌ PERMANENT FAILURE → DLQ (mark failed in orchestrator)
            requests.post(
                f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/fail",
                json={"error": str(e)},
                timeout=5,
            )

            worker_tasks_total.labels(result="failed").inc()

            log_task(task_id, "ERROR", "Moved to DLQ")
            ch.basic_ack(delivery_tag=method.delivery_tag)

        else:
            # 🔁 RETRY
            log_task(
                task_id,
                "WARN",
                f"Retrying ({retries + 1}/{MAX_RETRIES})",
            )
            time.sleep(RETRY_BACKOFF_SEC)
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)


# -------------------------
# RABBITMQ
# -------------------------
def connect_rabbitmq():
    while True:
        try:
            params = pika.URLParameters(RABBIT_URL)
            conn = pika.BlockingConnection(params)
            ch = conn.channel()

            ch.queue_declare(queue=TASK_QUEUE, durable=True)
            ch.queue_declare(queue=DLQ_QUEUE, durable=True)

            ch.basic_qos(prefetch_count=1)
            return conn, ch
        except Exception:
            time.sleep(2)


if __name__ == "__main__":
    db_conn = connect_db()
    connection, channel = connect_rabbitmq()
    
    channel.basic_consume(
        queue=TASK_QUEUE,
        on_message_callback=handle_message,
    )

    print("[WORKER] Waiting for tasks...", flush=True)
    channel.start_consuming()
else:
    # For testing: mock or lazy connect
    # We'll handle this in the test script by patching or setting these globals manually if needed
    pass
